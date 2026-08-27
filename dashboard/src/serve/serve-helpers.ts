// Stand-alone pieces of the aide-dashboard server: no dependency on
// `createServer`'s closure (spec: split serve.ts, step 1). Split out
// because `serve.ts` had grown past 4800 lines and this is the part of
// it that is genuinely just functions of their own arguments.

import { createHash, timingSafeEqual } from "node:crypto";
import {
  closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, normalize, resolve, sep } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import type { DiscoveredProject, SpecRef } from "../project/discover.ts";
import { mergeQueueDefaults, parseQueueProjects, type Job, type ModelChoice, type QueueDefaults } from "../queue/queue.ts";
import {
  ABOUT_PAGE, EDITABLE_SPEC_FILE, FILTER_FIELD_PREFIX, FILTER_KEYS, OVERVIEW_PAGE, STATUS_SPEC_FILE,
  navEntries,
  APPLE_TOUCH_ICON, APP_ICON, APP_ICON_MASKABLE, SERVICE_WORKER, WEBMANIFEST,
  type NavEntry,
} from "../render.ts";
import type { ServerOptions } from "./serve.ts";

export const MAX_BODY = 4096;

/** What the save route accepts instead (spec 162). A description is not
 *  an action post: this spec's own `1-description.md` was 4182 raw
 *  bytes before a single character of form-urlencoding overhead, so
 *  `MAX_BODY` would have refused the very file the editor was written
 *  for. 64 KiB is roughly fifteen times that — headroom for a
 *  description that grows, without becoming an unbounded body on a
 *  token-gated internal server. */
export const MAX_SAVE_BODY = 65536;

/** How long the project's own install may run after its code merged.
 *  The same bounded-timeout discipline every git call already has
 *  (`createGitRunner`): a hung install must not tie up a request
 *  handler, whatever the server's idle timeout is set to. */
export const INSTALL_TIMEOUT_MS = 60_000;

// The caps decided in spec 81: deliberately tight. An `analyze` step
// fits; an `implement` on Opus will stop early, on purpose, until the
// per-step value is raised from a measurement.
export const QUEUE_DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  // Per step since spec 152. 1200 is unchanged for everything else;
  // `implement` gets 5400 because 149's was killed at the 45-minute
  // mark with RED and GREEN done and its tests green, mid-way through
  // writing documentation on a twenty-file change. A correction from
  // two data points, not a measurement — it lives in `queue-config.json`
  // on the serving host and should be revisited once more have run.
  // `analyze` gets 2400 for the same reason (spec 181): the reviewer
  // routine that used to be its own `review-plan` step now runs inside
  // `analyze`, so one run does what used to be two, and the default
  // budget for one step is no longer enough for both.
  timeoutSec: { default: 1200, implement: 5400, analyze: 2400 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  // `archive` falls to `default`, and that is a decision rather than an
  // accident of which key happens to be missing: it may now have a merge
  // conflict to resolve (spec 171), and a merge is not an implement.
  model: { implement: "opus", default: "sonnet" },
};

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

/** One repo, one merge at a time. Pressing Merge on two specs a few
 *  milliseconds apart ran two full `status`/`fetch`/`switch`/`pull`/
 *  `merge`/`push` sequences against the SAME working tree, and the
 *  second lost the race for `index.lock` — reported as "cannot
 *  fast-forward main … merge it by hand", which is what a genuinely
 *  diverged base says. Both went through on a retry, which is what
 *  told them apart.
 *
 *  Per repo ROOT, not global: two requests that touch no directory in
 *  common cannot collide, and serializing them would only add latency.
 *  This is additive to `branch-merge.ts`'s `index.lock` retry, which
 *  guards a collision this cannot see — `aide-run-spec` is a different
 *  process.
 *
 *  Exported so the lock can be proven on its own: that it serializes,
 *  that different roots do not wait for each other, that a thrown turn
 *  does not poison the next, and that the map lets go of a root once
 *  nothing is waiting on it. A map a server never empties is a map
 *  that grows for as long as the server is up. */
export function createRootLock() {
  const chains = new Map<string, Promise<unknown>>();
  return {
    run<T>(root: string, fn: () => Promise<T>): Promise<T> {
      const prev = chains.get(root) ?? Promise.resolve();
      // Settled either way: one request's failure is its own, and the
      // next request's turn must still come.
      const turn = prev.then(fn, fn);
      const done: Promise<void> = turn.then(clear, clear);
      function clear(): void {
        // Only the LAST chain clears the entry. An earlier waiter
        // deleting it would let the next request start beside the one
        // still running, which is the whole thing being prevented.
        if (chains.get(root) === done) chains.delete(root);
      }
      chains.set(root, done);
      return turn;
    },
    get size(): number {
      return chains.size;
    },
  };
}

