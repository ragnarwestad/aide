// Serving what is not a queue route: the generated static site, the PWA
// assets, the fallback nav for a server with no project root, the
// bundled queue-client script, and a bounded file tail.

import {
  closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync,
} from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import {
  ABOUT_PAGE, OVERVIEW_PAGE,
  APPLE_TOUCH_ICON, APP_ICON, APP_ICON_MASKABLE, SERVICE_WORKER, WEBMANIFEST,
  type NavEntry,
} from "../../render.ts";

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
    entrypoints: [join(import.meta.dir, "../../queue-client.ts")],
    target: "browser",
    format: "iife",
  })
    .then((result) => (result.success ? result.outputs[0]?.text() : undefined))
    .catch(() => undefined); // the page still works: the noscript refresh takes over
  return queueScript;
}

// `@toast-ui/editor`'s package.json carries a top-level `"types"` field
// but no `"types"` CONDITION inside its own `"exports"` map — and
// Bun's bundler resolves the bare specifier to that top-level `.d.ts`
// file instead of the `"import"`/`"require"` entry `"exports"` actually
// names (confirmed with `bun -e` and `Bun.build` directly, 2026-08-31:
// `require.resolve("@toast-ui/editor")` itself returns
// `types/index.d.ts`). The `.d.ts` file's own type-only imports
// (`./editor`, `./toastmark`, …) then fail to resolve as real modules,
// and the whole build throws. `package.json` alone resolves correctly
// (that subpath IS a granted export, unlike the deep dist path this
// redirects to), so it is the anchor for finding the real entry file
// on disk regardless of how node_modules happens to be laid out.
function toastUiEditorResolveFix(): import("bun").BunPlugin {
  const pkgDir = dirname(Bun.resolveSync("@toast-ui/editor/package.json", import.meta.dir));
  const realEntry = join(pkgDir, "dist/esm/index.js");
  return {
    name: "toast-ui-editor-resolve-fix",
    setup(build) {
      build.onResolve({ filter: /^@toast-ui\/editor$/ }, () => ({ path: realEntry }));
    },
  };
}

// The Description tab's own bundle (spec 292): same shape as
// `queueClientScript()` above — cached, `format: "iife"`, fail-open on
// a build error — so a failed build degrades to the plain textarea
// rather than breaking the page. Its own CSS travels inside this same
// bundle (see `spec-editor-client.ts`'s own comment on why), so this
// one string is genuinely the whole payload. `minify: true` because the
// unminified payload is ~900 KB — nothing `queueClientScript()` bundles
// is remotely this size, so it has never needed this.
let specEditorScript: Promise<string | undefined> | null = null;
export function specEditorClientScript(): Promise<string | undefined> {
  if (specEditorScript !== null) return specEditorScript;
  specEditorScript = Bun.build({
    entrypoints: [join(import.meta.dir, "../../spec-editor-client.ts")],
    target: "browser",
    format: "iife",
    minify: true,
    plugins: [toastUiEditorResolveFix()],
  })
    .then((result) => (result.success ? result.outputs[0]?.text() : undefined))
    .catch(() => undefined); // the page still works: the plain textarea takes over
  return specEditorScript;
}

export const SPEC_EDITOR_ASSET_PATH = "/spec-editor.js";

// A pure function on purpose (spec 315, REQ-2, second clause: "a new
// version of the dashboard SHALL still reach a browser holding an old
// copy"): two different texts MUST produce two different ETags, which
// is what makes a stale If-None-Match (computed by a browser against a
// PRIOR process's build) fall through to the 200/fresh-body path below
// rather than a wrongly-served 304.
export function etagFor(text: string): string {
  return `"${Bun.hash(text).toString(16)}"`;
}

// REQ-1/REQ-2: served at a fixed path, revalidated by ETag rather than
// re-sent whole — the same cache-control sw.js already uses below — so
// a browser holding a copy asks "still this?" instead of downloading
// ~770 KB again, and a new build (a fresh process, REQ-5) answers with
// a different ETag and the full body.
let specEditorAsset: Promise<{ text: string; etag: string } | undefined> | null = null;
function buildSpecEditorAsset(): Promise<{ text: string; etag: string } | undefined> {
  if (specEditorAsset !== null) return specEditorAsset;
  specEditorAsset = specEditorClientScript().then((text) =>
    text === undefined ? undefined : { text, etag: etagFor(text) },
  );
  return specEditorAsset;
}

export async function serveSpecEditorAsset(req: Request): Promise<Response> {
  const built = await buildSpecEditorAsset();
  if (!built) return new Response("not found", { status: 404 });
  const headers = new Headers({
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-cache",
    etag: built.etag,
  });
  if (req.headers.get("if-none-match") === built.etag) return new Response(null, { status: 304, headers });
  return new Response(built.text, { headers });
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
