// Plain request/response plumbing: JSON responses, a bounded body read,
// token comparison, cookies, and the sort-column cookie. Split out of
// serve-helpers.ts by theme (split serve-helpers.ts by theme).

import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_BODY } from "./config.ts";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Read a request body, refusing anything over the limit. Both checks
// matter and neither replaces the other: the header is a claim a client
// can lie about, and the actual text is the only thing that has to be
// held in memory. Written once because a size guard kept in two copies
// is a size guard that will one day disagree with itself.
export async function readBounded(
  req: Request,
  // Spec 162: one route passes its own. `MAX_BODY` is right for what it
  // guards — small JSON job requests and short action posts — and
  // raising it globally to fit a description would widen every one of
  // them.
  cap: number = MAX_BODY,
): Promise<{ text: string } | { refusal: Response }> {
  const claimed = Number(req.headers.get("content-length") ?? "0");
  if (claimed > cap) return { refusal: json({ error: "payload too large" }, 413) };
  const text = await req.text();
  if (text.length > cap) return { refusal: json({ error: "payload too large" }, 413) };
  return { text };
}

// Digest both sides first: timingSafeEqual throws on unequal lengths,
// so comparing raw strings would leak length and crash on a mismatch.
export function tokenMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Which column the list is sorted by, and which way.
 *
 *  It lives in the query string, so a link can carry it to someone
 *  else. That alone was not enough to keep it: the Specs tab is a plain
 *  `/`, so is the redirect after Create, and so is a bookmark or the
 *  installed app's own launch — every one of them threw the reader's
 *  choice away and went back to the default (asked for 2026-08-23,
 *  "jeg klikker på Started for å få det rett og så er det endret igjen").
 *
 *  So the choice is remembered in a cookie, the way the theme and the
 *  unit are remembered in storage: an explicit `?sort=` still wins and
 *  is what UPDATES the memory, and a request that names no sort gets
 *  the last one the reader picked. It is a cookie rather than
 *  `localStorage` because the sort is applied where the rows are built
 *  — on the server — so a script could only fix it after the fact, with
 *  a visible jump on every load.
 *
 *  Nothing here is trusted: the renderer falls back to its own defaults
 *  for a column name it does not know. */
export const SORT_COOKIE = "aide_sort";

export function sortChoice(url: URL, req: Request): { sort?: string; dir?: string; setCookie?: string } {
  const sort = url.searchParams.get("sort");
  if (sort) {
    const dir = url.searchParams.get("dir") ?? "";
    return {
      sort,
      dir: dir || undefined,
      setCookie:
        `${SORT_COOKIE}=${encodeURIComponent(`${sort}|${dir}`)}` +
        `; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
    };
  }
  const stored = cookieValue(req.headers.get("cookie"), SORT_COOKIE);
  if (!stored) return {};
  const [remembered, dir] = stored.split("|");
  return { sort: remembered || undefined, dir: dir || undefined };
}

// A body may arrive as JSON (API) or urlencoded (a no-JS form).
export function bodyToObject(text: string, contentType: string | null): unknown {
  if ((contentType ?? "").includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    const out: Record<string, unknown> = {};
    for (const key of new Set(params.keys())) {
      const all = params.getAll(key);
      out[key] = all.length > 1 ? all : all[0];
    }
    // The form posts one "project/specFolder" value; the API posts the
    // two fields separately.
    if (typeof out.target === "string") {
      const [project, ...folder] = out.target.split("/");
      out.project = project;
      out.specFolder = folder.join("/");
      delete out.target;
    }
    if (typeof out.steps === "string") out.steps = [out.steps];
    if (typeof out.dependsOn === "string") out.dependsOn = [out.dependsOn];
    // The model is picked on the PHASE line since spec 123, so a form
    // posts one field per phase — `model.<step>`. A urlencoded body
    // cannot carry a nested object, and this is the one seam every form
    // on the page passes through (`postForm` in queue-client.ts always
    // urlencodes, and the no-JS fallback does too), so the dotted keys
    // are folded back into one object here.
    //
    // A select left on "default" posts an EMPTY value, which every
    // browser sends whether or not the reader touched it. Dropped here
    // rather than passed on: an empty string is not a model name, so
    // the object this builds carries only what someone actually picked.
    // `parseJobRequest` skips a blank entry of its own accord too — a
    // JSON caller reaches it without coming through here — so this is
    // about the SHAPE at this seam, not the only thing standing between
    // an untouched field and a refused request.
    const modelKeys = [...new Set(params.keys())].filter((k) => k.startsWith("model."));
    if (modelKeys.length) {
      const picked: Record<string, string> = {};
      for (const key of modelKeys) {
        const values = params.getAll(key).filter(Boolean);
        if (values.length === 1) picked[key.slice("model.".length)] = values[0]!;
        else if (values.length > 1) (picked as Record<string, unknown>)[key.slice("model.".length)] = values;
        delete out[key];
      }
      if (Object.keys(picked).length) out.model = picked;
    }
    // The settings form's per-step timeout column, folded the same way
    // `model.<step>` is just above — a `timeoutSec.<step>` field per
    // row rather than the flat, seconds-denominated `timeoutSec` the
    // job-creation routes post. Run before the flat-numeric loop below,
    // which only fires while `out.timeoutSec` is still a string.
    const timeoutKeys = [...new Set(params.keys())].filter((k) => k.startsWith("timeoutSec."));
    if (timeoutKeys.length) {
      const picked: Record<string, number> = {};
      for (const key of timeoutKeys) {
        const value = params.get(key);
        if (value) picked[key.slice("timeoutSec.".length)] = Number(value);
        delete out[key];
      }
      if (Object.keys(picked).length) out.timeoutSec = picked;
    }
    for (const numeric of ["budgetUsd", "jobCapUsd", "timeoutSec"]) {
      if (typeof out[numeric] === "string") out[numeric] = Number(out[numeric]);
    }
    return out;
  }
  return JSON.parse(text) as unknown;
}