/** Why an archived spec refuses to be edited (spec 163). One sentence,
 *  in one place: the GET that would have rendered the form and the POST
 *  that would have written the file both say it, and the page a reader
 *  lands on is the spec's own. */
export const ARCHIVED_REFUSAL = "this spec is archived — it is a record, and cannot be edited";

/** What a Save's commit RECORDS. Two routes since spec 212 — the
 *  description's own Save and the checks' — and each writes one file,
 *  so each has one sentence. There was a third, for the one commit that
 *  could carry both; two files can no longer arrive in one request, so
 *  it has nothing left to describe.
 *
 *  Never the runner's grammar: `workflow-history.ts` counts a step by a
 *  commit subject beginning "Run /aide-", and a hand edit is not a step
 *  the spec has had. */
export const editMessage = (specFolder: string): string =>
  `Edit ${EDITABLE_SPEC_FILE} for ${specFolder} from the dashboard`;
export const tickMessage = (specFolder: string): string =>
  `Tick a check in ${STATUS_SPEC_FILE} for ${specFolder} by hand from the dashboard`;

/** Where a form POST goes back to. Built from the five view keys the
 *  page's own forms send (`FILTER_KEYS`, under `FILTER_FIELD_PREFIX`),
 *  so pressing Run, Cancel or Resolve lands the reader back on the list
 *  they were looking at instead of the default one.
 *
 *  Encoded one key at a time rather than through `URLSearchParams`,
 *  which writes a space as `+`: a refusal's reason goes in this string
 *  and is read by a person. With nothing to carry the target stays
 *  exactly `/`, never `/?`. */
export function specsRedirect(
  body: unknown,
  refusal?: { error: string; spec?: string },
  // Which page the form was ON. `/` for every control on the spec list,
  // which is all of them but three: the project panel moved to
  // `/projects` with spec 115 and the New-spec form to `/new` with spec
  // 121, and a reader refused on either must not be dropped onto the
  // spec list to read the answer.
  target: string = "/",
  /** Something that went RIGHT and the reader still has to read — the
   *  readiness of a project that was just added (spec 138). It rides
   *  where a refusal rides, for the same reason: a redirect is the only
   *  thing a no-script form POST gets back. */
  notice?: { note: string; ok: boolean },
): Response {
  const sent = (body ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of FILTER_KEYS) {
    const value = sent[`${FILTER_FIELD_PREFIX}${key}`];
    if (typeof value === "string" && value) parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  if (refusal) {
    parts.push(`error=${encodeURIComponent(refusal.error)}`);
    // Which row it belongs to. Always derived server-side by the
    // caller — the page lists up to 25 specs, and a reason attached to
    // none of them says nothing about which button was pressed.
    if (refusal.spec) parts.push(`errorSpec=${encodeURIComponent(refusal.spec)}`);
    // WHY it was refused used to ride here too, so the row could offer a
    // `resolve` step for a conflict. It is on the job since spec 149:
    // the refusal that needs it is a LANDING's, and a landing has no
    // browser to redirect.
  }
  if (notice) {
    parts.push(`notice=${encodeURIComponent(notice.note)}`);
    // The colour, not the answer: the sentence says which it is, and
    // the page must not have to read the sentence to draw it.
    if (notice.ok) parts.push("noticeOk=1");
  }
  const query = parts.join("&");
  // `&` when the target already carries a query of its own: a refused
  // save goes back to the tab its form was on (spec 212), and that tab
  // is a `?tab=` on the spec's own path.
  const sep = target.includes("?") ? "&" : "?";
  return new Response(null, { status: 303, headers: { location: query ? `${target}${sep}${query}` : target } });
}

/** Every refusal, in `serve.log`. Both streams of the launchd job go to
 *  that one file (`deploy/render-plist.ts`), so `console.error` IS the
 *  log line — and until now no request handler wrote one at all, which
 *  left a day of refused merges with nothing on disk to read back. */
export function logRefusal(action: string, spec: string | undefined, reason: string): void {
  console.error(`queue: ${action} refused for ${spec ?? "an unknown spec"} — ${reason}`);
}

// Nav for a server started without `--root`: reconstruct the entries
// from the generated site directory (the overview + every *.html except
// About).
//
// It does NOT call `navEntries()`, deliberately and not by oversight.
// That function points Projects at the SERVED page (spec 115), which
// this server cannot render: with no project root it has nothing to
// list. So the fallback keeps naming the generated file, which is
// exactly what it has always shown — and `GET /projects` on such a
// server redirects there too. Change one of the two and you have made
// them disagree; they answer differently on purpose.
export function navFromSite(siteDir: string): NavEntry[] {
  const entries: NavEntry[] = [{ label: "Projects", path: OVERVIEW_PAGE }];
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    for (const f of readdirSync(siteDir).sort()) {
      // About is a generated page, not a project — listing it under
      // Projects would invent one that does not exist.
      if (!f.endsWith(".html") || f === OVERVIEW_PAGE || f === ABOUT_PAGE) continue;
      entries.push({ label: f.replace(/\.html$/, ""), path: f });
    }
  } catch {
    // no site yet — nav is just Overview + Live
  }
  return entries;
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

// Page code is TypeScript, split across src/queue-client/*.ts and bundled
// from its src/queue-client.ts entry point; the browser needs one flat
// JavaScript file. Bundle once, on first use, and keep it — Bun has the
// bundler in-process (`Bun.build`), so this needs no build step and no
// bundle checked into the repo. `format: "iife"` is what makes that
// legal to inline as a classic <script>: no import/export survives in
// the output, every module's top-level code runs inside one wrapper
// function, in the same order the entry point pulls its pieces in.
let queueScript: Promise<string | undefined> | null = null;
export function queueClientScript(): Promise<string | undefined> {
  if (queueScript !== null) return queueScript;
  queueScript = Bun.build({
    entrypoints: [join(import.meta.dir, "../queue-client.ts")],
    target: "browser",
    format: "iife",
  })
    .then((result) => (result.success ? result.outputs[0]?.text() : undefined))
    .catch(() => undefined); // the page still works: the noscript refresh takes over
  return queueScript;
}

// The tail of a file, without reading the rest of it. A 25-minute
// implement run's transcript is not something a page render should ever
// pull into memory whole — and the tail is the part that answers "what
// is it doing". The first line of the window is usually cut in half;
// parse-stream drops what does not parse, so it costs nothing.
export const STREAM_TAIL_BYTES = 256 * 1024;

export function tailFile(path: string, maxBytes = STREAM_TAIL_BYTES): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length === 0) return "";
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    const text = buf.toString("utf-8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    return ""; // no transcript kept, or not readable — the page says so
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already gone */
      }
    }
  }
}

export function serveStatic(siteDir: string, pathname: string): Response {
  // `/` never reaches here: `isQueuePath` claims it for the spec list
  // before the static fallback is tried at all (spec 100). Every other
  // path is a file in the generated site, or a 404.
  const rel = decodeURIComponent(pathname.slice(1));
  const root = resolve(siteDir);
  const target = resolve(root, normalize(rel));
  if (target !== root && !target.startsWith(root + sep)) return new Response("not found", { status: 404 });
  if (!existsSync(target) || !statSync(target).isFile()) return new Response("not found", { status: 404 });
  const type = target.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
  return new Response(readFileSync(target), { headers: { "content-type": type } });
}

/** This step's wall clock. The field is a per-step table since spec 152,
 *  but a job created before that change is still in the store across the
 *  deploy carrying a bare number — read as an index that would hand the
 *  runner the string "undefined" as its deadline. A transitional read
 *  for jobs already in flight, not a dual-format feature.
 *
 *  `live` is the config's own table, and it is what actually answers for
 *  a step ticked onto a running job's tail (spec 160): `parseJobRequest`
 *  resolves the config's `default` into a concrete entry for each step
 *  the request named, so a job's own table carries no `default` key of
 *  its own and a step added afterwards has no entry in it at all. The
 *  `t.default` branch below is kept for a job hand-written with one, not
 *  because any job the queue produces has it (spec 177). */
export function resolveTimeoutSec(t: Job["timeoutSec"], step: string, live: Record<string, number>): number {
  if (typeof t === "number") return t;
  return t[step] ?? t.default ?? live[step] ?? live.default!;
}

/** The same read for the other two per-step tables (spec 177). Named
 *  and exported rather than inlined at each site, so the argv the runner
 *  is started with and the values the row and the job page SHOW cannot
 *  answer the question differently. */
export function resolveStepPermissionMode(job: Job, step: string, live: Record<string, string>): string {
  // The `acceptEdits` literal stays last, so the function is total
  // without asserting on config shape — unreachable in practice, since
  // every path that builds a `QueueDefaults` carries a `default`.
  return job.permissionMode[step] ?? live[step] ?? live.default ?? "acceptEdits";
}

/** A whole-job model pick wins over the config's per-step default: at
 *  creation `parseJobRequest` copies `modelChoice` into EVERY step's own
 *  entry, so a step added later has to match its siblings rather than
 *  fall through to whatever the config says for that step alone. */
export function resolveStepModel(job: Job, step: string, live: Record<string, string>): string | undefined {
  return job.model[step] ?? job.modelChoice ?? live[step] ?? live.default;
}

/** The argv `aide-run-spec` is started with. Extracted so it can be read
 *  in a test: an unattended run's arguments are the whole contract, and
 *  a wrong one is a job that does the wrong thing with nobody watching. */
export function runnerArgv(
  job: Job,
  step: string,
  resultFile: string,
  o: {
    runnerBin: string;
    /** The checkout the step runs in, resolved by the caller. Since
     *  spec 205 that is the clone the DASHBOARD owns, and this function
     *  knows no path convention that could send it anywhere else. */
    projectDir: string;
    push: string;
    /** The file a `schedule` step's prompt is read from, relative to the
     *  project root (spec 259). Meaningless, and omitted, for every
     *  other step — `aide-run-spec` only ever reads `--prompt-file` for
     *  `--command schedule`. */
    promptFile?: string;
    /** The config's own table (spec 125). What a job stores per step is
     *  a NAME the request picked; what the CLI is handed — which tool,
     *  which model string — is looked up here, where the grants
     *  already live. */
    modelChoices?: Record<string, ModelChoice>;
    /** The config's three per-step tables, live (spec 177). What answers
     *  for a step the job's own tables never named — a phase ticked onto
     *  a running job's tail after the job was created. */
    timeoutSec?: Record<string, number>;
    permissionMode?: Record<string, string>;
    model?: Record<string, string>;
  },
  sessionId?: string,
  streamFile?: string,
): string[] {
  const choiceName = resolveStepModel(job, step, o.model ?? {});
  const choice = choiceName ? o.modelChoices?.[choiceName] : undefined;
  // The entry's own key stays the model unless the entry says otherwise
  // — which is exactly what every config written before this spec did.
  const model = choice?.model ?? choiceName;
  const tool = choice?.tool ?? "claude";
  return [
    o.runnerBin,
    "--project-dir", o.projectDir,
    "--command", step,
    "--spec", job.specFolder,
    "--budget-usd", String(job.budgetUsd),
    "--timeout-sec", String(resolveTimeoutSec(job.timeoutSec, step, o.timeoutSec ?? {})),
    "--permission-mode", resolveStepPermissionMode(job, step, o.permissionMode ?? {}),
    "--result-file", resultFile,
    "--push", o.push,
    "--pull",
    // Only a `create` job has these, and it cannot run without them:
    // its `--spec` is a provisional key, not a folder on disk, so the
    // title and the description are the whole of what the step is for.
    ...(job.createTitle ? ["--title", job.createTitle] : []),
    ...(job.createDescription ? ["--description", job.createDescription] : []),
    // What the new spec builds on (spec 110): ONE flag, comma-joined,
    // because that is the shape the `Depends on:` line itself has on
    // disk — nothing downstream has to rejoin a list.
    ...(job.createDependsOn?.length ? ["--depends-on", job.createDependsOn.join(",")] : []),
    // Only a `schedule` step has this, and cannot run without it: its
    // `--spec` is a tracking key, never a folder on disk, so the file
    // is the whole of what the step is for.
    ...(o.promptFile ? ["--prompt-file", o.promptFile] : []),
    ...(model ? ["--model", model] : []),
    // Only when it says something new. `aide-run-spec` defaults to
    // claude, so a choice that names no tool must produce byte-for-byte
    // the argv it produced before this flag existed — the same shape
    // `--model` itself has had all along.
    ...(tool !== "claude" ? ["--tool", tool] : []),
    // Chosen by the runner BEFORE the spawn, so the queue can watch the
    // session while the step runs instead of learning it from a result
    // that only exists once the step is over.
    ...(sessionId ? ["--session-id", sessionId] : []),
    ...(streamFile ? ["--stream-file", streamFile] : []),
  ];
}

/** How many steps may run at once, from the queue config's
 *  `concurrency`. FALLS BACK, it does not clamp: `mergeQueueDefaults`
 *  already ignores what it does not understand and keeps the built-in
 *  value, and one rule beats two. The upper bound of 4 is the only thing
 *  standing between a typo in a config file and sixteen `claude`
 *  sessions on the serving host. */
export const DEFAULT_QUEUE_CONCURRENCY = 2;

export function parseQueueConcurrency(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 4) {
    return DEFAULT_QUEUE_CONCURRENCY;
  }
  return raw;
}

/** The steps a dependency actually holds back (spec 122): the ones that
 *  BUILD on merged code. `analyze` and `create` write
 *  only the spec's own folder in the specs repo and conflict with
 *  nothing, so a chain of dependent specs can be analysed in parallel
 *  the moment it is queued.
 *
 *  A literal array, matched by a test rather than shared: the same
 *  vocabulary is a plain string in `core/scripts/aide-run-spec`, with no
 *  shared source and no compiler between the two, and
 *  `test_the_two_copies_of_the_dependency_gate_agree` is what notices
 *  the drift — exactly as `WORKFLOW_STEPS` already does. */
export const DEPENDENCY_GATED_STEPS = ["implement", "archive"] as const;

export const GATED = new Set<string>(DEPENDENCY_GATED_STEPS);

/** Which folder a `Depends on:` entry means — a second reader of
 *  `resolve_dependency_folder`'s rule in `aide-run-spec`: the exact
 *  folder first, then an `<id>-` prefix, live specs before archived
 *  ones. The same trade-off `discover.ts`'s `specDependsOn` already
 *  made for the line itself, so it gets what that one has: its own
 *  tests, mirroring the bash suite's cases one for one.
 *
 *  `undefined` for an identifier nothing matches. That is a REFUSAL, not
 *  a wait, and it belongs to `aide-run-spec` — a typo must reach the run
 *  that says so rather than park a job forever against a spec that will
 *  never exist. */
export function resolveDependencyFolder(
  project: DiscoveredProject,
  id: string,
): SpecRef | undefined {
  const live = project.specs.filter((s) => !s.archived);
  const archived = project.specs.filter((s) => s.archived);
  for (const set of [live, archived]) {
    const exact = set.find((s) => s.folder === id);
    if (exact) return exact;
    const prefixed = set.find((s) => s.folder.startsWith(`${id}-`));
    if (prefixed) return prefixed;
  }
  return undefined;
}

export function parseArgs(argv: string[]): ServerOptions {
  const opts: ServerOptions = { siteDir: join(homedir(), "aide-dashboard", "site"), port: 8788 };
  let root: string | undefined;
  let tokenFile: string | undefined;
  let queueConfigFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--site" && v) opts.siteDir = argv[++i]!;
    else if (a === "--port" && v) opts.port = Number(argv[++i]);
    else if (a === "--claude-usage" && v) opts.claudeUsageUrl = argv[++i];
    else if (a === "--mirror" && v) opts.mirrorPath = argv[++i];
    else if (a === "--root" && v) root = argv[++i];
    else if (a === "--bind" && v) opts.bindHost = argv[++i];
    else if (a === "--queue-mirror" && v) opts.queueMirrorPath = argv[++i];
    else if (a === "--queue-projects" && v) opts.queueProjects = argv[++i]!.split(",").map((s) => s.trim());
    else if (a === "--runner-bin" && v) opts.queueRunnerBin = argv[++i];
    else if (a === "--result-dir" && v) opts.queueResultDir = argv[++i];
    // Where the dashboard keeps the clones it works in (spec 205).
    // `~/aide-dashboard-checkouts` unless a host wants them elsewhere.
    else if (a === "--dashboard-checkouts" && v) opts.dashboardCheckoutRoot = argv[++i];
    else if (a === "--queue-config" && v) queueConfigFile = argv[++i];
    // The token is read from a FILE, never an argument: `ps` shows
    // arguments to every user on the machine.
    else if (a === "--token-file" && v) tokenFile = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.mirrorPath) opts.mirrorPath = join(homedir(), "aide-dashboard", "aide-runs.json");
  if (!opts.queueMirrorPath) opts.queueMirrorPath = join(homedir(), "aide-dashboard", "aide-queue.json");
  if (tokenFile) {
    // A missing or unreadable token file must not crash the server:
    // launchd would restart it in a loop and take the whole dashboard
    // down over a feature that is meant to fail closed, not loud.
    try {
      const token = readFileSync(tokenFile, "utf-8").trim();
      if (token) opts.queueToken = token;
      else console.error(`token file ${tokenFile} is empty — the queue stays off`);
    } catch {
      console.error(`cannot read ${tokenFile} — the queue stays off`);
    }
  }
  if (queueConfigFile) {
    // Kept whether or not the file is readable: the Add/Remove routes
    // write the allowlist back here, and a first install has no such
    // file yet (spec 112).
    opts.queueConfigFile = queueConfigFile;
    // A missing or broken config leaves the built-in caps in place —
    // the tight ones. Failing towards "spends less" is the only safe
    // direction here.
    try {
      const raw = parseJsonc(readFileSync(queueConfigFile, "utf-8")) as Record<string, unknown>;
      opts.queueDefaults = mergeQueueDefaults(QUEUE_DEFAULTS, raw);
      // The notify command is an argv ARRAY: it is run with no shell,
      // so a string would have to be split by someone, and that someone
      // would get quoting wrong.
      if (Array.isArray(raw.notifyCommand) && raw.notifyCommand.every((a) => typeof a === "string")) {
        opts.queueNotifyCommand = raw.notifyCommand as string[];
      }
      // Where a landed branch is reported (spec 158). Off unless the
      // file names a URL — the same direction every other key here
      // fails in, and the reason this one has no built-in default.
      if (typeof raw.mergeEventUrl === "string" && raw.mergeEventUrl) opts.mergeEventUrl = raw.mergeEventUrl;
      if (raw.push === "none" || raw.push === "branch" || raw.push === "pr") opts.queuePush = raw.push;
      opts.queueConcurrency = parseQueueConcurrency(raw.concurrency);
      // The allowlist WINS over `--queue-projects` when the file has
      // one: the flag is the seed for a first install, and the file is
      // what every Add and Remove since has written (spec 112). A
      // malformed field is ignored entirely, leaving the flag — the
      // same direction every other key here fails in.
      const projects = parseQueueProjects(raw.projects);
      if (projects) opts.queueProjects = projects;
    } catch {
      console.error(`cannot read ${queueConfigFile} — keeping the built-in caps`);
    }
  }
  if (root) {
    opts.projectRoot = root;
    // The checkouts and the manifests live under the same root here.
    opts.queueProjectRoot = root;
  }
  // The nav is the same three tabs whatever the projects are — a
  // project is reached from the Projects page, not from the bar. The
  // `navFromSite()` fallback below is what a server with no project
  // root uses, and it reads the site directory instead.
  if (root) opts.navEntries = navEntries();
  return opts;
}

/** What makes this page an app you install (spec 173): five answers
 *  built in `render/pwa.ts` and served from memory, the same shape
 *  /api/aide-run has — a computed string, an explicit content type, no
 *  file on disk. None of them is behind the token, deliberately: the
 *  manifest fetch that drives the install prompt does not always carry
 *  the cookie, and a worker whose script answers 401 never installs at
 *  all. There is nothing in any of them a reader could not already see
 *  in the page's own <head>.
 *
 *  `null` for every other path — the caller falls through to
 *  `serveStatic` (and, before that, its own routes). Pure: no closure,
 *  unlike almost everything else `createServer` calls. */
export function servePwaAsset(path: string): Response | null {
  if (path === "/manifest.webmanifest") {
    return new Response(WEBMANIFEST, {
      headers: { "content-type": "application/manifest+json" },
    });
  }
  if (path === "/sw.js") {
    return new Response(SERVICE_WORKER, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        // A worker the browser is holding on to is a worker a fix
        // cannot reach; this makes it revalidate first.
        "cache-control": "no-cache",
      },
    });
  }
  if (path === "/icon-512.svg" || path === "/icon-512-maskable.svg") {
    // "512" names the size a launcher asks for, not the file: the
    // mark is vector, so one SVG answers every size.
    const icon = path === "/icon-512.svg" ? APP_ICON : APP_ICON_MASKABLE;
    return new Response(icon, { headers: { "content-type": "image/svg+xml; charset=utf-8" } });
  }
  if (path === "/apple-touch-icon.png") {
    return new Response(APPLE_TOUCH_ICON, { headers: { "content-type": "image/png" } });
  }
  return null;
}
