// The aide-dashboard server (spec 80): serves the generated static
// site, receives aide-run events (POST /api/aide-run), and renders
// /live through the generator's layout, enriched lazily from
// claude-usage's /api/live. Replaces the python3 static server on the
// serving host — same port, same launchd label.
//
// CLI: serve --site DIR [--port N] [--claude-usage URL] [--mirror FILE]

import { createHash, timingSafeEqual } from "node:crypto";
import {
  closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, watch,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { AideRunStore, parseAideRun } from "./aide-run-store.ts";
import {
  BranchStatusChecker, createGitRunner, projectCheckout, specBranch, DEFAULT_TTL_MS,
  type GitRunner,
} from "./branch-status.ts";
import {
  DescriptionFreshnessChecker,
  SpecCreatedAtChecker,
  SpecFileCommitChecker,
  lastCommitOf,
} from "./description-freshness.ts";
import { WorkflowHistoryChecker, stepsFileDisagreesOn } from "./workflow-history.ts";
import { mergeBranchIntoDefault, type RepoMergeResult } from "./branch-merge.ts";
import { pullFastForward, saveSpecFile, saveSpecFiles } from "./specs-pull.ts";
import {
  CheckoutEnsurer,
  DEFAULT_DASHBOARD_CHECKOUT_ROOT,
  dashboardCheckoutRoot,
  dashboardSpecDir,
  ensureDashboardCheckout,
  type DashboardCheckout,
} from "./dashboard-checkout.ts";
import { LiveEnricher } from "./live.ts";
import {
  SPEC_FILES, buildProjectViews, configValue, discoverProjects, discoverUnclaimedDirectories,
  gitignoreCandidates, resolveCodeLanding, resolveWorktreeLinks, specArchivedDate, specDependsOn,
  specDurationMs, specFileText, specPhaseFile, stampDuration, stripDependsOnLine, withDependsOnLine,
  type CodeLanding, type DiscoveredProject, type SpecRef,
} from "./discover.ts";
import { parseManifest, type ManifestData } from "./parse-manifest.ts";
import { specPhaseOutcome, type PhaseOutcome } from "./parse-phase-outcome.ts";
import { projectSettings } from "./project-settings.ts";
import { previewUrlFor } from "./preview-url.ts";
import {
  archiveHeldBackReason, clearArchiveHeldBack, parseStatus, parseStatusChecks, tickStatusLine,
} from "./parse-status.ts";
import { Notifier } from "./notify.ts";
import { MergeEventReporter } from "./merge-event.ts";
import {
  QueueStore, currentWorkRoundJobs, mergeBranchRefs, mergeQueueDefaults, parseQueueProjects,
  persistQueueModelDefaults, persistQueueProjects,
  tailEdits,
  type BranchRef, type Job, type ModelChoice, type QueueDefaults, type ProjectResolver,
  type WorkflowStep,
} from "./queue.ts";
import {
  addProject,
  addProjectTarget,
  assessProjectReadiness,
  projectNameError,
  removeProject,
  suggestSpecsPath,
  suggestWorktreeLinksFromLockfile,
  updateProjectSettings,
  type ProjectReadiness,
  type ProjectStep,
} from "./project-admin.ts";
import { Runner, type StepOutcome } from "./runner.ts";
import { summarizeStream } from "./parse-stream.ts";
import {
  ABOUT_PAGE,
  APPLE_TOUCH_ICON,
  APP_ICON,
  APP_ICON_MASKABLE,
  NEW_SPEC_ROUTE,
  OVERVIEW_PAGE,
  PROJECTS_ROUTE,
  FILTER_FIELD_PREFIX,
  FILTER_KEYS,
  FROM_LIST_FIELD,
  filterShowsArchived,
  navEntries,
  renderJobDetailPage,
  renderNewSpecPage,
  renderProjectPage,
  renderProjectsPage,
  renderAddProjectPage,
  renderRemoveProjectPage,
  renderSettingsPage,
  SETTINGS_ROUTE,
  SETTINGS_STEPS,
  ADD_PROJECT_ROUTE,
  PHASE_LINES,
  computeSpecTotalDurationMs,
  phasesFor,
  renderQueuePage,
  renderQueueRows,
  renderSpecPage,
  renderResetSpecPage,
  SERVICE_WORKER,
  WEBMANIFEST,
  specPagePath,
  specTabPath,
  EDITABLE_SPEC_FILE,
  STATUS_SPEC_FILE,
  type ArchivedSpecView,
  type JobDetailView,
  type SpecFileView,
  type SpecPageView,
  type NavEntry,
  type ProjectDrift,
  type QueueRowView,
  type QueueTarget,
} from "./render.ts";

const MAX_BODY = 4096;

/** What the save route accepts instead (spec 162). A description is not
 *  an action post: this spec's own `1-description.md` was 4182 raw
 *  bytes before a single character of form-urlencoding overhead, so
 *  `MAX_BODY` would have refused the very file the editor was written
 *  for. 64 KiB is roughly fifteen times that — headroom for a
 *  description that grows, without becoming an unbounded body on a
 *  token-gated internal server. */
const MAX_SAVE_BODY = 65536;

/** How long the project's own install may run after its code merged.
 *  The same bounded-timeout discipline every git call already has
 *  (`createGitRunner`): a hung install must not tie up a request
 *  handler, whatever the server's idle timeout is set to. */
const INSTALL_TIMEOUT_MS = 60_000;

// The caps decided in spec 81: deliberately tight. An `analyze` step
// fits; an `implement` on Opus will stop early, on purpose, until the
// per-step value is raised from a measurement.
const QUEUE_DEFAULTS: QueueDefaults = {
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

export interface ServerOptions {
  siteDir: string;
  port: number;
  claudeUsageUrl?: string;
  claudeUsageFetch?: typeof fetch;
  mirrorPath?: string;
  // Nav entries for /live: derived from --root's manifests when given,
  // else from the site dir's project pages.
  navEntries?: NavEntry[];
  /** Where to listen. Default 0.0.0.0; the mini pins its Tailscale
   *  address, the way claude-usage's plist does. */
  bindHost?: string;
  /** Without it the queue surface answers 503: off loudly, rather than
   *  open quietly. */
  queueToken?: string;
  queueMirrorPath?: string;
  /** Root scanned for `.aide/project.yaml` — the queue resolves project
   *  NAMES against it, so a request never carries a path. */
  projectRoot?: string;
  /** The allowlist. Empty or absent means no project may be queued.
   *  Seeded from `--queue-projects` on a first install and from
   *  `queue-config.json`'s `projects` field after that; mutated live by
   *  the Add/Remove routes (spec 112). */
  queueProjects?: string[];
  /** Where that allowlist is PERSISTED — the `--queue-config` file.
   *  Threaded through from `parseArgs` because the routes that change
   *  the allowlist have to write it back, and a config path that stops
   *  at `parseArgs` leaves them with nowhere to write (spec 112). */
  queueConfigFile?: string;
  queueDefaults?: QueueDefaults;
  /** Path to `aide-run-spec`. Without it the queue only stores jobs —
   *  nothing is ever started, and the page says so. */
  queueRunnerBin?: string;
  /** Where each allowlisted project is checked out on this machine —
   *  the checkout a PERSON edits. Read for display; never written to
   *  since spec 205. */
  queueProjectRoot?: string;
  /** Where the dashboard keeps the clones it works in (spec 205). One
   *  per project, made the first time it is needed. Defaults to
   *  `~/aide-dashboard-checkouts`; named here so a test can put them
   *  somewhere it owns. */
  dashboardCheckoutRoot?: string;
  queueResultDir?: string;
  /** How far a finished step publishes its work: none, branch or pr.
   *  From the queue config; `branch` when unset. */
  queuePush?: string;
  /** How many steps may run at once. From the queue config's
   *  `concurrency`; two when unset. */
  queueConcurrency?: number;
  /** argv for the gate notifier — claude-usage's contract, run with no
   *  shell. Absent means no notifications are sent. */
  queueNotifyCommand?: string[];
  /** Where to report a landed branch, so claude-usage's ledger can see a
   *  merge no transcript records (spec 158). From the queue config's
   *  `mergeEventUrl`. Absent means nothing is ever sent — and absent it
   *  must stay absent, unlike `claudeUsageUrl`, which `createServer`
   *  always resolves to a default and so can never be off. */
  mergeEventUrl?: string;
  /** How that report is sent. A test seam, like `gitRun`. */
  mergeEventFetch?: typeof fetch;
  /** How the merge check runs git. A test seam: the real one spawns a
   *  subprocess, which no test should. */
  gitRun?: GitRunner;
  /** How long the project's own install command may run after its code
   *  merged. A test seam above all — the default is a bound, not a
   *  setting anybody is expected to tune. */
  queueInstallTimeoutMs?: number;
  /** How often the drift check asks origin how far each project's
   *  checkout has fallen behind (spec 203). It is a SCHEDULE, not a
   *  cache window: the page render reads the last answer and never
   *  takes one itself. `0` turns the schedule off entirely — a test
   *  seam, for observing the never-checked row without racing a timer.
   *  Omitted, it is the checker's own TTL, which is the window the
   *  answer was already considered current for. */
  driftPollMs?: number;
  /** How often the spec caches are refilled (spec 208). Like
   *  `driftPollMs` it is a SCHEDULE, not a cache window: every page
   *  render reads the last answer and never takes one itself. `0` turns
   *  the schedule off entirely — a test seam, for observing a page that
   *  has never been warmed without racing a timer. Omitted, it is the
   *  checkers' own TTL, which is the window each answer was already
   *  considered current for. */
  specCachePollMs?: number;
  runnerAvailable?: boolean;
}

function json(body: unknown, status = 200): Response {
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
async function readBounded(
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
const ARCHIVED_REFUSAL = "this spec is archived — it is a record, and cannot be edited";

/** What a Save's commit RECORDS. Two routes since spec 212 — the
 *  description's own Save and the checks' — and each writes one file,
 *  so each has one sentence. There was a third, for the one commit that
 *  could carry both; two files can no longer arrive in one request, so
 *  it has nothing left to describe.
 *
 *  Never the runner's grammar: `workflow-history.ts` counts a step by a
 *  commit subject beginning "Run /aide-", and a hand edit is not a step
 *  the spec has had. */
const editMessage = (specFolder: string): string =>
  `Edit ${EDITABLE_SPEC_FILE} for ${specFolder} from the dashboard`;
const tickMessage = (specFolder: string): string =>
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
function specsRedirect(
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
function logRefusal(action: string, spec: string | undefined, reason: string): void {
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
function navFromSite(siteDir: string): NavEntry[] {
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
function tokenMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

function cookieValue(header: string | null, name: string): string | null {
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
const SORT_COOKIE = "aide_sort";

function sortChoice(url: URL, req: Request): { sort?: string; dir?: string; setCookie?: string } {
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
function bodyToObject(text: string, contentType: string | null): unknown {
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
    for (const numeric of ["budgetUsd", "jobCapUsd", "timeoutSec"]) {
      if (typeof out[numeric] === "string") out[numeric] = Number(out[numeric]);
    }
    return out;
  }
  return JSON.parse(text) as unknown;
}

// Page code is TypeScript (src/queue-client.ts); the browser needs
// JavaScript. Transpile once, on first use, and keep it — Bun has the
// transpiler in-process, so this needs no build step and no bundle
// checked into the repo.
let queueScript: string | null = null;
function queueClientScript(): string | undefined {
  if (queueScript !== null) return queueScript || undefined;
  try {
    const source = readFileSync(join(import.meta.dir, "queue-client.ts"), "utf-8");
    queueScript = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(source);
  } catch {
    queueScript = ""; // the page still works: the noscript refresh takes over
  }
  return queueScript || undefined;
}

// The tail of a file, without reading the rest of it. A 25-minute
// implement run's transcript is not something a page render should ever
// pull into memory whole — and the tail is the part that answers "what
// is it doing". The first line of the window is usually cut in half;
// parse-stream drops what does not parse, so it costs nothing.
const STREAM_TAIL_BYTES = 256 * 1024;

function tailFile(path: string, maxBytes = STREAM_TAIL_BYTES): string {
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

function serveStatic(siteDir: string, pathname: string): Response {
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

const GATED = new Set<string>(DEPENDENCY_GATED_STEPS);

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

export function createServer(opts: ServerOptions) {
  const store = new AideRunStore({ mirrorPath: opts.mirrorPath });
  const enricher = new LiveEnricher({
    baseUrl: opts.claudeUsageUrl ?? "http://localhost:8787",
    fetch: opts.claudeUsageFetch,
  });
  const nav = () => opts.navEntries ?? navFromSite(opts.siteDir);

  // Project names resolve through a short-lived scan: fresh enough that
  // a new spec shows up, cheap enough for a page that refreshes.
  const allowed = new Set(opts.queueProjects ?? []);
  let scan:
    | {
        at: number;
        targets: QueueTarget[];
        archived: string[];
        dirs: Map<string, string>;
        refs: Map<string, SpecRef>;
        /** Where each project's specs are checked out (spec 193). Off
         *  the same walk, because the landing's verification and the
         *  archived-with-an-open-branch set both ask origin about the
         *  specs repo as well as the code one — and re-walking the
         *  projects root to learn a path this scan already read would
         *  be a second answer to a settled question. */
        specsRoots: Map<string, string>;
      }
    | null = null;
  const targets = (): QueueTarget[] => {
    const now = Date.now();
    if (scan && now - scan.at < 5000) return scan.targets;
    const found: QueueTarget[] = [];
    const gone: string[] = [];
    // Where every spec's four files are, ARCHIVED ONES INCLUDED (spec
    // 150). `targets` deliberately drops an archived spec — a ghost row
    // outliving the spec is what that costs — but the archive job that
    // moved it still has a page, and that page's whole content is the
    // stamp in the folder it moved to.
    const dirs = new Map<string, string>();
    // And WHAT each of them is, from the same walk (spec 163). `targets`
    // is live-only by design, so the page of an ARCHIVED spec looked its
    // title up in a list that could not hold it and rendered no
    // description line at all — silently, because the H1 comes from the
    // folder name. One lookup answers the title and whether the spec is
    // archived, for every spec there is.
    const refs = new Map<string, SpecRef>();
    const specsRoots = new Map<string, string>();
    if (opts.projectRoot) {
      for (const p of discoverProjects(opts.projectRoot, ownedSpecsRoot)) {
        if (!allowed.has(p.name)) continue;
        specsRoots.set(p.name, p.specsRoot);
        for (const s of p.specs) {
          dirs.set(`${p.name}/${s.folder}`, s.dir);
          refs.set(`${p.name}/${s.folder}`, s);
          // Remembered by key: a create job keeps its group visible
          // while its spec has not landed, and "archived" is the one
          // proof that it HAS — without it the ghost row outlives the
          // spec (seen with 111/112 on 2026-08-19).
          if (s.archived) {
            gone.push(`${p.name}/${s.folder}`);
            continue;
          }
          // What a reader needs to CHOOSE a spec: what it is called and
          // how far it has got. Both are already on disk.
          let statusText = "";
          try {
            statusText = readFileSync(join(s.dir, "4-status.md"), "utf-8");
          } catch {
            statusText = "";
          }
          const status = statusText ? parseStatus(statusText) : null;
          // Read from the SAME content, not a second pass over the file:
          // both answers come out of `4-status.md` and there is no
          // reason for the page to open it twice.
          const heldBack = statusText ? archiveHeldBackReason(statusText) : null;
          found.push({
            project: p.name,
            specFolder: s.folder,
            // Where the freshness check runs git. Never rendered — the
            // page has no use for an absolute path, and `targets` is
            // server-side only.
            dir: s.dir,
            title: s.title ?? undefined,
            description: s.description ?? undefined,
            // What its own 1-description.md says it builds on (spec 92),
            // shown on its row in the same words the run's dependency
            // refusal uses.
            dependsOn: s.dependsOn,
            phase: status?.phase ?? undefined,
            // The FILES, and nothing else (spec 108). It used to be
            // unioned with the queue's own record of what it ran, so
            // either one being true was enough — which is how an
            // archive job that finished without moving anything counted
            // as an archived spec, and how a phase could read "done" on
            // a row whose files said otherwise. What a job reported is
            // still shown, as a qualifier — in the row's own panel since
            // spec 195, not on the phase's line.
            //
            // One line of that file, and no inference from any other
            // (spec 139): each step writes its own name into
            // `4-status.md` once it has succeeded. The three heuristics
            // this replaces — the size of 2-analysis.md, a heading in
            // 3-solution.md, and 4-status.md's own progress percentage,
            // which used to be read on this line — each answered a
            // question next to the one being asked, and the first of
            // them marked spec 138 analysed before any analyze had run.
            // The percentage left the row entirely in spec 167.
            //
            // Since spec 154 the line is no longer the ANSWER, only a
            // claim: a model has to reach its last instruction to write
            // it and a copied folder brings a sibling's version along.
            // `withFreshness` fills `done` in from the runner's own
            // commits, and this is what it compares them against.
            fileSteps: status?.workflowSteps ?? [],
            // Where this spec's history starts, when it has been
            // reopened (spec 198). Read off the same content as
            // `fileSteps` and `heldBack`, for the same reason: three
            // answers out of `4-status.md` and no second pass over the
            // file.
            reopenedAfter: status?.reopenedAfter,
            archiveHeldBack: heldBack ? { reason: heldBack } : undefined,
          });
        }
      }
    }
    scan = { at: now, targets: found, archived: gone, dirs, refs, specsRoots };
    return found;
  };

  /** `project/folder` of every ARCHIVED spec whose own `aide/<folder>`
   *  is STILL on origin in one of its two roots (spec 193).
   *
   *  Being archived used to answer "did this spec finish" with
   *  certainty. It does not: three specs reached the archive with their
   *  code sitting on a branch and every row saying done. This is the
   *  exception, and the same set answers both halves of it — which rows
   *  survive archiving on the specs list, and which archive rows carry
   *  the not-landed mark. One source, two readers.
   *
   *  Refreshed by `refreshSpecCaches` on a schedule of its own (spec
   *  208) — never inside a request, and never on the enqueue path. It
   *  used to be rebuilt by the two routes that already awaited git, and
   *  that is precisely how a network `ls-remote` per project root came
   *  to sit inside `GET /`. A root the schedule has not reached yet
   *  contributes NOTHING, exactly as an unanswerable one does, so a
   *  re-run enqueued against an unwarmed set still fails CLOSED.
   *
   *  The filter is the BRANCH, deliberately, and not the job's
   *  `errorReason`: 146 carried no reason at all, and a stale reason on
   *  an old job would resurrect a row for a spec that is genuinely
   *  finished. */
  let unlanded: string[] = [];

  /** The SUBSET of `unlanded` that is open on purpose (spec 220): a
   *  project whose manifest says `codeLanding: pr` archives with its
   *  code branch still on origin, for as long as the review takes.
   *
   *  A subset, not a set of its own, and deliberately: every existing
   *  reader of `unlanded` goes on seeing exactly what it saw — the row
   *  stays on the specs list, and `archive` stays enqueueable for it —
   *  and what splits is only what the two pages CALL it. `NOT_LANDED`
   *  reads as an instruction to run archive again; this state is an
   *  instruction to go and review something, and a page that says the
   *  first about the second is worse than saying nothing.
   *
   *  Only when the branch is open in the CODE root alone. A specs root
   *  that still holds it is a landing that genuinely did not finish —
   *  the specs merge is never gated, in any mode — and calling that a
   *  review would hide the one failure this whole check exists to
   *  catch. */
  let prOpen: string[] = [];

  /** The two repositories a spec's work can be open in — the same pair
   *  the dependency gate asks across, and for the same reason: a spec
   *  merged in the code repo but not in the specs repo is not merged. */
  const specRoots = (project: string): string[] => {
    const code = machineryProjectDir(project);
    const specs = machinerySpecsRoot(project);
    const both = specs && resolve(specs) !== resolve(code) ? [code, specs] : [code];
    // Only roots that are THERE. A project with no specs root configured
    // resolves to `<project>/specs`, and two projects on this host have
    // never had one — asking git about a directory that does not exist
    // is not an unanswerable question, it is a question about nothing.
    return both.filter((d) => existsSync(d));
  };

  /** Which of a project's roots still have `branch` on origin. A root
   *  that cannot be ASKED contributes nothing: an unanswerable question
   *  is not evidence, either way. */
  const rootsStillHolding = async (
    project: string,
    branch: string,
    fresh: boolean,
  ): Promise<string[]> => {
    const held: string[] = [];
    for (const root of specRoots(project)) {
      const open = await branchStatus.openSpecBranches(root, fresh);
      if (open?.has(branch)) held.push(root);
    }
    return held;
  };

  /** Rebuild `unlanded` from one `ls-remote` per ROOT — never one per
   *  spec. The archived keys come off the scan the page already keeps,
   *  and the intersection is done in memory. */
  const peekUnlanded = (): string[] => {
    targets();
    const keys = scan?.archived ?? [];
    if (keys.length === 0) {
      prOpen = [];
      return (unlanded = []);
    }
    const byProject = new Map<string, string[]>();
    for (const key of keys) {
      const cut = key.indexOf("/");
      const project = key.slice(0, cut);
      const list = byProject.get(project);
      if (list) list.push(key.slice(cut + 1));
      else byProject.set(project, [key.slice(cut + 1)]);
    }
    const found: string[] = [];
    const reviewing: string[] = [];
    for (const [project, folders] of byProject) {
      const open = new Set<string>();
      // Kept apart from the union above (spec 220): which ROOT holds a
      // branch is what tells "waiting on a review" from "the landing did
      // not finish", and folding the roots together loses it.
      const elsewhere = new Set<string>();
      const codeRoot = machineryProjectDir(project);
      const pr = codeLanding(project) === "pr";
      // A specs root INSIDE the project is the same repository, so it
      // holds the same one branch and answers `ls-remote` identically —
      // `specRoots` asks it separately because it compares paths, not
      // repos. Counting that as a second root would call every
      // single-repo project's review a failed landing, and paceup and
      // atlasaurus are both shaped that way.
      const separate = (root: string): boolean =>
        root !== codeRoot && !resolve(root).startsWith(resolve(codeRoot) + sep);
      for (const root of specRoots(project)) {
        // A root nobody has asked about yet peeks `null`, and `?? []`
        // makes it contribute nothing — the same way an unanswerable
        // one already did. That is what keeps this failing closed
        // without any new logic to get wrong.
        for (const branch of branchStatus.peekOpenSpecBranches(root).open ?? []) {
          open.add(branch);
          if (separate(root)) elsewhere.add(branch);
        }
      }
      for (const folder of folders) {
        const branch = specBranch(folder);
        if (!open.has(branch)) continue;
        found.push(`${project}/${folder}`);
        if (pr && !elsewhere.has(branch)) reviewing.push(`${project}/${folder}`);
      }
    }
    prOpen = reviewing;
    return (unlanded = found);
  };

  /** When the set was last taken, for the archive page's own label: an
   *  answer this old is SHOWN with its age rather than withheld, the
   *  same treatment `driftNote` gives the commits-behind count. The
   *  OLDEST of the roots asked, because the badge speaks for all of
   *  them, and `null` where any root has never been asked at all. */
  const peekUnlandedCheckedAt = (): number | null => {
    targets();
    const keys = scan?.archived ?? [];
    let oldest: number | null = null;
    for (const key of keys) {
      for (const root of specRoots(key.slice(0, key.indexOf("/")))) {
        const { checkedAt } = branchStatus.peekOpenSpecBranches(root);
        if (checkedAt === null) return null;
        oldest = oldest === null ? checkedAt : Math.min(oldest, checkedAt);
      }
    }
    return oldest;
  };

  /** A spec's folder on this host, archived or not. Goes through
   *  `targets()` so it shares the 5-second scan rather than walking the
   *  projects root again — but what it returns is only WHERE the files
   *  are; the files themselves are read fresh on every request, which
   *  is the whole point of the Update button. */
  const specDir = (project: string, specFolder: string): string | undefined => {
    targets();
    return scan?.dirs.get(`${project}/${specFolder}`);
  };
  /** What that spec IS — its title, and whether it has been archived
   *  (spec 163). Through the same 5-second scan `specDir` goes through,
   *  and unlike `targets()` it answers for an archived spec too. */
  const specRef = (project: string, specFolder: string): SpecRef | undefined => {
    targets();
    return scan?.refs.get(`${project}/${specFolder}`);
  };
  /** What a spec's `Depends on:` line RESOLVES to, folder by folder
   *  (spec 174) — which boxes the Edit page's picker ticks.
   *
   *  Through `resolveDependencyFolder`, the same reader the save route
   *  and the runtime gate use, because the line is written by hand as
   *  often as by the page and `164` is what a person types. An
   *  identifier nothing matches simply ticks nothing: this is a form
   *  being drawn, not a run being gated, and the refusal for a typo
   *  belongs to Save and to `aide-run-spec`.
   *
   *  Not `targets()`: an entry may name an already-archived spec, which
   *  that scan drops. Such an entry ticks no box either — the picker
   *  offers live specs only — but it must not be mistaken for one that
   *  resolves to a live one. */
  const dependencyFolders = (project: string, dir: string): string[] => {
    const ids = specDependsOn(dir);
    if (ids.length === 0 || !opts.projectRoot) return [];
    const discovered = discoverProjects(opts.projectRoot).find((p) => p.name === project);
    if (!discovered) return [];
    return ids.flatMap((id) => {
      const dep = resolveDependencyFolder(discovered, id);
      return dep && !dep.archived ? [dep.folder] : [];
    });
  };

  /** The checkout a spec folder sits in — the lock key for everything
   *  that touches the specs repository (spec 162).
   *
   *  `createRootLock`'s own docstring says what it is for: "per repo
   *  ROOT, not global: two requests that touch no directory in common
   *  cannot collide." The Update button was locking on `specDir(...)`,
   *  the individual spec's subfolder, and every project and every spec
   *  in a specs checkout shares ONE `.git` — so two presses on
   *  different specs were given different keys and ran two git
   *  sequences in one working tree. Latent while the only write was a
   *  fast-forward merge; not latent beside a Save that writes, commits
   *  and pushes.
   *
   *  Read-only and outside the lock, which is where it has to be: it is
   *  what decides which lock to take. A directory git will not answer
   *  for keys on itself, which is what the routes did before and is no
   *  worse — the save's own first question refuses it by name. */
  const specsRoot = async (dir: string): Promise<string> => {
    const top = await gitRun(dir, ["rev-parse", "--show-toplevel"]);
    return top.code === 0 && top.stdout.trim() ? top.stdout.trim() : dir;
  };

  /** The dashboard's own copy of the spec folder the display found
   *  (spec 205). Save COMMITS and PUSHES, and Update merges — all three
   *  are writes, and the checkout a person edits stopped taking writes
   *  from the dashboard.
   *
   *  The translation is needed rather than a second closure because the
   *  routes do not resolve a project root at all: `specDir()` hands them
   *  a directory off the scan of the projects root, and what they need
   *  is the same folder inside the clone the dashboard owns.
   *
   *  Falls back to the person's folder when there is no such clone —
   *  see `ensureCheckout`: a project the dashboard cannot clone keeps
   *  working exactly as it did before this spec. */
  const machinerySpecDir = async (project: string, dir: string): Promise<string> => {
    // The cached answer where there is one: this runs on every spec
    // page, every edit form and every save, and `ensureDashboardCheckout`
    // spawns git twice to work out where a project's specs are. Boot,
    // the runner's tick and the Settings route all re-ensure, so a
    // specs root that moves still reaches this map.
    const checkout = resolvedCheckouts.get(project) ?? (await ensureCheckout(project));
    if (!checkout) return dir;
    targets();
    const personSpecs = scan?.specsRoots.get(project);
    const translated = personSpecs ? dashboardSpecDir(checkout, personSpecs, dir) : null;
    return translated ?? dir;
  };

  /** The same translation, without ever awaiting a clone (spec 208).
   *
   *  `ensureCheckout` is started at boot for every allowed project, but
   *  a clone of this very repo measured 4.3 s (spec 205's own analysis)
   *  — so a spec page opened during the first minutes of a restart
   *  joined that promise and held the reader for its whole duration,
   *  showing the OLD page unchanged while it did. That is the literal
   *  shape of "the app answers at once and never waits on git" stated
   *  as a bug.
   *
   *  So "not made yet" now behaves exactly as "cannot be made" already
   *  did: fall back to the person's own folder, which is what every
   *  project used before spec 205 existed and what a project the
   *  dashboard cannot clone still uses. The clone goes on in the
   *  background and the next view reads through it.
   *
   *  READ paths only, and only the ones with no form on them.
   *  `machinerySpecDir` is untouched and its other callers still await:
   *  the spec page's own Description TAB (spec 212, where `/edit` used
   *  to be) has to read through the SAME checkout Save will later write
   *  through, or Save's compare-stamp check refuses as "changed since
   *  you opened it" the first time anyone edits a spec shortly after a
   *  restart. */
  const peekMachinerySpecDir = (project: string, dir: string): string => {
    const checkout = resolvedCheckouts.get(project);
    if (!checkout) {
      // Started, not waited on — so a page opened before the boot-time
      // ensure settles still gets the clone going for the next one.
      void ensureCheckout(project);
      return dir;
    }
    targets();
    const personSpecs = scan?.specsRoots.get(project);
    return (personSpecs ? dashboardSpecDir(checkout, personSpecs, dir) : null) ?? dir;
  };

  const resolveProject: ProjectResolver = (project) => {
    if (!allowed.has(project)) return null;
    const folders = targets().filter((t) => t.project === project).map((t) => t.specFolder);
    // The way out (spec 193). An archived spec whose branch is still on
    // origin can have `archive` enqueued again — the runner hands that
    // step the open merge, the skill resolves it, and the landing that
    // follows merges cleanly. Nothing else about an archived spec
    // changes: edit and save stay refused by name, and a spec whose
    // branch is gone is refused exactly as before.
    const prefix = `${project}/`;
    for (const key of unlanded) {
      if (key.startsWith(prefix)) folders.push(key.slice(prefix.length));
    }
    // The second way out (spec 198). An archived spec can be REOPENED,
    // and the control for it is on the archived spec's own page — so the
    // resolver has to name a folder `targets()` deliberately drops.
    //
    // In a list of its OWN, never appended to `specFolders`: that list
    // is what every step is checked against, and widening it would take
    // spec 193's guarantee with it — an archived spec whose branch has
    // been landed is refused, and has to stay refused, for `archive`.
    // `parseJobRequest` admits this list for `reopen` alone.
    //
    // `scan` is filled by the `targets()` call above, so this never
    // reads a stale set.
    const archived: string[] = [];
    for (const key of scan?.archived ?? []) {
      if (key.startsWith(prefix)) archived.push(key.slice(prefix.length));
    }
    return folders.length > 0 || archived.length > 0
      ? { specFolders: folders, archivedFolders: archived }
      : null;
  };
  // --- spec 189: the pages that are watching --------------------------------
  //
  // One held-open response per open tab. The event is a SIGNAL and
  // carries nothing: the browser already knows how to fetch a fresh
  // `#jobrows`, so `renderQueueRows` stays the one place a row is
  // described and there is no second format to keep in step with it.
  // What travels the wire is "go and look".
  const encoder = new TextEncoder();
  const watchers = new Set<ReadableStreamDefaultController<Uint8Array>>();

  /** Write to one watcher, and forget it the moment it refuses. A tab
   *  that has gone away throws on enqueue, and a broadcast that let
   *  that through would stop at the first dead page and leave every
   *  live one unaware — the same fail-open the rest of this surface
   *  keeps (`LiveEnricher`, `branch-status`). */
  const writeTo = (c: ReadableStreamDefaultController<Uint8Array>, text: string): void => {
    try {
      c.enqueue(encoder.encode(text));
    } catch {
      watchers.delete(c);
    }
  };

  /** Something a row is drawn from moved. Called from the queue's own
   *  write hook below and from `POST /api/aide-run` — the two sources a
   *  row reads, and the second is invisible to the first. A copy of the
   *  set is walked because `writeTo` removes from it. */
  const notifyQueueChanged = (): void => {
    for (const c of [...watchers]) writeTo(c, "event: changed\ndata: {}\n\n");
  };

  // --- spec 204: a spec is a folder, and a folder changes no job -----------
  //
  // The two callers above are both the queue's own: a job moving, and
  // `POST /api/aide-run`. A spec created any other way — a `git pull`,
  // a hand-run `/aide-create`, a headless run's commit landing — writes
  // a directory and touches no job at all, so nothing was told and the
  // page stayed as it was until somebody reloaded it. Four specs added
  // on 2026-08-23 spent the day invisible that way.
  //
  // Each allowed project's specs root, and nothing wider: a recursive
  // watch on the projects root would fire on every `.git` internal,
  // `node_modules` entry and build artefact in every checked-out
  // project — the ground moving under the reader constantly, which is
  // the cost spec 189 already removed once.
  //
  // One echo comes with it, and is deliberately left alone: FSEvents
  // hands a fresh recursive watcher the changes made in the
  // milliseconds before it opened, so a server started right after
  // something wrote in a specs root broadcasts once at start-up. A page
  // open at that moment redraws once — which a reconnect already does —
  // and a page opened afterwards never hears it.
  const specWatchers = new Map<string, ReturnType<typeof watch>>();
  let notifySoon: ReturnType<typeof setTimeout> | null = null;
  /** A `git pull` writes a hundred files; the page needs telling once. */
  const scheduleNotify = (): void => {
    if (notifySoon) clearTimeout(notifySoon);
    notifySoon = setTimeout(() => {
      notifySoon = null;
      // Before the event, never after: the page answers by asking for
      // the rows, and those come off a scan cached for five seconds.
      // Told to redraw and handed the same list it already had, it
      // would sit there with nothing further coming.
      scan = null;
      notifyQueueChanged();
    }, 300);
  };
  if (opts.projectRoot) {
    for (const p of discoverProjects(opts.projectRoot)) {
      if (!allowed.has(p.name)) continue;
      try {
        specWatchers.set(p.name, watch(p.specsRoot, { recursive: true }, scheduleNotify));
      } catch {
        // A specs root that is missing or cannot be watched: the same
        // fail-open the git checks in this file already keep. The
        // five-second scan still catches up on the next redraw anything
        // else causes — only the "no reload needed" promise degrades.
      }
    }
  }
  /** Every watcher opened above, closed. Called by `stop()`, which runs
   *  before a test removes the directories they point at. */
  const closeSpecWatchers = (): void => {
    if (notifySoon) clearTimeout(notifySoon);
    notifySoon = null;
    for (const w of specWatchers.values()) {
      try {
        w.close();
      } catch {
        // already gone, which is the outcome either way
      }
    }
    specWatchers.clear();
  };

  // Built after `resolveProject`, which it takes. Nothing above it reads
  // it any more: `targets` used to ask the queue what it had run, and
  // spec 108 made the spec's own files the only answer to that.
  const queue = new QueueStore({
    mirrorPath: opts.queueMirrorPath,
    defaults: opts.queueDefaults ?? QUEUE_DEFAULTS,
    resolve: resolveProject,
    // The RAW allowlist, and only for creating (spec 93).
    // `resolveProject` requires a spec that already exists, which a
    // project's first spec by definition does not have — but that
    // requirement is right for every other route, so it is left exactly
    // as it is rather than widened for all of them.
    allowCreateProject: (project) => allowed.has(project),
    // Every write to a job passes through this store, so one hook here
    // covers the runner's step transitions, the page's own presses and
    // the API's alike (spec 189).
    onChange: notifyQueueChanged,
  });

  // The runner exists only when a binary is configured. Spawned
  // DETACHED, in its own process group: measured on the mini, such a
  // child survives `launchctl bootout`, so a redeploy does not kill a
  // run — and the group is what SIGTERM must reach, since claude spawns
  // children of its own.
  const notifier = new Notifier({ command: opts.queueNotifyCommand });
  // What tells claude-usage a branch landed (spec 158). Inert without a
  // URL, and never given a default one: a dashboard nobody has pointed
  // at a claude-usage makes no request at all.
  const mergeEvents = new MergeEventReporter({ url: opts.mergeEventUrl, fetch: opts.mergeEventFetch });
  // Two resolutions since spec 205, and every caller picks one
  // deliberately. `displayProjectDir` is the checkout a PERSON edits —
  // what the spec list, the project pages and the manifests are read
  // from, and the only thing it is ever used for. Nothing here writes to
  // it: a run that branched, merged and pushed from the directory
  // somebody was working in is what stranded three specs' code on
  // 2026-08-23.
  const displayProjectDir = (project: string) => projectCheckout(opts.queueProjectRoot, project);
  // Where the dashboard's OWN clones live. Named as an option so a test
  // can put them in a temp directory; there is no other reason to move
  // them.
  const checkoutBase = opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT;
  // The other resolution: the checkout a RUN is cut from, a landing
  // merges into, and Save commits in. One `existsSync`, so the readers
  // that only need to know WHERE it is — the drift poll's key, the
  // origin check's root — cost nothing and await nothing.
  //
  // FALLS BACK to the person's checkout while the dashboard has none of
  // its own. That is not a shortcut, it is the upgrade path: a project
  // added before this spec, or one whose clone cannot be made at all,
  // goes on working exactly as it did instead of losing its runs, its
  // Save and its Update the day this ships. `ensureCheckout` is what
  // moves it over, and the readiness check is where a clone that cannot
  // be made is reported by name.
  const machineryProjectDir = (project: string): string => {
    const owned = dashboardCheckoutRoot(checkoutBase, project);
    return existsSync(join(owned, ".git")) ? owned : displayProjectDir(project);
  };
  /** Whether this project's archived code merges into its default branch
   *  or waits for a pull request (spec 220), read fresh off the
   *  MACHINERY's checkout — the one a run is cut from and a landing
   *  merges in, so the answer is the one the work is actually done
   *  against.
   *
   *  Read per call rather than cached: it is one small YAML file, the
   *  same cost class as the `4-status.md` reads `targets()` already does
   *  per spec, and an operator changing the choice on the settings page
   *  should see the next job honour it rather than the next restart. */
  const codeLanding = (project: string): CodeLanding => resolveCodeLanding(machineryProjectDir(project));

  /** What `ensureCheckout` last worked out, so the SYNC readers can ask
   *  where a project's own specs are without awaiting a clone. Empty
   *  until the first ensure settles, which is what the fallback below is
   *  for. */
  const resolvedCheckouts = new Map<string, DashboardCheckout>();
  /** Where a project's spec folders are LISTED from (spec 218): the
   *  dashboard's own checkout once one has been resolved, and nothing
   *  otherwise — `discoverProjects` then walks the person's own, exactly
   *  as everything did before spec 205.
   *
   *  The same source a run resolves `--spec` against, which is the whole
   *  point: a folder committed in the person's checkout and never pushed
   *  used to get a row offering four steps, and every one of them
   *  refused with `unknown spec`. Sync and cache-only on purpose — a
   *  render never waits on a clone (spec 208), and `refreshSpecCaches`
   *  is what keeps the answer current.
   *
   *  Passed to every walk that lists specs FOR A READER, and to no
   *  other: the `fs.watch` loop watches the person's own checkout for
   *  local edits and must go on watching it, and `refreshDrift` reads
   *  nothing off the walk but `p.name`. */
  const ownedSpecsRoot = (project: string): string | undefined => resolvedCheckouts.get(project)?.specs;
  /** The specs root the machinery works in: the dashboard's own once it
   *  has one, and otherwise the scan's answer — the person's, which is
   *  the root everything used before this spec. */
  const machinerySpecsRoot = (project: string): string | undefined => {
    const owned = resolvedCheckouts.get(project);
    if (owned) return owned.specs;
    targets();
    return scan?.specsRoots.get(project);
  };
  /** The last thing said about each project, so a refusal that has not
   *  changed is not said again. Every tick asks, and a project whose
   *  origin is unreachable would otherwise fill the log with one line
   *  every two seconds for as long as the server runs. */
  const saidAbout = new Map<string, string>();
  const complain = (project: string, said: string): void => {
    if (saidAbout.get(project) === said) return;
    saidAbout.set(project, said);
    console.error(`queue: the dashboard's own checkout of ${project} — ${said}`);
  };
  const checkoutEnsurer = new CheckoutEnsurer((project) =>
    ensureDashboardCheckout(gitRun, {
      base: checkoutBase,
      project,
      personDir: displayProjectDir(project),
    })
      .then((result) => {
        if (result.ok) saidAbout.delete(project);
        else complain(project, result.error ?? "it could not be made");
        if (result.checkout) resolvedCheckouts.set(project, result.checkout);
        return result.checkout;
      })
      .catch((err) => {
        complain(project, String(err));
        return undefined;
      }),
  );
  /** Make the dashboard's own checkout if it is not there, and answer
   *  where it is. One promise per project at a time: two requests
   *  arriving together must not run two `git clone`s into one directory.
   *
   *  A project whose clone CANNOT be made — no origin, an unreachable
   *  one — answers `undefined`, and every caller falls back to the
   *  checkout it used before this spec. That keeps a project the
   *  dashboard cannot clone working exactly as it always did instead of
   *  losing Save and Update outright; the readiness check is where that
   *  state is reported, by name, on the project's own page. */
  const ensureCheckout = (project: string): Promise<DashboardCheckout | undefined> => checkoutEnsurer.get(project);
  // One runner, two users now: the read path asks whether a branch
  // landed, the write path lands it.
  const gitRun: GitRunner = opts.gitRun ?? createGitRunner();
  const branchStatus = new BranchStatusChecker({ run: gitRun });
  // How long ONE spec answer stands, and how often it is retaken, are
  // the same number since spec 208 — because nothing but the schedule
  // takes them any more. Two numbers here is how a fast schedule
  // starves: every tick inside the window finds the entry still current
  // and asks git nothing, so the answer never moves.
  //
  // `0` means the schedule is OFF, which is a test seam and not a
  // window — the checkers keep their own default there, so an answer
  // put in by hand still stands.
  const specCachePollMs = opts.specCachePollMs ?? DEFAULT_TTL_MS;
  const specCacheTtlMs = specCachePollMs > 0 ? specCachePollMs : DEFAULT_TTL_MS;
  // Spec 203: the drift check runs on a schedule of its own, and the
  // page render reads whatever it last found. This loop IS the loop
  // that used to sit inside the `GET /projects` handler — nothing about
  // its logic changed, only when it runs. It ran there on every cache
  // miss, which is every project on boot and every project again each
  // time the window expired, and a page load waited on a `git fetch`
  // against GitHub per project: /projects measured 1.83 s against 0.04 s
  // for the pages beside it, and got slower with every project added.
  //
  // Asked only of the projects that expect an install to have happened
  // — deploying is a known hand step where none is configured, and a
  // banner there would be noise on every row forever.
  async function refreshDrift(): Promise<void> {
    if (!opts.projectRoot) return;
    await Promise.all(
      buildProjectViews(opts.projectRoot).map(async (p) => {
        const root = machineryProjectDir(p.name);
        if (!configValue(root, "AIDE_INSTALL_CMD")) return;
        // Each call try/catches internally and degrades to null, so one
        // project's unreachable origin never takes the others with it.
        await branchStatus.commitsBehindOrigin(root);
      }),
    );
  }
  // The checker's own TTL by default: the window the answer was already
  // considered current for is the window worth re-taking it in.
  const driftPollMs = opts.driftPollMs ?? DEFAULT_TTL_MS;
  // `.unref()`'d and cleared in `stop()`, like the runner's tick and the
  // SSE keep-alive below — `bun test` runs many suites in one process,
  // and a timer from a stopped test's server would go on firing into
  // the next one.
  const driftTimer =
    driftPollMs > 0
      ? (() => {
          void refreshDrift();
          return setInterval(() => void refreshDrift(), driftPollMs);
        })()
      : null;
  driftTimer?.unref?.();
  // One merge at a time per repo. Every spec shares the specs root, and
  // two specs in one project share that repo too, so two presses a few
  // milliseconds apart were two git sequences in one working tree.
  const mergeLock = createRootLock();
  // A third user of the same runner: has the description moved on since
  // the plan was written?
  const freshness = new DescriptionFreshnessChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a fourth: which steps this spec has actually had (spec 154).
  const workflowHistory = new WorkflowHistoryChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // A fifth: when the spec was MADE (spec 199). Git rather than the
  // queue, because the job store forgets a job once two hundred newer
  // ones exist and the folder's first commit is still there years on.
  const specCreatedAt = new SpecCreatedAtChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a sixth (spec 208): which commit last touched each spec file.
  // The spec page asked this four times per view with no cache of its
  // own — the one question here that was added without the treatment
  // every sibling already had.
  const specFileCommits = new SpecFileCommitChecker({ run: gitRun, ttlMs: specCacheTtlMs });

  /** Everything git can say about ONE spec, asked and cached. Written
   *  once because two callers need it: the schedule below walks every
   *  live spec through it, and `stampTotalDuration` warms the single
   *  archived spec it is about before reading the peeks (spec 208 —
   *  that path is a landing, not a render, and it needs a real answer
   *  rather than "not yet known"). */
  async function warmSpec(t: { dir?: string; specFolder: string; reopenedAfter?: string }): Promise<void> {
    if (!t.dir) return;
    const dir = t.dir;
    await Promise.all([
      workflowHistory.read(dir, t.specFolder, t.reopenedAfter),
      freshness.isStale(dir, t.specFolder, t.reopenedAfter),
      specCreatedAt.createdAt(dir, t.specFolder),
      ...SPEC_FILES.map((file) => specFileCommits.commitFor(dir, file)),
    ]);
  }

  /** Spec 208: the ONE schedule that feeds every peek on every page.
   *
   *  This is `refreshDrift`'s shape (spec 203) applied to the rest of
   *  the app. The same fix had been made three times, one page each —
   *  178 wrote it for the whole app and was never merged, 203 shipped
   *  it for `/projects`, and 193 put a network `ls-remote` back on the
   *  spec list's render path the next day. What each of those loops
   *  did inside a request, this does on a schedule; nothing about the
   *  questions changed, only when they are asked.
   *
   *  Two sweeps, and the difference between them is deliberate:
   *
   *  - Every LIVE spec, in full. That set is bounded by what is on the
   *    board, and it is the set every row of `/` draws from.
   *  - Every root that holds an archived spec, for the one network
   *    question (`openSpecBranches`), plus the archive DATE of an
   *    archived spec whose `4-status.md` carries no stamp — a small and
   *    shrinking set, since the archive step has written the stamp
   *    since spec 147. Warming an archived spec the way a live one is
   *    warmed is the unbounded cost spec 178's own plan review
   *    rejected, and is not done.
   *
   *  The roots go out CONCURRENTLY, unlike the `for`-loop this
   *  replaces: that loop paid one TCP/TLS round trip to GitHub per
   *  root, one after another, inside `GET /`. Nothing is holding its
   *  breath for the answer any more, so there is no reason to.
   *
   *  A spec that leaves `targets()` — archived, or removed — simply
   *  stops being walked; its last cached answer is left where it is
   *  and nothing asks about it again. */
  let warming = false;
  async function refreshSpecCaches(): Promise<void> {
    // The tick does strictly more work than `refreshDrift`, so the
    // single-flight guard is explicit rather than implied: two ticks
    // running at once would double the in-flight subprocess and network
    // count on a machine that also runs the jobs.
    if (warming) return;
    warming = true;
    try {
      const live = targets();
      const archivedKeys = scan?.archived ?? [];
      const roots = new Set<string>();
      const archivedDirs: string[] = [];
      for (const key of archivedKeys) {
        const cut = key.indexOf("/");
        for (const root of specRoots(key.slice(0, cut))) roots.add(root);
        const dir = scan?.dirs.get(key);
        // Only the ones git would be asked about anyway: a spec whose
        // status file already stamps the date never reaches git at all.
        if (dir && !specArchivedDate(dir)) archivedDirs.push(dir);
      }
      await Promise.all([
        // Each call try/catches internally and degrades to null or to
        // nothing-known, so one unreachable origin never takes the
        // others with it.
        ...[...roots].map((root) => branchStatus.openSpecBranches(root)),
        ...archivedDirs.map((dir) => specFileCommits.commitFor(dir, ".")),
        ...live.map((t) => warmSpec(t)),
        // And the checkout the LIST is read from (spec 218). Every other
        // caller of `ensureCheckout` is a project that has something
        // going on — a job queued (spec 216's `tickRunner`), a spec page
        // open, a Save. A project with none of that had its checkout
        // fetched once at boot and never again, so a spec pushed from
        // another machine would have sat unlisted for as long as the
        // server ran rather than until the next poll.
        //
        // Here rather than in the routes, for the same reason as
        // everything else in this function: a render reads what the
        // schedule last found, and never waits on git itself.
        // `ensureCheckout` deduplicates per project and fails open, so a
        // project whose origin is unreachable costs one complaint, once.
        ...[...allowed].map((project) => ensureCheckout(project)),
      ]);
    } finally {
      warming = false;
    }
  }
  // `.unref()`'d and cleared in `stop()` like every other timer in this
  // file — `bun test` runs many suites in one process, and a timer from
  // a stopped test's server would go on firing into the next one.
  const specCacheTimer =
    specCachePollMs > 0
      ? (() => {
          void refreshSpecCaches();
          return setInterval(() => void refreshSpecCaches(), specCachePollMs);
        })()
      : null;
  specCacheTimer?.unref?.();
  const runner = opts.queueRunnerBin
    ? new Runner({
        store: queue,
        projectDir: machineryProjectDir,
        runnerBin: opts.queueRunnerBin,
        resultDir: opts.queueResultDir ?? join(homedir(), "aide-dashboard", "jobs"),
        maxConcurrent: opts.queueConcurrency ?? DEFAULT_QUEUE_CONCURRENCY,
        now: () => new Date().toISOString(),
        today: () => new Date().toISOString().slice(0, 10),
        spawn: (job, step, resultFile, sessionId, streamFile) => {
          mkdirSync(dirname(resultFile), { recursive: true });
          // Spec 222. `aide-emit-run` reports each TDD phase and is
          // inert unless `AIDE_RUN_URL` says where — so a headless step
          // reported into silence, because nothing from launchd down to
          // the spawned `claude` ever set it. This server knows its own
          // address, so it tells the step where to report, and no
          // machine needs configuring for it.
          //
          // `server` is declared further down this function, but this
          // callback is only ever CALLED from the polling
          // `runner.tick()` timer — long after `Bun.serve()` has
          // returned — so the read is never a TDZ error. It has to be
          // `server.port` and not `opts.port`: `port: 0` means "let the
          // OS pick", and every test in this suite starts that way.
          const selfRunUrl = `http://127.0.0.1:${server.port}/api/aide-run`;
          const proc = Bun.spawn({
            cmd: runnerArgv(
              job,
              step,
              resultFile,
              {
                runnerBin: opts.queueRunnerBin!,
                projectDir: machineryProjectDir(job.project),
                // Spec 220. The global setting speaks for every project
                // on this host at once; a project that reviews its code
                // says so in its own committed manifest, and that
                // answer wins. It only ever raises the mode TO `pr` —
                // `merge` is the absence of an opinion, not an
                // instruction to publish less than the host asked for.
                //
                // Both halves have to travel together: `landBranch`
                // below stops merging this project's code root, and a
                // branch left open with no pull request describing it
                // is worse than either behaviour on its own. Read per
                // spawn, off disk, the same way `projectManifest` is
                // read per render — one small YAML file, and an edit
                // takes effect on the next job rather than the next
                // deploy.
                push: codeLanding(job.project) === "pr" ? "pr" : (opts.queuePush ?? "branch"),
                modelChoices: queue.defaults.modelChoices,
                timeoutSec: queue.defaults.timeoutSec,
                permissionMode: queue.defaults.permissionMode,
                model: queue.defaults.model,
              },
              sessionId,
              streamFile,
            ),
            // The spread is load-bearing. `Bun.spawn`'s `env`, once
            // given at all, REPLACES the child's environment rather
            // than layering onto it, and this call passed none before —
            // so the child inherited PATH, HOME and the credentials
            // `git` and `claude` need implicitly. An operator who has
            // already pointed reporting at another sink keeps it: the
            // derived URL is a default, never an override.
            env: { ...process.env, AIDE_RUN_URL: process.env.AIDE_RUN_URL ?? selfRunUrl },
            detached: true,
            // stdout is ignored (the result FILE is the contract), but
            // stderr goes to a per-job log: when the runner died
            // mid-job the first time, nothing on this machine said why.
            stdio: ["ignore", "ignore", Bun.file(`${resultFile}.log`)],
          });
          proc.unref();
          return { pid: proc.pid, pgid: proc.pid };
        },
        isAlive: (pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        readResult: (path) => {
          try {
            return JSON.parse(readFileSync(path, "utf-8")) as unknown;
          } catch {
            return null;
          }
        },
        notify: (event) => notifier.notify(event),
        // A step's work is invisible to this page until its branch is on
        // the default branch of the checkout the page reads — so every
        // step lands the work it produced, and nobody merges by hand
        // (spec 149). `create` and `archive` already did (specs 93 and
        // 136); `analyze` writes in the specs
        // repo exactly as those two do, so the same argument covers it
        // and it was simply never given it.
        //
        // `implement` is the one exception, and it is deliberate: the
        // code stays on the pushed branch, which is where a person tests
        // it — by leaving `archive` unticked. `archive` is therefore the
        // one step that sends CODE to a default branch, which is why it
        // has a landing of its own.
        //
        // The returned promise holds the queue for as long as the
        // landing takes; see `Runner.tick()`.
        onStepDone: (job, step, outcome) => {
          if (outcome.ok) {
            if (step === "create") return landNewSpec(job, outcome);
            // `reopen` lands for exactly the reason `analyze` does, and
            // for it the argument is not an improvement but the whole
            // feature (spec 198): the un-archived folder is what makes
            // the spec active again, this page reads the MAIN checkout,
            // and a reopen left on its branch would show nowhere at all
            // — "reopening is one action" would then still end with
            // somebody in a terminal.
            if (step === "analyze" || step === "reopen" || step === "reset") {
              return landStepBranch(job, step, outcome);
            }
            if (step === "archive") return landArchivedSpec(job, outcome);
            // `implement`, `explore` and `manifest` fall through: the first
            // by design, the other two because neither leaves a spec branch
            // for anyone to land.
            return undefined;
          }
          // A step stopped by its own clock still committed and pushed
          // whatever it had written before the deadline — `aide-run-spec`'s
          // commit loop runs on every path and the push is gated on the
          // push mode, not on `ok` (spec 187). Left on the branch, that
          // work is readable only by checking it out by hand: spec 184
          // stopped with a finished analysis nothing on this page
          // mentioned.
          //
          // What decides is what the run TOUCHED, never which step it
          // was. A run that moved a code root's HEAD is left exactly
          // where a failed run is left — the code waits on its branch for
          // `archive`, whether the step ran out of time or not — and there
          // is no second list of "which steps are safe" to keep in step
          // with the first.
          //
          // The wall clock and a provider limit both stop after the
          // runner has committed the work. A cost cap and a CLI error
          // have no such safe landing promise.
          if (
            !step ||
            (outcome.terminalReason !== "timeout" && outcome.terminalReason !== "provider-limit")
          ) return undefined;
          const codeRoots = new Set([machineryProjectDir(job.project)]);
          const pushed = outcome.branchUrls ?? [];
          if (pushed.length === 0 || pushed.some((r) => codeRoots.has(r.root))) return undefined;
          return landStoppedStepBranch(job, step, outcome);
        },
        clearResult: (path) => {
          try {
            rmSync(path, { force: true });
          } catch {
            /* nothing to clear */
          }
        },
      })
    : null;

  /** Which queued jobs are waiting on a dependency that has not merged
   *  yet (spec 122) — job id → the folder it is waiting for.
   *
   *  The same question `aide-run-spec`'s guard asks, asked HERE so the
   *  answer arrives before a job is spawned rather than after: a job
   *  that reached the script was refused, marked `failed`, and had to be
   *  pressed again by hand (97 three times, 102 twice, against
   *  dependencies that merged minutes later).
   *
   *  Computed fresh immediately before every `tick()`, never cached
   *  across calls: a job enqueued a line of code ago must be judged
   *  against data that existed after it did. And since spec 213 the
   *  merge answer under it is asked fresh too (`isMerged(..., true)`),
   *  which is what makes that sentence true: a 30 s cached answer
   *  released two jobs against a dependency that had not landed, and
   *  the script — which asks origin every time — refused them. Only
   *  `targets()` is still cached here, for 5 s, and it decides nothing
   *  on its own: a spec that names no dependency is the cheap half. */
  async function blockedDependencies(): Promise<Map<string, string>> {
    const blocked = new Map<string, string>();
    if (!opts.projectRoot) return blocked;
    const waiting = queue.list().filter((job) => {
      if (job.state !== "queued") return false;
      const step = job.steps[job.stepIndex];
      return step !== undefined && GATED.has(step);
    });
    if (waiting.length === 0) return blocked;
    // The cheap half first, off the scan the page already keeps: a spec
    // that names nothing costs neither a walk of the specs root nor a
    // git call, the same way a spec without the field asks origin
    // nothing in the script.
    const named = new Map(targets().map((t) => [`${t.project}/${t.specFolder}`, t.dependsOn ?? []]));
    if (!waiting.some((j) => (named.get(`${j.project}/${j.specFolder}`) ?? []).length > 0)) return blocked;

    // Not `targets()`: that drops archived specs, and an archived
    // dependency is precisely the case that must resolve — to
    // "satisfied", without asking origin anything.
    const projects = new Map(discoverProjects(opts.projectRoot).map((p) => [p.name, p]));
    for (const job of waiting) {
      const project = projects.get(job.project);
      const spec = project?.specs.find((s) => s.folder === job.specFolder && !s.archived);
      if (!project || !spec) continue;
      for (const id of spec.dependsOn) {
        const dep = resolveDependencyFolder(project, id);
        // An unknown identifier, or the spec itself: both are refusals
        // the script makes on its own, and neither is something waiting
        // could ever fix. Parking on one would hide a typo forever.
        if (!dep || dep.folder === spec.folder) continue;
        // Archiving only ever happens to finished work, so an archived
        // dependency is merged by definition — the script's own
        // shortcut, and it costs no network.
        if (dep.archived) continue;
        const branch = specBranch(dep.folder);
        // Every root a run of this spec touches, as the script asks
        // across `roots`: a dependency merged in the code repo but not
        // in the specs repo is not merged. Both are asked either way —
        // `&&` short-circuiting would leave the second answer uncached
        // and the next tick asking again.
        let merged = true;
        for (const root of specRoots(job.project)) {
          merged = (await branchStatus.isMerged(root, branch, true)) && merged;
        }
        if (!merged) {
          blocked.set(job.id, dep.folder);
          break;
        }
      }
    }
    return blocked;
  }

  /** Every `tick()` goes through here: the map has to be computed with
   *  the queue as it is at that instant, so there is no version of this
   *  that a caller may skip. */
  async function tickRunner(): Promise<void> {
    if (!runner) return;
    // Spec 205: nothing may be STARTED in a checkout that is not there.
    // Every project with a job waiting, and only those — a clone is
    // made once and the call is a map lookup ever after, so this costs
    // one `existsSync` per waiting project per tick.
    //
    // Spec 216: `fresh`, not `get`. This is the one caller that may not
    // be handed a bring-up-to-date that was already running when it
    // asked — such a fetch took its picture of origin before this job
    // was queued, and a spec pushed in between is one the step will
    // refuse as unknown. `CheckoutEnsurer` explains what that costs.
    await Promise.all([...new Set(queue.list().filter((j) => j.state === "queued").map((j) => j.project))]
      .map((project) => checkoutEnsurer.fresh(project)));
    runner.tick(await blockedDependencies());
  }

  // And on boot, before anything is queued: an already-added project
  // meets this spec for the first time on some restart, and the clone
  // it needs should not land in the middle of the first request that
  // wants it. Fire and forget — a clone that fails says so on the
  // project's own readiness line, and the server serves either way.
  for (const project of allowed) void ensureCheckout(project);

  // On boot, resolve every job left `running` by the last restart
  // before anything new is started.
  runner?.reconcile();
  const timer = runner
    ? setInterval(() => {
        runner.poll();
        void tickRunner();
      }, 2000)
    : null;
  timer?.unref?.();

  // Bun cuts a connection that has said nothing for `idleTimeout` (120
  // seconds, set on `Bun.serve` below for slow git work), and a page
  // watching a quiet queue is exactly such a connection. A comment
  // every 45 seconds keeps it open and costs the page nothing: an SSE
  // client ignores a line that starts with a colon.
  //
  // `.unref()` like the runner's timer, so it never holds the process
  // up — and cleared in `stop()` besides, because `bun test` runs many
  // suites in one process and a timer from a stopped test's server
  // would go on firing into the next one.
  const keepAlive = setInterval(() => {
    for (const c of [...watchers]) writeTo(c, ": ping\n\n");
  }, 45_000);
  keepAlive.unref?.();

  const queueToken = opts.queueToken;
  // `/specs/<id>` joins the guarded set HERE, never as a special case
  // further down: a read route outside the guard is exactly the silent
  // bypass this check exists to prevent. The retired `/queue` paths are
  // guarded too — a redirect that answers before the token is checked
  // would tell an unauthenticated caller the page exists.
  const isQueuePath = (path: string) =>
    path === "/" ||
    // The overview is a served page since spec 115, and it carries the
    // Add and Remove forms — so it is guarded exactly as `/` is. The
    // GENERATED `projects.html` stays outside the guard, as every
    // generated page does: it is a redirect and carries nothing.
    path === PROJECTS_ROUTE ||
    // The Add and Remove pages carry real forms too (2026-08-19).
    path.startsWith("/projects/") ||
    // And the New-spec form's own page (spec 121), for the same
    // reason: it carries a real form, and a form's token has to be
    // checked per request.
    path === NEW_SPEC_ROUTE ||
    path === SETTINGS_ROUTE ||
    path === "/queue" ||
    path === "/specs" ||
    path === "/api/queue" ||
    path.startsWith("/api/queue/") ||
    path.startsWith("/queue/") ||
    path.startsWith("/specs/");

  // The WHOLE queue surface is behind the token, read routes included:
  // a token that a page hands to anyone who can load the page is not a
  // secret. `POST /api/aide-run` is exempt on purpose — spec 80's
  // emitter sends no credential and swallows the answer, so a 401 there
  // would silently empty /live.
  function queueGuard(req: Request, url: URL): Response | null {
    if (!queueToken) {
      return new Response("the queue is off: no token is configured on this server\n", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const provided =
      req.headers.get("x-aide-token") ??
      url.searchParams.get("token") ??
      cookieValue(req.headers.get("cookie"), "aide_token");
    if (tokenMatches(provided, queueToken)) return null;
    return new Response(
      "unauthorized\n\n" +
        "This needs its token. Open /?token=<the token> once and the\n" +
        "browser keeps it in a cookie; API callers send it as X-Aide-Token.\n" +
        "The token lives in the file this server was started with.\n",
      { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.bindHost ?? "0.0.0.0",
    // Bun cuts an idle connection after 10 seconds when this is unset,
    // and a two-repo merge under load takes longer than that: the
    // browser got an empty reply and its own error page while the merge
    // itself completed. Every other route here answers in well under a
    // second, so raising the ceiling costs them nothing.
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (isQueuePath(path)) {
        const denied = queueGuard(req, url);
        if (denied) return denied;
        return handleQueue(req, url, path);
      }

      if (path === "/api/aide-run") {
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        const body = await readBounded(req);
        if ("refusal" in body) return body.refusal;
        let raw: unknown;
        try {
          raw = JSON.parse(body.text);
        } catch {
          return json({ error: "malformed json" }, 400);
        }
        const parsed = parseAideRun(raw);
        if (!parsed.ok) return json({ error: parsed.error }, 400);
        const stored = store.put(parsed.run, new Date().toISOString());
        // The second source a row reads (spec 189). Cost, subagent
        // count and live state arrive here and nowhere near the queue's
        // own store, so a push driven by that store alone would let
        // them sit still for the whole of a long step.
        notifyQueueChanged();
        return json({ ok: true, sessionId: stored.sessionId });
      }

      if (path === "/api/aide-runs") {
        if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
        const { rows, enriched } = await enricher.rows(store);
        return json({ generatedAt: new Date().toISOString(), enriched, rows });
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 });
      }

      // What makes this page an app you install (spec 173): five
      // answers built in `render/pwa.ts` and served from memory, the
      // same shape /api/aide-run has — a computed string, an explicit
      // content type, no file on disk. None of them is behind the
      // token, deliberately: the manifest fetch that drives the install
      // prompt does not always carry the cookie, and a worker whose
      // script answers 401 never installs at all. There is nothing in
      // any of them a reader could not already see in the page's own
      // <head>.
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

      return serveStatic(opts.siteDir, path);
    },
  });

  // Which repos this ONE job has a branch in. A job written before spec
  // 89 has `branchUrl` and no `branchUrls`; synthesising a one-entry
  // list from it reproduces the old single-repo behaviour verbatim,
  // rather than making every pre-existing job's link vanish on deploy.
  const jobBranches = (job: Job): BranchRef[] =>
    job.branchUrls?.length
      ? job.branchUrls
      : job.branchUrl
        ? [{ root: machineryProjectDir(job.project), url: job.branchUrl }]
        : [];

  // A repo's directory basename — `aide`, `aide-specs` — which is the
  // vocabulary the problem was described in. The full path is never sent
  // to the browser: the server re-derives every root itself on a POST.
  const repoLabel = (root: string): string => root.split(sep).filter(Boolean).pop() ?? root;

  // Read FRESH, per render, not once at startup: adding
  // `deployment.preview` to a manifest is an edit to a text file, and it
  // should show on the next page load rather than the next deploy. Same
  // cost class as the `4-status.md` reads `targets()` already does per
  // spec. No manifest, or an unreadable one, is not an error worth a
  // page over — it simply means this project has nothing to preview.
  const projectManifest = (project: string): ManifestData | undefined => {
    try {
      const text = readFileSync(join(displayProjectDir(project), ".aide", "project.yaml"), "utf-8");
      const result = parseManifest(text);
      return result.ok ? result.data : undefined;
    } catch {
      return undefined;
    }
  };

  async function jobRow(job: ReturnType<QueueStore["list"]>[number]): Promise<QueueRowView> {
    // The step whose model the row is about: the one running, or the
    // last one for a job that has finished.
    const step = job.steps[job.stepIndex] ?? job.steps[job.steps.length - 1];
    // Asked of EACH repo's own checkout. Asking the project's own root
    // about a branch that lives in the specs repo was not merely a
    // missing warning: a stale remote-tracking ref of the same name in
    // the project answered it cleanly, and the page said "merged" about
    // work that was not (1-description.md, "Measured again").
    const branch = specBranch(job.specFolder);
    // Asked of the project's OWN checkout only. A spec pushes a branch
    // of the same name to the repo holding its plan, and a plan is not
    // something anyone can open and try — the same distinction the merge
    // button already draws, drawn the same way, by comparing roots.
    const codeRoot = machineryProjectDir(job.project);
    const preview = projectManifest(job.project)?.deployment?.preview;
    const branchUrls = await Promise.all(
      jobBranches(job).map(async (b) => ({
        label: repoLabel(b.root),
        url: b.url,
        ...(b.root === codeRoot && { previewUrl: previewUrlFor(preview, branch) }),
      })),
    );
    return {
      id: job.id,
      project: job.project,
      specFolder: job.specFolder,
      // What a create job's row is called while its folder is still a
      // provisional key: `new-abc123de` says nothing to anyone.
      createTitle: job.createTitle,
      steps: job.steps,
      stepIndex: job.stepIndex,
      // Spec 160: which of them the row may still be given or relieved
      // of. Asked of the queue's own module, so the box and the route
      // that takes its tick cannot disagree about where the tail
      // starts.
      editableSteps: tailEdits(job),
      state: job.state,
      landing: job.landing,
      model: step ? resolveStepModel(job, step, queue.defaults.model) : job.modelChoice,
      spentUsd: job.spentUsd,
      // The stored split is five numbers; the page shows one. Flattened
      // here, at the boundary, so no render file has to know what a
      // result file looks like (spec 118).
      spentTokens: job.spentTokens,
      // One number, for the step this row speaks for: `stateLabel` puts
      // it into words ("stopped — 45 min") and has no step to resolve
      // against of its own.
      timeoutSec: resolveTimeoutSec(job.timeoutSec, step ?? "default", queue.defaults.timeoutSec),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      branchUrls,
      // Spec 220: stored on the job, not derived here like `branchUrls`
      // — only the run that called `gh` knows the URL, and there is
      // nothing on this machine to work it out from.
      prUrl: job.prUrl,
      prError: job.prError,
      stopReason: job.stopReason,
      error: job.error,
      // Why the landing was refused, when it was refused for something
      // the row can act on. Stored on the job (spec 149), because a
      // landing has no browser to redirect the reason to.
      errorReason: job.errorReason,
      // Which third of an implement is running (spec 210). Only for
      // `implement`, which is the one step that reports its phases, and
      // only off the job's LIVE `sessionId` — the queue clears that the
      // moment a step ends, so a finished job cannot pick up a leftover
      // row from the session it once used.
      tddPhase:
        step === "implement" && job.state === "running" && job.sessionId
          ? store.get(job.sessionId)?.phase
          : undefined,
      results: job.results.map((r) => ({
        step: r.step, ok: r.ok, costUsd: r.costUsd, tokens: r.tokens?.total,
        // When the step ENDED (spec 199). The only per-step instant
        // there is — a job has one `startedAt` however many steps it
        // ran — so it is what a phase's own duration is sliced out of.
        at: r.at,
        // Carried, not dropped: the totals the list and the overview tab
        // build out of these results have no other way to know a figure
        // they are summing was over-charged (spec 152).
        costMeasured: r.costMeasured,
      })),
    };
  }

  /** What a landing does that is not the merge itself: what to write on
   *  the job when it worked, and what to say when it did not. Everything
   *  else — which repos, the retries, the per-repo report — is the same
   *  for every step, and is `landBranch`'s. */
  interface Landing {
    /** Beyond the standard `branchUrl`/`branchUrls`/`error` reset. A
     *  create step renames the job off its provisional key; an archive
     *  step has nothing to add. */
    landed?: Partial<Job>;
    /** What to say when the run pushed no branch at all. For `create`
     *  that IS the failure — the spec exists only on a branch that was
     *  never reported. For `archive` a HEAD that never moved is an
     *  ordinary outcome, so it says nothing and leaves no error. */
    nothingToLand?: string;
    /** The catch-all message, which has to name the step: "landing it
     *  failed" alone leaves a reader guessing what "it" was. */
    failedNote: (why: string) => string;
    /** Which repos to land. Absent means the step's own outcome, which
     *  is right for every landing but archive's — see
     *  `landArchivedSpec` for why that one has to look further. */
    repos?: BranchRef[];
    /** Which step's landing this is. Only the merge event reads it
     *  (spec 158), and it is taken from the call site rather than
     *  derived: `landStepBranch` already HAS the step as a parameter,
     *  and a second value worked out from the outcome would be a second
     *  thing that could be wrong. */
    step: WorkflowStep;
    /** What to do once the merge has actually landed — after the job
     *  has been updated and the scan invalidated, and only then (spec
     *  207). `archive`'s alone today: it writes what the spec cost in
     *  time into `4-status.md`, and a spec whose branch did not land is
     *  not archived, so there would be nothing to record.
     *
     *  Never fatal and never rethrown, exactly like `installAfterMerge`
     *  in the same function: the merge already happened, and turning a
     *  landed archive into a failed job would hand back a task nobody
     *  can act on. */
    onLanded?: () => Promise<void>;
  }

  /** Merge a step's own branch into the default branch of every repo it
   *  pushed to, and report per repo — the landing every self-landing
   *  step shares (specs 93, 136 and 149).
   *
   *  The branch and, by default, the repos come from the RESULT, never
   *  from `specBranch(...)` or `queue.branchesFor(...)`. Two reasons,
   *  one per caller: a create step's folder did not exist when its
   *  branch was named, and `onStepDone` runs SYNCHRONOUSLY inside
   *  `complete()`, before the runner has written this step's own
   *  `branchUrls` into the store — so a spec whose first-ever queue job
   *  is the one landing would find that history empty. The outcome in
   *  hand has neither problem. Archive is the one caller that has to
   *  look further, and says so itself (`what.repos`).
   *
   *  Every merge goes through `mergeLock`, one repo at a time. Four
   *  steps land themselves now, and two specs sharing one specs repo can
   *  finish within seconds of each other under queue concurrency — which
   *  is the collision the lock exists to serialize. `create` merged
   *  outside it until spec 149, which was survivable only because it was
   *  one of two rare self-landings.
   *
   *  Plan first, code last, for the same reason the manual route sorted
   *  them: a run records the project before its specs root, so a reader
   *  watching the page saw the code land before the plan describing it,
   *  and the code is the one that matters. */
  async function landBranch(job: Job, outcome: Partial<StepOutcome>, what: Landing): Promise<void> {
    try {
      const branch = outcome.branch;
      // Code roots last. `sort` is stable, so two repos of the same kind
      // keep the order the run recorded them in.
      const codeRoots = new Set([machineryProjectDir(job.project)]);
      const repos = [...(what.repos ?? outcome.branchUrls ?? [])].sort(
        (a, b) => Number(codeRoots.has(a.root)) - Number(codeRoots.has(b.root)),
      );
      /** Roots this landing deliberately does not merge (spec 220): a
       *  project whose manifest says `codeLanding: pr` has its CODE
       *  reviewed before it reaches the default branch, and the run has
       *  already opened the pull request.
       *
       *  `archive` alone, by the literal step name, and the code root
       *  alone. `create` and `analyze` never reach a code root in a
       *  gated position, and the specs root is bookkeeping — an archive
       *  commit moving a folder is not a change anyone reviews, and the
       *  description scopes this to the code. */
      const leaveOpen = (root: string): boolean =>
        what.step === "archive" && codeRoots.has(root) && codeLanding(job.project) === "pr";
      if (!branch || repos.length === 0) {
        if (what.nothingToLand) queue.update(job.id, { error: what.nothingToLand });
        return;
      }
      const failures: string[] = [];
      // Which refusal it was, when it is one the row can offer a way out
      // of. A conflict is the only one a `resolve` step could finish.
      let reason: Job["errorReason"];
      for (const repo of repos) {
        if (leaveOpen(repo.root)) {
          // Nothing merged, nothing deleted, nothing installed: the code
          // is on its branch, which is where the review happens, and
          // installing it here would deploy exactly the change the
          // review exists to hold back.
          console.error(
            `queue: landing ${job.project}/${job.specFolder} in ${repo.root} — left open for review (codeLanding: pr)`,
          );
          continue;
        }
        const base = await branchStatus.defaultBranch(repo.root);
        if (!base) {
          // Guessing which branch to merge INTO is the one guess with no
          // safe direction.
          failures.push(`cannot work out the default branch in ${repo.root}`);
          continue;
        }
        // Up to three tries with a pause: this landing races the runs
        // that pull the same checkout (index.lock, a briefly stale
        // main), and both 111 and 112 were left stranded by giving up
        // on the first loss. A real conflict fails all three the same
        // way and is reported as before.
        //
        // The lock goes around the git-mutating call and nothing else:
        // `defaultBranch` above only asks a question, and holding the
        // root while asking it would serialize page loads too.
        const merge = () => mergeLock.run(repo.root, () => mergeBranchIntoDefault(gitRun, repo.root, branch, base));
        let result = await merge();
        for (let retry = 0; !result.ok && retry < 2; retry++) {
          await new Promise((r) => setTimeout(r, 700 * (retry + 1)));
          result = await merge();
        }
        if (result.ok) {
          branchStatus.invalidate(repo.root, branch);
          // Say what just happened, to whoever is listening (spec 158).
          // Once per repo whose merge SUCCEEDED — not once per landing,
          // and not only for code roots: a spec-markdown merge is
          // exactly the kind claude-usage cannot see today, so it is
          // reported the same as any other. `report` never throws and
          // never retries; a sink that is down costs this path one short
          // timeout and nothing else.
          //
          // `specFolder` is read from the landing rather than the job:
          // a create step's job still carries its provisional key here,
          // and is only renamed once every repo is through the loop.
          await mergeEvents.report({
            project: job.project,
            specFolder: what.landed?.specFolder ?? job.specFolder,
            branch,
            repoRoot: repo.root,
            step: what.step,
            jobId: job.id,
            timestamp: new Date().toISOString(),
          });
          // Merged is not deployed. For a tool that lives in
          // `~/.local/bin`, the code landing on the default branch
          // changes nothing on the machine until it is installed —
          // which is why spec 92's merged code kept running as the old
          // version. The install belongs to the project, so the project
          // says what it is.
          if (codeRoots.has(repo.root)) {
            await installAfterMerge(result);
            // Never fatal, and never silent either: the merge already
            // happened, so this is reported beside it rather than
            // turning a successful merge into a failure.
            if (result.installError) {
              console.error(`queue: landing ${job.project}/${job.specFolder} in ${repo.root} — ${result.installError}`);
            }
          }
          if (result.branchDeleteError) {
            console.error(`queue: landing ${job.project}/${job.specFolder} in ${repo.root} — ${result.branchDeleteError}`);
          }
        } else if (result.reason === "gone") {
          // Nothing to land in this repo, and not a failure of this
          // landing (spec 153). An archive looks back through every
          // branch the spec's steps pushed, and since spec 149 a
          // `resolve` lands AND DELETES its own — so by the time archive
          // gets here, that branch is provably gone. Job 15932abc
          // (2026-08-21) was the first: archived, `ok: true`, and an
          // error on the row saying there was nothing left to merge.
          //
          // The refusal also disproves the cached answer from the other
          // side: the branch is not on origin at all.
          branchStatus.invalidate(repo.root, branch);
        } else {
          failures.push(result.error ?? `cannot merge ${branch} in ${repo.root}`);
          if (result.reason === "conflict") reason = "conflict";
        }
      }
      // Origin decides, not the queue's memory of its own pushes (spec
      // 193). Archive's contract is that nothing of the spec stays
      // open, and the loop above can only merge repos it was TOLD
      // about — a step run by hand, a job the LRU cap has evicted, a
      // push that half-succeeded, all leave a branch no `branchUrls`
      // entry ever mentioned. Three specs reached the archive that way
      // with every row saying done.
      //
      // `fresh`, because `mergeBranchIntoDefault` has just deleted the
      // branch on origin and a cached answer would report every
      // successful landing as unlanded.
      //
      // ARCHIVE's alone, by name and never by a denylist of the others:
      // an `analyze` landing runs while implement's code branch is
      // legitimately open, and the same check there would call a
      // healthy landing failed.
      if (what.step === "archive") {
        for (const root of await rootsStillHolding(job.project, branch, true)) {
          // A root the loop above CHOSE not to merge is not a root that
          // failed to merge (spec 220). Without this, every working
          // PR-mode archive reports itself as an unlanded failure — the
          // check asks origin about the project's roots with no
          // knowledge of which ones the landing skipped, and in `pr`
          // mode the code root always still holds the branch, by design.
          if (leaveOpen(root)) continue;
          failures.push(
            // The sentence carries the move as well as the state: the
            // way out is the step that just ran, and the row's own
            // button already offers it. Phrased as an instruction
            // rather than as a quote of that button's label, so a
            // future rename leaves the sentence less exact but never
            // wrong.
            `${branch} is still on origin in ${root} — the spec was archived, but its work has not landed. Run archive again to land it.`,
          );
          // Only where nothing more specific was found: a conflict is
          // the reason, and "unlanded" is what a conflict LOOKS like
          // from origin.
          reason ??= "unlanded";
        }
      }
      if (failures.length > 0) {
        // Whatever the success path would have written is NOT written: a
        // create job keeps its provisional key, because the job is still
        // the only handle on a branch that has not landed, and renaming
        // it to a folder the page cannot see would hide the work rather
        // than report it. The branch stays on the row either way.
        //
        // `errorReason` is STORED rather than carried in a redirect, and
        // that is the whole difference between this and the Merge button
        // spec 149 removed: nobody's browser is attached to a landing, so
        // the row has to be able to read the reason on any later request
        // (`queue-list.ts`, `resolveForm`).
        queue.update(job.id, {
          error: failures.join("; "),
          errorReason: reason,
          ...downgrade(job.id),
        });
        return;
      }
      // Landed. The branch is on the default branch now, so the job stops
      // advertising one: a compare page for a merged branch shows
      // nothing, and the row would otherwise name a branch it can
      // no longer derive (`specBranch` reads the RENAMED folder).
      // ...except what was deliberately left open (spec 220), which
      // still has a branch and still wants naming: the row is where a
      // reader learns the code is waiting on a review rather than
      // already on the default branch.
      const stillOpen = repos.filter((repo) => leaveOpen(repo.root));
      // And the review it is waiting on is named on THIS job, whichever
      // job opened it. `implement` pushed the code and called `gh`;
      // `archive` is the row a reader is looking at when the spec goes
      // quiet, and a link they have to go hunting for on an older row is
      // a link that is not there.
      const review = stillOpen.length ? queue.pullRequestFor(job.project, job.specFolder) : {};
      queue.update(job.id, {
        ...what.landed,
        branchUrl: stillOpen.length ? (stillOpen[0]!.url ?? job.branchUrl) : undefined,
        branchUrls: stillOpen,
        prUrl: review.prUrl,
        prError: review.prError,
        error: undefined,
        errorReason: undefined,
      });
      // The page caches its scan for five seconds. Without this the very
      // request that follows a landing would still not show the spec —
      // nor, for an archive, that it has left the list.
      scan = null;
      // After `scan = null`, so anything this reads sees the landing
      // rather than the five-second-old picture of the world before it.
      if (what.onLanded) {
        try {
          await what.onLanded();
        } catch (err) {
          console.error(
            `queue: landing ${job.project}/${job.specFolder} — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      // Never rethrown: the `landing` flag holds the WHOLE queue, and
      // the runner clears it when this promise settles — which it must
      // do, however this went.
      queue.update(job.id, {
        error: what.failedNote(err instanceof Error ? err.message : String(err)),
        // A thrown landing is not a conflict — the merge never got far
        // enough to be one, and offering Resolve for it would send a
        // whole run at a problem it cannot fix.
        errorReason: undefined,
        ...downgrade(job.id),
      });
    }
  }

  /** A landing that failed is not a spec that is done (spec 193).
   *
   *  The STEP succeeded, so `complete()` has already written `done` and
   *  announced it; this promise settles afterwards, and until now it
   *  wrote only a sentence nothing was drawing. Every page reads the
   *  state through one path, so moving it is all "reads as unfinished
   *  wherever the job is shown" takes.
   *
   *  Only ever DOWNGRADED from `done`: `complete()` may have queued the
   *  job's next step in between (`runner.ts`), and a landing must not
   *  overwrite a job that has moved on. */
  function downgrade(id: string): { state?: "failed" } {
    return queue.get(id)?.state === "done" ? { state: "failed" } : {};
  }

  /** Put a newly created spec where the page can see it (spec 93).
   *
   *  This was the first merge on the dashboard that no one pressed a
   *  button for, and it is not a convenience: the spec list shows what is
   *  on disk in the main checkout, which every run is careful never to
   *  leave its default branch, so a created spec that is only pushed to
   *  a branch appears nowhere at all. A spec waiting on the page until
   *  somebody noticed and merged it by hand would not be the feature
   *  with one extra click — it would be the feature not working. */
  async function landNewSpec(job: Job, outcome: Partial<StepOutcome>): Promise<void> {
    return landBranch(job, outcome, {
      step: "create",
      landed: { specFolder: outcome.specFolder ?? job.specFolder },
      nothingToLand:
        "the spec was created, but the run reported no pushed branch to land it from — " +
        "merge it by hand, or check the queue's push mode",
      failedNote: (why) => `the spec was created, but landing it failed: ${why}`,
    });
  }

  /** Land the work a middle-of-the-workflow step produced (spec 149).
   *
   *  `analyze` writes markdown in the specs repo and
   *  nothing else — the same argument that made `create` and `archive`
   *  land themselves, word for word; it was simply never given it,
   *  and the row piled up a "ready to merge" button per step for work
   *  nobody had a reason to weigh.
   *
   *  Either one lands what its OWN run reports and nothing else — the
   *  outcome's roots, never `branchesFor` history. Reading the history
   *  instead would let a step that touched only the specs repo drag an
   *  unarchived `implement`'s code onto the default branch as a side
   *  effect, which is exactly what "archive is the one step that sends
   *  code to the default branch" rules out. The residual gap is that a
   *  run whose own catch-up merge happens to move the project's HEAD
   *  lands that code early; it is accepted, and it belonged to `resolve`
   *  until spec 171 retired that step.
   *
   *  The install is neither asked for nor refused here: `landBranch`
   *  runs it for any CODE root that lands, whichever step landed it.
   *  `analyze` never has one. */
  async function landStepBranch(
    job: Job,
    step: WorkflowStep,
    outcome: Partial<StepOutcome>,
  ): Promise<void> {
    return landBranch(job, outcome, {
      step,
      failedNote: (why) => `the ${step} step finished, but landing it failed: ${why}`,
    });
  }

  /** Land what a step wrote when it did NOT finish, but ran out of time
   *  having touched no code repo (spec 187).
   *
   *  The merge is `landBranch`, unchanged — the caller has already asked
   *  the only question this case adds (did anything outside the specs
   *  repo move?). What differs is one sentence a person reads: "the
   *  analyze step finished, but landing it failed" would state as fact
   *  the one thing that did not happen, which is exactly what a reader
   *  needs to know. `nothingToLand` stays unset for the same reason `archive`
   *  leaves it unset: a run with no branch is an ordinary outcome here,
   *  and the caller returns before this is reached anyway. */
  async function landStoppedStepBranch(
    job: Job,
    step: WorkflowStep,
    outcome: Partial<StepOutcome>,
  ): Promise<void> {
    return landBranch(job, outcome, {
      step,
      failedNote: (why) => `the ${step} step stopped at its time limit, and landing what it wrote failed: ${why}`,
    });
  }

  /** Take an archived spec out of the list it has just left (spec 136).
   *
   *  The same argument as `landNewSpec`, at the other end of a spec's
   *  life: the list reads the main checkout, so a folder moved into
   *  `archive/` on a branch is still in the ACTIVE list here, and the row
   *  asks to be merged. That made the closing step end by handing back a
   *  task — 133 was archived twice on 2026-08-20 because the first run
   *  looked like it had failed.
   *
   *  Safe to do unpressed for a reason `implement` cannot claim: a
   *  headless archive writes two markdown changes in the specs repo and
   *  nothing else (`core/skills/aide-archive/SKILL.md` forbids it to
   *  touch the project's docs or to ask), so there is no diff for a
   *  person to weigh and nothing that reaches the serving host. The
   *  judgment happened before the run — someone pressed Archive, and the
   *  skill refuses to move anything a `4-status.md` does not show as
   *  finished.
   *
   *  A merge that genuinely cannot be made still refuses by name, keeps
   *  the branch on the row and leaves the spec in the list: the old
   *  behaviour is the fallback, not the thing being removed. */
  async function landArchivedSpec(job: Job, outcome: Partial<StepOutcome>): Promise<void> {
    return landBranch(job, outcome, {
      step: "archive",
      // The ONE landing that reads past its own outcome (spec 149).
      // `implement` deliberately never lands, so the project's code
      // branch sits open for however many steps follow — and whether an
      // archive run's own git touches that checkout is not guaranteed:
      // `update_branch_to_base` runs for every root on every step, but
      // where the code branch is already an ancestor of the default
      // branch the `--ff-only` is a no-op, so HEAD never moves and the
      // project root never appears here. `branchesFor` is the record
      // that still has it — implement's job entry keeps its
      // `branchUrls`, because nothing ever clears them.
      repos: mergeBranchRefs(queue.branchesFor(job.project, job.specFolder), outcome.branchUrls ?? []),
      // A run that pushed nothing archived nothing new — a re-run of a
      // spec already held back for the same reason writes no commit, and
      // an error there would report a problem that is not one.
      failedNote: (why) => `the spec was archived, but landing it failed: ${why}`,
      // The one landing that records anything (spec 207). It runs only
      // once the branch is genuinely on the default branch: a spec
      // whose archive did not land is not archived, and a figure
      // written for it would outlive the row that says so.
      onLanded: () => stampTotalDuration(job),
    });
  }

  /** What the spec cost in TIME, written into its own `4-status.md`
   *  once its archive has landed (spec 207).
   *
   *  The spec list has always shown this — the phases added together —
   *  but it is worked out from the queue's job records, and the queue
   *  keeps two hundred jobs on one machine while the archive holds
   *  ninety specs and grows. So most archived rows would have no figure
   *  and never would, unless it is written down. Written down, it
   *  survives the queue forgetting, the machine changing and the year
   *  turning, which is the whole reason to want it.
   *
   *  Neither half of the runner can do this: `core/skills/aide-archive`
   *  reads markdown and runs git, and `core/scripts/aide-run-spec`
   *  derives what it knows from commit subjects. The per-step timings
   *  live only in this process's `QueueStore`, so the write happens
   *  here.
   *
   *  Four things it will not do:
   *
   *  - It does not compute the sum itself. `computeSpecTotalDurationMs`
   *    is the spec list's own function, and `done` comes from the same
   *    `withFreshness` the list calls — so "the stored figure equals
   *    what the list showed" holds by construction rather than by two
   *    implementations staying in step.
   *  - It does not write twice. 133 was archived three times; a second
   *    landing finds the stamp already there and leaves it alone.
   *  - It does not write in a person's checkout. The merge above landed
   *    in the machinery's own (spec 205), which is also where the
   *    archive step's `git mv` has just moved the folder — so the
   *    archived path is tried first and the active one second, the same
   *    two-candidate shape `aide_resolve_spec` uses in bash.
   *  - It does not fail anything. A refusal is logged and left there;
   *    what it leaves is a blank cell, which the archive page already
   *    draws for every spec finished before this existed. */
  async function stampTotalDuration(job: Job): Promise<void> {
    const root = machinerySpecsRoot(job.project);
    if (!root) return;
    const dir = [join(root, "archive", job.specFolder), join(root, job.specFolder)].find(
      (candidate) => specFileText(candidate, STATUS_SPEC_FILE) !== null,
    );
    if (!dir) return;
    // Already recorded: a re-run of `archive` must not grow a second
    // bullet, nor overwrite the first with a figure measured over a
    // different set of jobs. Read before anything expensive is done.
    if (specDurationMs(dir) !== null) return;
    const current = specFileText(dir, STATUS_SPEC_FILE);
    if (current === null) return;
    // The list's own done-set, from the list's own function — NOT the
    // job results. A step a job completed is not necessarily a step
    // that counts: `withFreshness` takes `analyze` back out when the
    // description moved on after it, and the list then shows no total.
    const spec = {
      project: job.project,
      specFolder: job.specFolder,
      dir,
      reopenedAfter: parseStatus(current).reopenedAfter,
    };
    // `withFreshness` is a peek since spec 208, and this spec has just
    // been archived — the schedule walks the LIVE list, so nothing has
    // ever asked git about this folder. Warmed first, deliberately:
    // this is a landing, not a render, and a figure worked out from
    // "not yet known" would be written down and outlive the mistake.
    await warmSpec(spec);
    const [fresh] = withFreshness([spec]);
    const rows = await Promise.all(
      queue
        .list()
        .filter((j) => j.project === job.project && j.specFolder === job.specFolder)
        .map(jobRow),
    );
    const ms = computeSpecTotalDurationMs(rows, fresh?.done ?? []);
    if (ms === undefined) return;
    const text = stampDuration(current, ms);
    // Nowhere to put the line — a `4-status.md` with no Tracking info
    // section — comes back unchanged, and there is nothing to save.
    if (text === current) return;
    const baseSha = (await lastCommitOf(gitRun, dir, STATUS_SPEC_FILE))?.sha ?? null;
    // The same lock the merge above just used and let go of, for the
    // same hazard: every spec shares the specs root, so this write must
    // not run beside a save, a pull, or a second landing.
    const result = await mergeLock.run(await specsRoot(dir), () =>
      saveSpecFile(gitRun, dir, (r) => branchStatus.defaultBranch(r), {
        file: STATUS_SPEC_FILE,
        text,
        baseSha,
        specLabel: job.specFolder,
        message: `Record what ${job.specFolder} cost in time`,
      }),
    );
    if (!result.ok) {
      console.error(`queue: recording ${job.project}/${job.specFolder}'s time spent — ${result.note}`);
    }
  }

  /** Everything about a spec that only git can answer, asked once per
   *  spec over the same checkout.
   *
   *  Spec 154: which steps it has HAD. The runner commits every step it
   *  finishes, with the outcome in the subject, and that commit exists
   *  whether or not the model reached the instruction that writes
   *  `4-status.md` — which is what makes it the record and the file the
   *  claim. The file is still read (`fileSteps`), for one purpose: a
   *  row whose file and history disagree says so.
   *
   *  Spec 97: whether the plan is still about the problem the
   *  description states. A description committed after the last
   *  finished analyze means the plan on disk answers an older question,
   *  so the two phases that produced it stop counting as done and the
   *  row pre-ticks `analyze` again.
   *
   *  Applied here rather than inside `targets()` for two reasons: that
   *  scan is cached for five seconds and must stay a pure function of
   *  what is on disk, and it is handed to the queue as a SYNCHRONOUS
   *  resolver — making it async to ask git would thread `await` through
   *  the enqueue path for a signal enqueueing has no use for.
   *
   *  A stale description takes back `analyze` only.
   *  `implement` is deliberately untouched: nothing here blocks running
   *  a spec whose description change turns out to be cosmetic.
   *
   *  A spec with no `dir` — a create job's spec, which is the folder the
   *  job is making — has no history to read and keeps the empty
   *  done-set it arrived with. */
  function withFreshness(list: QueueTarget[]): QueueTarget[] {
    return list.map((t) => {
      if (!t.dir) return t;
      // Peeks, never the async methods (spec 208). A render reads
      // memory and disk and nothing else; `refreshSpecCaches` is what
      // keeps these three fed, on a schedule of its own.
      const { history, checkedAt } = workflowHistory.peekHistory(t.dir, t.specFolder, t.reopenedAfter);
      // Nothing has ever been asked about this spec. Not "no step has
      // run" — that is a real answer with a real, empty history — and
      // the row draws "checking…" rather than a false negative,
      // which is the class of bug spec 178's own plan review flagged.
      if (history === null || checkedAt === null) return { ...t, freshnessUnknown: true };
      const fileSteps = t.fileSteps ?? [];
      // `create` is settled by the folder being on disk, which is
      // what `t.dir` being set already proves — a stronger source
      // than the commit log, since a spec written by hand has no
      // `Run /aide-create` commit at all. Whenever the row is drawn
      // the spec exists, so "create not run yet" cannot be true
      // (spec 176). The pip has read it this way since spec 167; the
      // phase LINE reads the same set now, one layer down.
      const done = history.done.includes("create") ? history.done : ["create", ...history.done];
      const withHistory: QueueTarget = {
        ...t,
        done,
        stopped: history.stopped,
        fileDisagrees: stepsFileDisagreesOn(fileSteps, history),
        // What the "Started" column holds (spec 199). Null when git
        // could not answer — a shallow clone, a folder moved without
        // `git mv` — and then the cell shows a dash rather than a
        // job's own time, which is the field this replaces.
        createdAt: specCreatedAt.peekCreatedAt(t.dir, t.specFolder).createdAt ?? undefined,
      };
      if (!freshness.peekStale(t.dir, t.specFolder, t.reopenedAfter).stale) return withHistory;
      return {
        ...withHistory,
        analyzeStale: true,
        done: done.filter((s) => s !== "analyze"),
      };
    });
  }

  /** Run the project's own install, once its code has landed. Bounded by
   *  a timeout of its own — never trusting the server's idle timeout to
   *  bound it — and never fatal: the merge already happened, and a
   *  failed install is reported beside it rather than retroactively
   *  turning a successful merge into a failure. */
  async function installAfterMerge(result: RepoMergeResult): Promise<void> {
    const cmd = configValue(result.root, "AIDE_INSTALL_CMD");
    if (!cmd) {
      // Said out loud for every project that has not configured one:
      // the alternative is a page that reads as "deployed" when nothing
      // was deployed, which is the whole complaint.
      result.installError = "merged, not installed — no AIDE_INSTALL_CMD configured; deploying is a hand step";
      return;
    }
    const timeoutMs = opts.queueInstallTimeoutMs ?? INSTALL_TIMEOUT_MS;
    try {
      // argv, no shell — the same shape the notify command already has,
      // so nothing here has to get quoting right on someone's behalf.
      const proc = Bun.spawn({ cmd: cmd.split(/\s+/), cwd: result.root, stdout: "ignore", stderr: "pipe" });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);
      let tail = "";
      try {
        tail = await new Response(proc.stderr).text();
      } finally {
        clearTimeout(timer);
      }
      const code = await proc.exited;
      if (timedOut) {
        result.installError = `merged, but the install timed out after ${timeoutMs}ms and was stopped`;
      } else if (code !== 0) {
        result.installError = `merged, but the install failed (exit ${code}): ${tail.trim().slice(-200)}`;
      }
    } catch (err) {
      result.installError = `merged, but the install could not be run: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Write the allowlist back to the file the server reads on the way
   *  up, so an Add or a Remove survives a restart. Derived from the
   *  live `Set` and never from a copy of the file, which is what stops
   *  two changes a millisecond apart from losing each other.
   *
   *  Never fatal: the clone already happened, and the project IS on the
   *  allowlist in this process. But it is not silent either — a change
   *  that will vanish on the next restart is exactly the thing the
   *  operator has to be told, so it comes back as a failed step with
   *  the reason in it. */
  function persistAllowlist(what: string): ProjectStep {
    if (!opts.queueConfigFile) {
      return {
        step: "allowlist",
        ok: true,
        note: `${what}; this server has no --queue-config file, so the list is not saved across a restart`,
      };
    }
    const error = persistQueueProjects(opts.queueConfigFile, [...allowed].sort());
    return error
      ? { step: "allowlist", ok: false, error: `${what}, but it could not be saved and will be lost on restart: ${error}` }
      : { step: "allowlist", ok: true };
  }

  /** One answer shape for both project routes — the merge route's, step
   *  for step: `results[]` with `ok = every(...)`, so the page's own
   *  `refusalText()` renders an Add refusal exactly as it renders a
   *  merge's. Every refusal reaches `serve.log` too, which is the only
   *  record left once the page has moved on. */
  function answerProjectChange(
    action: string,
    project: string,
    steps: ProjectStep[],
    sent: unknown,
    wantsJson: boolean,
    /** What an Add that SUCCEEDED found out about the project it just
     *  registered (spec 138). It travels beside `results` and never
     *  inside it: `ok` says the registration completed, `canRun` says
     *  whether a run would start, and folding the second into the first
     *  would report a checkout that IS on disk as an add to retry. */
    readiness?: ProjectReadiness,
  ): Response {
    const ok = steps.every((s) => s.ok);
    for (const s of steps) if (s.error) logRefusal(action, project, s.error);
    if (wantsJson) {
      return json({ ok, project, results: steps, ...(readiness ? { readiness } : {}) }, ok ? 200 : 400);
    }
    const summary = steps.map((s) => s.error).filter(Boolean).join("; ");
    // A refusal goes back to the page the FORM is on — the Add page or
    // the row's own Remove page (2026-08-19) — a success to the list.
    const formPage =
      action === "add-project"
        ? ADD_PROJECT_ROUTE
        : action === "project-settings"
          ? `/projects/${encodeURIComponent(project)}`
          : `/projects/${encodeURIComponent(project)}/remove`;
    if (summary) return specsRedirect(sent, { error: summary }, formPage);
    // A browser with no script gets the readiness answer the only way a
    // redirect can carry one: in the query string of the page it lands
    // on. Without this the whole of it dies in a response body nobody
    // ever sees — which is how Skjer came to look added and be unable
    // to run.
    return specsRedirect(
      sent,
      undefined,
      action === "project-settings" ? `/projects/${encodeURIComponent(project)}` : PROJECTS_ROUTE,
      readiness && { note: readiness.note, ok: readiness.canRun },
    );
  }

  async function handleQueue(req: Request, url: URL, path: string): Promise<Response> {
    const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");

    // The list is the dashboard's front page. Both addresses it used to
    // answer at keep answering, because people bookmark this page — and
    // the token arrives in the query string of exactly such a bookmark,
    // so the search goes on verbatim. `/api/queue*` is an API contract
    // and is deliberately not matched.
    if (path === "/queue" || path === "/specs") {
      return new Response(null, { status: 302, headers: { location: `/${url.search}` } });
    }

    // Spec 189: the page's own connection. Answered HERE, near the top,
    // and deliberately not further down beside the other `/api/queue`
    // routes: the `/(api\/queue|specs)/<id>` match at the end of this
    // function would read "events" as a job id and answer 404 for a
    // route that exists.
    if (path === "/api/queue/events") {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      let mine: ReadableStreamDefaultController<Uint8Array> | null = null;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          mine = controller;
          watchers.add(controller);
          // The subscriber is registered — say so. A caller that acts
          // the instant its `fetch` resolves would otherwise race the
          // registration and wait for an event that was broadcast
          // before it was listening. A comment, so no client sees it.
          writeTo(controller, ": open\n\n");
        },
        cancel() {
          if (mine) watchers.delete(mine);
        },
      });
      return new Response(body, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          // Nothing serves this through a proxy today, but one that
          // buffered would hold every event back until the connection
          // closed — which is the whole of what this route is for.
          "x-accel-buffering": "no",
        },
      });
    }

    // The DETAIL page did not move with the list: what sits at the end
    // of this path is a job id, and a job is still read at /specs/<id>.
    if (path.startsWith("/queue/")) {
      return new Response(null, {
        status: 302,
        headers: { location: `/specs${path.slice("/queue".length)}${url.search}` },
      });
    }

    if (path === "/") {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const liveTargets = withFreshness(targets());
      const archivedKeys = scan?.archived ?? [];
      const chosenState = url.searchParams.get("state") ?? undefined;
      // Every archived spec is a row on this list since spec 221 — but
      // only for a reader whose chip asks for one. The builder decides
      // that itself, off the same `filterShowsArchived` the chips are
      // defined by, and the scale question is why: aide alone archives
      // about 150 specs, this page rebuilds itself on every change
      // event on every open tab, and the default view must not pay for
      // a set it does not show.
      const archivedSpecs = archivedSpecRows(chosenState);
      // The reader's own choice of column, from the address or from the
      // cookie it was last written into.
      const chosenSort = sortChoice(url, req);
      const view = {
        runnerAvailable: opts.runnerAvailable ?? runner !== null,
        targets: liveTargets,
        archived: archivedKeys,
        archivedSpecs,
        script: queueClientScript(),
        // Only what the config granted a budget to is offerable: a
        // dropdown naming a model the machine has not agreed to pay for
        // would be a way around the caps.
        modelChoices: Object.entries(queue.defaults.modelChoices ?? {}).map(([name, c]) => ({
          name,
          budgetUsd: c.budgetUsd,
          // Carried so the option can SAY which CLI it starts: two
          // entries that differ only in that would otherwise be two
          // identical-looking names in the same dropdown.
          ...(c.tool ? { tool: c.tool } : {}),
        })),
        defaultModels: queue.defaults.model,
        error: url.searchParams.get("error") ?? undefined,
        // Which row the refusal belongs to. It rides in the query
        // string with the reason itself, so it survives the
        // five-second row swap the same way the filter does.
        errorSpec: url.searchParams.get("errorSpec") ?? undefined,
        projects: [...new Set(liveTargets.map((t) => t.project))].sort(),
        // The raw allowlist, not the discovered set: a project whose
        // FIRST spec this form exists to make has nothing on disk to be
        // discovered from, so deriving these from `targets()` would
        // leave it out of the one dropdown it needs to be in. Every
        // other list on this page stays derived, because every other
        // control is about a spec that already exists.
        createProjects: [...allowed].sort(),
        // Straight from the query string: how the list is cut and
        // ordered lives in the URL, so it survives a reload and can be
        // sent to someone else. Nothing here is trusted — the renderer
        // falls back to its defaults for anything it does not know.
        //
        // The SORT alone falls back to what the reader last chose
        // (`sortChoice`) rather than to the renderer's default: every
        // other part of the filter is set from a control on this page
        // and read back off the same address, but the sort is thrown
        // away by every plain link to `/` there is.
        filter: {
          state: chosenState,
          project: url.searchParams.get("project") ?? undefined,
          sort: chosenSort.sort,
          dir: chosenSort.dir,
          open: url.searchParams.get("open") ?? undefined,
          // The search term (spec 221), a query-string citizen like the
          // rest of the view — so it survives a reload, can be pasted to
          // someone else, and rides along on the SSE-driven row swap,
          // which sends `location.search` back verbatim.
          q: url.searchParams.get("q") ?? undefined,
        },
      };
      // The rows alone: the page swaps them from script every few
      // seconds, so a half-filled form is never wiped by a refresh.
      // Only the projects the queue may run. A project taken out of the
      // allowlist keeps its jobs in the history (and in /api/queue), but
      // a row for it could only offer a Run that would be refused.
      const listed = queue.list().filter((j) => allowed.has(j.project));
      if (url.searchParams.get("rows")) {
        // The sort cookie is written HERE as well as on the whole page,
        // and this is the one that matters: pressing a column heading
        // never reloads the page. The script rewrites the address and
        // fetches these rows alone, so a cookie set only on the full
        // page would never be written by the very act of choosing.
        const rowHeaders = new Headers({ "content-type": "text/html; charset=utf-8" });
        if (chosenSort.setCookie) rowHeaders.append("set-cookie", chosenSort.setCookie);
        return new Response(renderQueueRows(await Promise.all(listed.map(jobRow)), view), {
          headers: rowHeaders,
        });
      }
      const html = renderQueuePage(
        await Promise.all(listed.map(jobRow)),
        new Date().toISOString(),
        nav(),
        view,
      );
      const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
      // Hand the token over ONCE, as an HttpOnly cookie, so the forms
      // never have to carry it in their markup.
      //
      // `Lax`, not `Strict` (2026-08-22). A Strict cookie is withheld on
      // a top-level navigation that STARTED somewhere else, and an
      // installed app launched from the home screen is exactly that — so
      // the dashboard installed on a phone opened on "unauthorized"
      // while the same browser was signed in. Lax is sent on an ordinary
      // top-level navigation and still withheld from a cross-site POST,
      // which is what Strict was guarding here; every form on this page
      // posts same-site and is unaffected.
      // A `Headers` rather than the record it was built from: two
      // cookies can be handed over on one response — the token on the
      // first visit and the sort a shared link carried — and a record
      // has room for one `set-cookie`.
      const pageHeaders = new Headers(headers);
      if (url.searchParams.get("token") && queueToken) {
        pageHeaders.append(
          "set-cookie",
          `aide_token=${encodeURIComponent(queueToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
        );
      }
      if (chosenSort.setCookie) pageHeaders.append("set-cookie", chosenSort.setCookie);
      return new Response(html, { headers: pageHeaders });
    }

    // The New-spec form's own page (spec 121). It was a disclosure on
    // `/` until the button that opened it became a link to here.
    //
    // It needs three things off this server and no more: which projects
    // a spec may be made in (the RAW allowlist, like the dropdown it
    // feeds — a project whose FIRST spec this form exists to make has
    // nothing on disk to be discovered from), what the new spec may
    // build on, and the page code that scopes the second to the first.
    if (path === NEW_SPEC_ROUTE) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const html = renderNewSpecPage(nav(), new Date().toISOString(), {
        token: queueToken,
        createProjects: [...allowed].sort(),
        targets: withFreshness(targets()),
        script: queueClientScript(),
        modelChoices: Object.entries(queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
          name,
          budgetUsd: choice.budgetUsd,
          ...(choice.tool ? { tool: choice.tool } : {}),
        })),
        defaultModels: queue.defaults.model,
        // Why the last submission was refused, carried back here by the
        // create route's own redirect.
        error: url.searchParams.get("error") ?? undefined,
      });
      const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
      // The same one-time handover `/` and `/projects` do, for a reader
      // who arrived with the token in the address.
      if (url.searchParams.get("token") && queueToken) {
        headers["set-cookie"] =
          `aide_token=${encodeURIComponent(queueToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
      }
      return new Response(html, { headers });
    }

    if (path === SETTINGS_ROUTE) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      return new Response(renderSettingsPage(nav(), new Date().toISOString(), {
        modelChoices: Object.entries(queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
          name, budgetUsd: choice.budgetUsd, ...(choice.tool ? { tool: choice.tool } : {}),
        })),
        defaultModels: queue.defaults.model,
        script: queueClientScript(),
        error: url.searchParams.get("error") ?? undefined,
        notice: url.searchParams.get("notice") ?? undefined,
      }), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // The Add-project form on a page of its own, and the Remove
    // confirmation likewise (2026-08-19, New spec as the pattern). Both
    // only exist where /projects itself does — without --root there is
    // nothing to add to.
    if (path === ADD_PROJECT_ROUTE) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      if (!opts.projectRoot) {
        return new Response(null, { status: 302, headers: { location: `/${OVERVIEW_PAGE}` } });
      }
      // Read fresh per request, the way /projects reads its own scan:
      // a checkout that appeared on the host a minute ago is offered.
      const unclaimed = discoverUnclaimedDirectories(opts.projectRoot);
      const html = renderAddProjectPage(nav(), new Date().toISOString(), {
        token: queueToken,
        script: queueClientScript(),
        existingCheckouts: unclaimed,
        // And what each of them ignores, which is where the worktree
        // links a run needs are named (spec 140). The union, deduped
        // and sorted: nothing has been picked yet at the moment this
        // page is drawn.
        worktreeLinkCandidates: [
          ...new Set(unclaimed.flatMap((d) => gitignoreCandidates(join(opts.projectRoot!, d)))),
        ].sort(),
        // Spec 184: what each of them would be configured with, worked
        // out rather than asked for — the checkout's own lockfile for
        // the links, and how the projects already added lay their specs
        // out for the specs root. Anything that cannot be worked out
        // comes back empty and is rendered as a blank field.
        proposalsByCheckout: Object.fromEntries(
          unclaimed.map((d) => [
            d,
            {
              specsPath: suggestSpecsPath(
                d,
                [...allowed].map((name) => ({
                  name,
                  specsPath: configValue(displayProjectDir(name), "AIDE_SPECS_PATH"),
                })),
              ),
              worktreeLinks: suggestWorktreeLinksFromLockfile(join(opts.projectRoot!, d)),
            },
          ]),
        ),
        error: url.searchParams.get("error") ?? undefined,
      });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const removePage = path.match(/^\/projects\/([^/]+)\/remove$/);
    if (removePage) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const name = decodeURIComponent(removePage[1]!);
      // Only a project the allowlist knows has anything to be removed
      // from — everything else is a mistyped address.
      if (!opts.projectRoot || !allowed.has(name)) {
        return new Response("no such project\n", { status: 404 });
      }
      const html = renderRemoveProjectPage(name, nav(), new Date().toISOString(), {
        token: queueToken,
        script: queueClientScript(),
        error: url.searchParams.get("error") ?? undefined,
      });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // The former Settings page redirects to the single editing surface.
    const settingsPage = path.match(/^\/projects\/([^/]+)\/settings$/);
    if (settingsPage) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const name = decodeURIComponent(settingsPage[1]!);
      if (!opts.projectRoot || !allowed.has(name)) {
        return new Response("no such project\n", { status: 404 });
      }
      return new Response(null, {
        status: 302,
        headers: { location: `/projects/${encodeURIComponent(name)}` },
      });
    }

    // A project's OWN page, served (spec 185). Below the Add and Remove
    // pages on purpose: those are two-segment paths too, and a project
    // may not shadow a control.
    //
    // The generated `<slug>.html` is still written and still reachable
    // — a site rsynced behind a plain file server has no server to ask
    // git anything, and that is the deployment it is for. What that
    // page cannot say is what this one exists for: the config file is
    // personal and gitignored, an operator edits it between merges, and
    // the generator runs only after some unrelated merge lands in the
    // queue.
    const projectPage = path.match(/^\/projects\/([^/]+)$/);
    if (projectPage) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const name = decodeURIComponent(projectPage[1]!);
      if (!opts.projectRoot) return new Response("no such project\n", { status: 404 });
      // Read fresh, uncached, exactly as `/projects` does: nothing polls
      // this page, so a scan per request is the cost `make generate`
      // already treats as cheap — and no invalidation to get wrong.
      const view = buildProjectViews(opts.projectRoot, ownedSpecsRoot).find((p) => p.name === name);
      if (!view) return new Response("no such project\n", { status: 404 });
      const dir = displayProjectDir(name);
      // Fail open, the way the drift check on `/projects` does. Every
      // check inside `assessProjectReadiness` already treats a git that
      // answers nothing as its own kind of failure rather than throwing,
      // so this catches the case where git is not there to be run at
      // all: the reader came for the project's page, and the half of it
      // that needs no git is still worth serving.
      const readiness = await assessProjectReadiness(gitRun, dir, machineryProjectDir(name)).catch(() => null);
      const html = renderProjectPage(
        view,
        projectSettings(dir, readiness),
        readiness,
        new Date().toISOString(),
        nav(),
        {
          token: queueToken,
          script: queueClientScript(),
          specsPath: configValue(dir, "AIDE_SPECS_PATH") ?? "",
          worktreeLinks: resolveWorktreeLinks(dir).links,
          codeLanding: resolveCodeLanding(dir),
          worktreeLinkCandidates: gitignoreCandidates(dir),
          error: url.searchParams.get("error") ?? undefined,
        },
      );
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // The projects page (spec 115): the same listing the generator used
    // to write to projects.html, plus the panel that changes it. Beside
    // the `/` branch above on purpose — the full-page GET handlers
    // belong together for anyone reading this function.
    if (path === PROJECTS_ROUTE) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      // No `--root`, no project set: an empty listing would read as "no
      // projects on this machine" rather than "this server was never
      // told where they are". The generated page is what such a server
      // has always shown, and it is still there.
      if (!opts.projectRoot) {
        return new Response(null, { status: 302, headers: { location: `/${OVERVIEW_PAGE}` } });
      }
      // Read fresh, uncached: unlike `/` nothing polls this page, so a
      // scan per request is the same cost `make generate` already treats
      // as cheap — and no invalidation to get wrong.
      const projects = buildProjectViews(opts.projectRoot, ownedSpecsRoot);
      // Spec 142: a merge made anywhere but the Merge button below ran
      // no `AIDE_INSTALL_CMD`, so the serving host is still serving the
      // old code and, until this asked, nothing said so. Asked only of
      // the projects that expect an install to have happened —
      // deploying is a known hand step where none is configured, and a
      // banner there would be noise on every row forever.
      //
      // Kept out of `buildProjectViews`, which stays a pure disk scan
      // the static generator shares.
      //
      // Spec 203: a read, and nothing else. `peekDrift` is a map
      // lookup — no await, no git, no network on this path ever. The
      // taking of the answer is `refreshDrift`'s job on its own
      // schedule; what a row shows here is the last one it found, with
      // its own timestamp so the page can say how old it is. A project
      // gated for the check but never yet answered for is a key with a
      // null `checkedAt`, which the row says out loud.
      const driftByProject: Record<string, ProjectDrift> = {};
      for (const p of projects) {
        const root = machineryProjectDir(p.name);
        if (configValue(root, "AIDE_INSTALL_CMD")) {
          driftByProject[p.name] = branchStatus.peekDrift(root);
        }
      }
      // Spec 184: whether a run could start in each project, asked on
      // every visit. The Add flow answered this exactly once, in the
      // query string of the redirect it landed on — so an operator who
      // did not act on it there had no way to rediscover what was
      // missing except by starting a run and having it refused. Now the
      // row says it, and carries the Settings link that acts on it.
      // Concurrent, like the drift check above, and read-only.
      const readinessByProject: Record<string, { canRun: boolean; note: string }> = {};
      await Promise.all(
        projects.map(async (p) => {
          try {
            const { canRun, note } = await assessProjectReadiness(
              gitRun,
              displayProjectDir(p.name),
              machineryProjectDir(p.name),
            );
            readinessByProject[p.name] = { canRun, note };
          } catch {
            // A note is advice, and the listing is what the reader came
            // for: a host with no `git` on PATH must still get the page,
            // and a row with nothing to say about readiness is exactly
            // the row the generated page has always drawn.
            readinessByProject[p.name] = { canRun: true, note: "" };
          }
        }),
      );
      const html = renderProjectsPage(
        projects,
        new Date().toISOString(),
        nav(),
        {
          driftByProject,
          readinessByProject,
          token: queueToken,
          // The RAW allowlist, like the New-spec dropdown: a project
          // with no spec yet is exactly what this page is for.
          createProjects: [...allowed].sort(),
          script: queueClientScript(),
          error: url.searchParams.get("error") ?? undefined,
          // What the Add that landed the reader here found out (spec
          // 138). Straight from the query string, like the refusal
          // beside it, and rendered as text and nothing else.
          notice: url.searchParams.get("notice") ?? undefined,
          noticeOk: url.searchParams.get("noticeOk") === "1",
        },
      );
      const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
      // The same one-time handover `/` does: projects.html passes the
      // address on with its query string, so a bookmarked token arrives
      // here.
      if (url.searchParams.get("token") && queueToken) {
        headers["set-cookie"] =
          `aide_token=${encodeURIComponent(queueToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
      }
      return new Response(html, { headers });
    }

    // Before the `<id>/<verb>` and `<id>` matches below, which would
    // otherwise read "create" as a job id and answer 404 for it.
    if (path === "/api/queue/create") {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const body = await readBounded(req);
      if ("refusal" in body) return body.refusal;
      let raw: unknown;
      try {
        raw = bodyToObject(body.text, req.headers.get("content-type"));
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      const result = queue.enqueueCreate(raw);
      // The two no-JS answers go to different pages on purpose (spec
      // 121). A refusal goes back to the page the form is ON, where
      // what was typed can be corrected — the same rule the Projects
      // panel's own routes follow. A success goes to the list, because
      // the thing the reader asked for is a row on it.
      if (!result.ok) {
        return wantsJson
          ? json({ error: result.error }, 400)
          : specsRedirect(raw, { error: result.error }, NEW_SPEC_ROUTE);
      }
      await tickRunner();
      return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(raw, undefined, "/");
    }

    if (path === "/api/queue/settings") {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const body = await readBounded(req);
      if ("refusal" in body) return body.refusal;
      let raw: unknown;
      try { raw = bodyToObject(body.text, req.headers.get("content-type")); }
      catch { return json({ error: "malformed body" }, 400); }
      const asked = raw as Record<string, unknown> | null;
      const models = asked?.model;
      const refuse = (error: string) => wantsJson
        ? json({ error }, 400)
        : new Response(null, { status: 303, headers: { location: `${SETTINGS_ROUTE}?error=${encodeURIComponent(error)}` } });
      if (!opts.queueConfigFile) return refuse("this server has no queue config file");
      if (!models || typeof models !== "object" || Array.isArray(models)) return refuse("model defaults are missing");
      const table = models as Record<string, unknown>;
      const unknown = Object.keys(table).find((step) => !(SETTINGS_STEPS as readonly string[]).includes(step));
      if (unknown) return refuse(`unknown workflow step: ${unknown}`);
      const next: Record<string, string> = {};
      for (const step of SETTINGS_STEPS) {
        const value = table[step];
        if (Array.isArray(value)) return refuse(`duplicate model value for ${step}`);
        if (typeof value !== "string" || !value) return refuse(`missing model for ${step}`);
        if (!queue.defaults.modelChoices?.[value]) return refuse(`unknown or not-allowed model for ${step}: ${value}`);
        next[step] = value;
      }
      const merged = { ...queue.defaults.model, ...next };
      const error = persistQueueModelDefaults(opts.queueConfigFile, next);
      if (error) return refuse(error);
      queue.defaults.model = merged;
      return wantsJson
        ? json({ ok: true, model: next })
        : new Response(null, { status: 303, headers: { location: `${SETTINGS_ROUTE}?notice=${encodeURIComponent("Defaults saved")}` } });
    }

    // --- the project allowlist (spec 112) -----------------------------
    //
    // Before the `<id>/<verb>` and `<id>` matches below, which would
    // otherwise read "projects" as a job id and answer 404 for it —
    // the same reason `/api/queue/create` sits above them.
    //
    // Both routes are under `/api/queue/`, so `isQueuePath()` already
    // guards them: a sibling `/api/projects/*` would have been exactly
    // the silent bypass that predicate exists to prevent.
    if (path === "/api/queue/projects") {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const body = await readBounded(req);
      if ("refusal" in body) return body.refusal;
      let raw: unknown;
      try {
        raw = bodyToObject(body.text, req.headers.get("content-type"));
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      const asked = (raw ?? {}) as Record<string, unknown>;
      const text = (v: unknown): string | undefined =>
        typeof v === "string" && v.trim() ? v.trim() : undefined;
      const rawName = typeof asked.name === "string" ? asked.name : "";
      // The picked checkout settles the project's name when Name was
      // left blank (spec 131), and the ALLOWLIST is what that name is
      // for — so the rule is asked of `project-admin.ts` here rather
      // than copied, and the answer names the project that was added.
      const name = addProjectTarget(opts.projectRoot ?? "", {
        name: rawName,
        existingPath: text(asked.existingPath),
      }).name || rawName;
      // Adding a project means putting a directory under the projects
      // root, and without `--root` there is no such root: refused in
      // those words rather than half-done somewhere arbitrary.
      if (!opts.projectRoot) {
        return answerProjectChange(
          "add-project",
          name,
          [{ step: "name", ok: false, error: "this server was started without --root, so it has no projects root to add to" }],
          raw,
          wantsJson,
        );
      }
      const result = await addProject(gitRun, opts.projectRoot, {
        name: rawName,
        gitUrl: text(asked.gitUrl),
        existingPath: text(asked.existingPath),
        description: text(asked.description),
        specsPath: text(asked.specsPath),
        worktreeLinks: text(asked.worktreeLinks),
      });
      const steps = [...result.steps];
      let readiness = result.readiness;
      if (result.ok) {
        allowed.add(name);
        // The five-second scan is what every other list on this page
        // reads; without this the very request after an Add would still
        // not see the project.
        scan = null;
        steps.push(persistAllowlist("added to the allowlist"));
        // Spec 205: eagerly, and here rather than inside `addProject` —
        // the alternative is every project's first run, Save or Update
        // paying a full clone inside the request that happens to need
        // one, which is a latency regression nobody asked for. The
        // readiness is re-taken afterwards so the answer describes the
        // checkout that now exists, not the one that did not a moment
        // ago.
        await ensureCheckout(name);
        readiness = await assessProjectReadiness(
          gitRun,
          join(opts.projectRoot, name),
          machineryProjectDir(name),
        ).catch(() => readiness ?? undefined);
      }
      // Only for an add that got as far as writing its files: there is
      // nothing to assess in a clone that never happened, and a
      // readiness answer about a project that was not added would be an
      // answer about somebody else's directory.
      return answerProjectChange("add-project", name, steps, raw, wantsJson, readiness);
    }

    // Spec 184: the same two fields the Add form posts, for a project
    // that already exists. Above the `<id>/<verb>` matches for the same
    // reason the Add route is.
    const settingsPost = path.match(/^\/api\/queue\/projects\/([^/]+)\/settings$/);
    if (settingsPost) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const name = decodeURIComponent(settingsPost[1]!);
      const body = await readBounded(req);
      if ("refusal" in body) return body.refusal;
      let raw: unknown;
      try {
        raw = bodyToObject(body.text, req.headers.get("content-type"));
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      if (!opts.projectRoot || !allowed.has(name)) {
        return answerProjectChange(
          "project-settings",
          name,
          [{ step: "name", ok: false, error: `"${name}" is not a project this dashboard knows` }],
          raw,
          wantsJson,
        );
      }
      const asked = (raw ?? {}) as Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === "string" ? v : "");
      const result = await updateProjectSettings(gitRun, join(opts.projectRoot, name), {
        specsPath: str(asked.specsPath),
        worktreeLinks: str(asked.worktreeLinks),
        // Only when the form actually sent one (spec 220): a caller
        // posting the two older fields alone must not be read as
        // choosing `merge` and quietly taking the key back out.
        ...("codeLanding" in asked && { codeLanding: str(asked.codeLanding) }),
      });
      // The specs root a save just named is where the scan goes looking
      // for this project's specs — without this the very next request
      // would still read the old one.
      if (result.ok) scan = null;
      // And it is what `aide-run-spec` reads out of the DASHBOARD's own
      // checkout (spec 205): the write above reached the person's
      // config, and `ensureCheckout` is what carries the new value
      // across. Without this the next run would still read the old
      // specs root — silently, which is the whole hazard of two config
      // files.
      const readiness = result.ok
        ? await ensureCheckout(name).then(() =>
            assessProjectReadiness(gitRun, join(opts.projectRoot!, name), machineryProjectDir(name)).catch(
              () => result.readiness,
            ),
          )
        : result.readiness;
      return answerProjectChange("project-settings", name, result.steps, raw, wantsJson, readiness);
    }

    const removal = path.match(/^\/api\/queue\/projects\/([^/]+)\/remove$/);
    if (removal) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const name = decodeURIComponent(removal[1]!);
      const body = await readBounded(req);
      if ("refusal" in body) return body.refusal;
      let raw: unknown;
      try {
        raw = bodyToObject(body.text, req.headers.get("content-type"));
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      const nameError = projectNameError(name);
      if (nameError) {
        return answerProjectChange("remove-project", name, [{ step: "name", ok: false, error: nameError }], raw, wantsJson);
      }
      const asked = (raw ?? {}) as Record<string, unknown>;
      const result = removeProject(allowed, { name, confirm: asked.confirm });
      const steps = [...result.steps];
      if (result.ok) {
        scan = null;
        // `removeProject` already reported the allowlist step; this
        // replaces it with the same step told from the other side of the
        // write, rather than reporting the one thing twice.
        steps[steps.length - 1] = persistAllowlist("removed from the allowlist");
      }
      return answerProjectChange("remove-project", name, steps, raw, wantsJson);
    }

    if (path === "/api/queue") {
      if (req.method === "GET") {
        return json({ generatedAt: new Date().toISOString(), jobs: queue.list() });
      }
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const body = await readBounded(req);
      if ("refusal" in body) return body.refusal;
      let raw: unknown;
      try {
        raw = bodyToObject(body.text, req.headers.get("content-type"));
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      // Where a no-script form POST comes back to: the page the press
      // came FROM, because a redirect is the only answer such a form
      // gets and a reader dropped somewhere else cannot tell whether the
      // button did anything (spec 157).
      //
      // Reopen is the one control offered in two places (spec 198, and
      // spec 221 for the row). An archived spec's own page still gets
      // its answer there; a press on the list's own reader row says so
      // with `FROM_LIST_FIELD` and is answered on the list, filter and
      // all — `specsRedirect` rebuilds the view from the `view.*` fields
      // the same form carries. The marker is what decides it, never a
      // destination taken from the browser.
      const askedFor = raw as Record<string, unknown> | null;
      const backTo =
        askedFor?.[FROM_LIST_FIELD] !== "1" &&
        typeof askedFor?.project === "string" &&
        typeof askedFor?.specFolder === "string" &&
        specRef(askedFor.project, askedFor.specFolder)?.archived
          ? specPagePath(askedFor.project, askedFor.specFolder)
          : "/";
      const result = queue.enqueue(raw);
      if (!result.ok) {
        // Which spec was asked for, off the SUBMITTED fields — the two
        // `parseJobRequest` already requires, so this adds no trust
        // surface. It is never rendered as text either: the page only
        // compares it against a row's own key.
        const asked = raw as Record<string, unknown> | null;
        const spec =
          typeof asked?.project === "string" && typeof asked?.specFolder === "string"
            ? `${asked.project}/${asked.specFolder}`
            : undefined;
        logRefusal("run", spec, result.error);
        // A person who pressed a button gets the reason on the page
        // they pressed it from; an API caller gets a status code.
        // `spec` for the same reason merge's answer carries it: the page
        // shows a refusal on the row it belongs to and no longer
        // navigates to find out which, so the answer has to say.
        return wantsJson
          ? json({ error: result.error, spec }, 400)
          : specsRedirect(raw, { error: result.error, spec }, backTo);
      }
      await tickRunner();
      return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(raw, undefined, backTo);
    }

    // Spec 149: `cancel` is what is left of a route that also had
    // `approve` and `merge`. Both were removed with the things they
    // acted on — there is no stop between steps to approve, and every
    // step lands its own work, so there is nothing left to merge by
    // hand. Cancelling a run is the one action on a row that was never
    // about either.
    const action = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/cancel$/);
    if (action) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, id] = action;
      const job = queue.get(id);
      if (!job) return json({ error: "no such job" }, 404);
      // The body is read for ONE thing: the view the press came from,
      // so the redirect can put the reader back on it. A JSON caller
      // sends no body at all, and an unparseable one is not a reason to
      // refuse an action that needs nothing from it.
      const sent = await readBounded(req);
      if ("refusal" in sent) return sent.refusal;
      let view: unknown = {};
      try {
        if (sent.text) view = bodyToObject(sent.text, req.headers.get("content-type"));
      } catch {
        view = {};
      }
      // SIGTERM to the GROUP, never a bare pid: claude spawns
      // children, and a kill that only reaches the parent is not a
      // bound.
      if (job.pgid !== undefined) {
        try {
          process.kill(-job.pgid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
      queue.update(id, { state: "cancelled", finishedAt: new Date().toISOString() });
      return wantsJson ? json({ ok: true, job: queue.get(id) }) : specsRedirect(view);
    }

    // Spec 160: an edit to the job that is RUNNING, not a request for a
    // new one. `POST /api/queue` would be the wrong door — its answer
    // for a spec with a job in flight is the clash refusal, and rightly
    // — so the tail gets a route of its own, named after what it does.
    //
    // Every decision is the store's, against the job as it stands at
    // that instant: the page's idea of which step is running is a
    // second old by the time the tick lands, and it is never consulted.
    const tailEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/steps$/);
    if (tailEdit) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, id] = tailEdit;
      const job = queue.get(id!);
      if (!job) return json({ error: "no such job" }, 404);
      const sent = await readBounded(req);
      if ("refusal" in sent) return sent.refusal;
      let body: Record<string, unknown> = {};
      try {
        if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      const step = typeof body.step === "string" ? body.step : "";
      // A form sends the tick as text, an API caller as a boolean. Both
      // say the same thing, and the box's own state is what they say:
      // ticked adds the step, unticked removes it.
      const checked = body.checked;
      const add =
        checked === true ||
        (typeof checked === "string" && ["1", "true", "on", "yes"].includes(checked.toLowerCase()));
      const spec = `${job.project}/${job.specFolder}`;
      const result = queue.editTailStep(id!, step, add);
      if (!result.ok) {
        logRefusal("steps", spec, result.error);
        return wantsJson
          ? json({ error: result.error, spec }, 400)
          : specsRedirect(body, { error: result.error, spec });
      }
      // Now, not on the next two-second timer: a step added in the
      // instant the running one finishes would otherwise wait for it.
      await tickRunner();
      return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(body);
    }

    // Spec 225: the same edit for the other two controls on a phase
    // line. A sibling route rather than a second field on `/steps`,
    // because a box tick and a select change are two different events
    // at two different moments — one body carrying both would have to
    // branch on which fields it was handed, and `checked`'s absence
    // would have to start meaning something other than `false`.
    //
    // It queues nothing, so no tick is asked for: the runner reads
    // `job.model[step]` fresh when it spawns the step, which is what
    // makes the pick apply without an "apply" mechanism of its own.
    const tailModelEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/model$/);
    if (tailModelEdit) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, id] = tailModelEdit;
      const job = queue.get(id!);
      if (!job) return json({ error: "no such job" }, 404);
      const sent = await readBounded(req);
      if ("refusal" in sent) return sent.refusal;
      let body: Record<string, unknown> = {};
      try {
        if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      const step = typeof body.step === "string" ? body.step : "";
      const model = typeof body.model === "string" ? body.model : "";
      const spec = `${job.project}/${job.specFolder}`;
      const result = queue.editTailModel(id!, step, model);
      if (!result.ok) {
        logRefusal("model", spec, result.error);
        return wantsJson
          ? json({ error: result.error, spec }, 400)
          : specsRedirect(body, { error: result.error, spec });
      }
      return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(body);
    }

    // `/archive` was a route of its own from spec 163 until spec 221 —
    // every archived spec in one sortable, searchable table. It is gone,
    // and there is deliberately no redirect standing in its place: the
    // Specs list is one chip away from the same reading, but it is not
    // the same page, and answering a bookmark with a view that differs
    // from the one it asked for is worse than saying the page is gone.
    // Everything it could do — the date, the description, the "not
    // landed" mark, the search — is on the list it folded into.

    const resetPage = path.match(/^\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/reset$/);
    if (resetPage) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const [, project, specFolder] = resetPage;
      const ref = specRef(project!, specFolder!);
      if (!ref || ref.archived) return new Response("not found", { status: 404 });
      return new Response(
        renderResetSpecPage(project!, specFolder!, nav(), new Date().toISOString(), {
          token: queueToken,
          error: url.searchParams.get("error") ?? undefined,
          script: queueClientScript(),
        }),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    const resetPost = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/reset$/);
    if (resetPost) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, project, specFolder] = resetPost;
      const back = `${specPagePath(project!, specFolder!)}/reset`;
      const sent = await readBounded(req);
      if ("refusal" in sent) return sent.refusal;
      let body: Record<string, unknown> = {};
      try {
        if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      const refuseReset = (error: string): Response =>
        wantsJson ? json({ error }, 400) : specsRedirect({}, { error }, back);
      if (body.confirm !== specFolder) return refuseReset(`type ${specFolder} exactly to confirm Reset`);
      const ref = specRef(project!, specFolder!);
      if (!ref) return new Response("not found", { status: 404 });
      if (ref.archived) return refuseReset(`${specFolder} is archived — Reset is only for active specs`);
      if (queue.list().some((job) => job.landing)) return refuseReset("a landing is in progress");
      if (queue.list().some((job) =>
        job.project === project && job.specFolder === specFolder &&
        (job.state === "queued" || job.state === "running")
      )) return refuseReset("another job for this spec is still running");
      const result = queue.enqueue({ project, specFolder, steps: ["reset"] });
      if (!result.ok) return refuseReset(result.error);
      await tickRunner();
      return wantsJson
        ? json({ ok: true, job: result.job })
        : specsRedirect({}, undefined, specPagePath(project!, specFolder!));
    }

    // The SPEC page, and the Update button that keeps it honest (spec
    // 150). Two path segments where the job route has one, so the two
    // are disjoint by shape: a job id never contains a slash, and a
    // spec that has never run has no job id to be found by.
    const specPage = path.match(/^\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
    if (specPage) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const [, project, specFolder] = specPage;
      const view = await specPageView(
        project!,
        specFolder!,
        url.searchParams.get("tab") ?? undefined,
      );
      if (!view) return new Response("not found", { status: 404 });
      const html = renderSpecPage(
        {
          ...view,
          error: url.searchParams.get("error") ?? undefined,
          notice: url.searchParams.get("notice")
            ? { note: url.searchParams.get("notice")!, ok: url.searchParams.get("noticeOk") === "1" }
            : undefined,
        },
        new Date().toISOString(),
        nav(),
        {
          tab: url.searchParams.get("tab") ?? undefined,
          step: url.searchParams.get("step") ?? undefined,
        },
      );
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Pull the specs repository and come back to the same page. Four
    // segments, where the job actions have two and the project ones
    // three — nothing above can match it and it can match nothing
    // above.
    const update = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/update$/);
    if (update) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, project, specFolder] = update;
      const found = specDir(project!, specFolder!);
      if (!found) return new Response("not found", { status: 404 });
      const dir = await machinerySpecDir(project!, found);
      const back = specPagePath(project!, specFolder!);
      // The same lock a merge takes, and for the same hazard: every
      // spec shares the specs root, so two presses — or a press racing
      // the `aide-pull-specs` cron — would be two git sequences in one
      // working tree.
      const result = await mergeLock.run(await specsRoot(dir), () =>
        pullFastForward(gitRun, dir, (root) => branchStatus.defaultBranch(root)),
      );
      if (!result.ok) {
        logRefusal("update", `${project}/${specFolder}`, result.note);
        return specsRedirect({}, { error: result.note }, back);
      }
      return specsRedirect({}, undefined, back, { note: result.note, ok: true });
    }

    const save = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/save$/);
    if (save) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, project, specFolder] = save;
      const found = specDir(project!, specFolder!);
      if (!found) return new Response("not found", { status: 404 });
      const dir = await machinerySpecDir(project!, found);
      // Before the body is even read: this one WRITES, commits and
      // pushes, and an archived spec's folder is in `archive/`.
      if (specRef(project!, specFolder!)?.archived) {
        logRefusal("save", `${project}/${specFolder}`, ARCHIVED_REFUSAL);
        return specsRedirect({}, { error: ARCHIVED_REFUSAL }, specPagePath(project!, specFolder!));
      }
      const sent = await readBounded(req, MAX_SAVE_BODY);
      if ("refusal" in sent) return sent.refusal;
      let body: Record<string, unknown> = {};
      try {
        if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      // The Description tab, which is where the textarea is (spec 212).
      // A refusal has to land where the form was, holding what is
      // actually on disk.
      const back = specTabPath(project!, specFolder!, "description");
      // An EMPTY textarea is a legitimate save — the terminal-edit path
      // this matches has never stopped anyone deleting the lot. A body
      // with no field at all is not: it is a request that never came
      // from this form, and writing it would empty the file.
      if (typeof body.text !== "string") {
        return specsRedirect({}, { error: "no text was submitted — nothing was saved" }, back);
      }
      // Spec 166: the "Depends on" field, resolved the way the runtime
      // gate will later resolve it (`resolveDependencyFolder`, which
      // takes a bare number or a full folder and sees archived specs
      // too) — so a dependency the page accepts is one the gate can
      // read. Refused entry by entry, never filtered: a typo left to
      // drop out silently is a dead gate nobody is told about.
      //
      // `bodyToObject` wraps a lone `dependsOn` value in an array for
      // the New-spec form's chip set, so this field's one comma-
      // separated string arrives as `["164, 165"]`. Both shapes are
      // taken apart the same way rather than un-wrapping one of them.
      const ids = (Array.isArray(body.dependsOn) ? body.dependsOn : [body.dependsOn])
        .filter((v): v is string => typeof v === "string")
        .flatMap((v) => v.split(","))
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length > 0) {
        // `specDir` above already 404s a project that does not resolve,
        // so this cannot actually be undefined — defence in depth, not
        // a path a request can reach.
        const discovered = opts.projectRoot
          ? discoverProjects(opts.projectRoot).find((p) => p.name === project)
          : undefined;
        if (!discovered) return specsRedirect({}, { error: "unknown project — nothing was saved" }, back);
        for (const id of ids) {
          const dep = resolveDependencyFolder(discovered, id);
          if (!dep) {
            return specsRedirect({}, { error: `no such spec in this project: ${id} — nothing was saved` }, back);
          }
          if (dep.folder === specFolder) {
            return specsRedirect({}, { error: `a spec cannot depend on itself: ${id} — nothing was saved` }, back);
          }
        }
      }
      const merged = withDependsOnLine(body.text, ids);
      if (merged === null) {
        return specsRedirect(
          {},
          { error: `nowhere to put "Depends on" — Tracking info has no Created line — nothing was saved` },
          back,
        );
      }
      const baseSha = typeof body.baseSha === "string" && body.baseSha ? body.baseSha : null;
      const result = await mergeLock.run(await specsRoot(dir), () =>
        saveSpecFiles(
          gitRun,
          dir,
          (root) => branchStatus.defaultBranch(root),
          [{ file: EDITABLE_SPEC_FILE, text: merged, baseSha }],
          { specLabel: specFolder!, message: editMessage(specFolder!) },
        ),
      );
      if (!result.ok) {
        logRefusal("save", `${project}/${specFolder}`, result.note);
        return specsRedirect({}, { error: result.note }, back);
      }
      // Back to the tab the form is on, where the description now
      // carries its new commit stamp. Not the Overview tab it used to
      // land on: since spec 212 the editor IS a tab of this page, and a
      // reader who has just saved is as likely to keep editing.
      return specsRedirect({}, undefined, back, { note: result.note, ok: true });
    }

    // Spec 212: the checks, on their own route and therefore in their
    // own commit. `/save` above wrote `1-description.md` and, until this
    // route existed, `4-status.md` in the SAME commit — which meant a
    // person had to open the description's editor in order to tick a
    // box. Two forms now, each committing what it owns.
    //
    // `4-status.md` has been the runner's since spec 154 and this is the
    // narrow exception a person is allowed: one existing row's Status
    // mark and nothing else. The new text is computed HERE, from the
    // rows the server itself verified against the file on disk, and
    // never taken from the body — which is what makes "only checkbox
    // lines can change" structural rather than a promise. A `text`
    // field posted at this route is read by nothing.
    const tick = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/tick$/);
    if (tick) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, project, specFolder] = tick;
      const found = specDir(project!, specFolder!);
      if (!found) return new Response("not found", { status: 404 });
      const dir = await machinerySpecDir(project!, found);
      // Before the body is even read: this one WRITES, commits and
      // pushes, and an archived spec's folder is in `archive/`. Hiding
      // the boxes leaves this route reachable for anyone who already
      // has the URL, so the refusal is here and not only on the page.
      if (specRef(project!, specFolder!)?.archived) {
        logRefusal("tick", `${project}/${specFolder}`, ARCHIVED_REFUSAL);
        return specsRedirect({}, { error: ARCHIVED_REFUSAL }, specPagePath(project!, specFolder!));
      }
      const activeJob = queue.list().some(
        (job) => job.project === project && job.specFolder === specFolder &&
          (job.state === "queued" || job.state === "running"),
      );
      if (activeJob) {
        const reason = "another job for this spec is still running — nothing was saved";
        logRefusal("tick", `${project}/${specFolder}`, reason);
        return specsRedirect({}, { error: reason }, specPagePath(project!, specFolder!));
      }
      const sent = await readBounded(req, MAX_SAVE_BODY);
      if ("refusal" in sent) return sent.refusal;
      let body: Record<string, unknown> = {};
      try {
        if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      // The Overview tab, which is where the boxes are.
      const back = specPagePath(project!, specFolder!);
      // `bodyToObject` wraps a lone value in an array for the New-spec
      // form's chip set, exactly as it does for `dependsOn`, so both
      // shapes are taken apart the same way.
      const ticks = (Array.isArray(body.tick) ? body.tick : [body.tick]).filter((v): v is string => typeof v === "string");
      // Save pressed with every box clear. Nothing to say and nothing to
      // commit — not a refusal either.
      if (ticks.length === 0) return specsRedirect({}, undefined, back);
      // Boxes with no phase to read them against is a request that
      // never came from this form.
      if (typeof body.checksPhase !== "string") {
        return specsRedirect({}, { error: "no phase was submitted — nothing was saved" }, back);
      }
      // The row-level guard, on top of the file-level `baseSha` one
      // below. A `null` is every way the page can be out of date at
      // once: no such phase, no such row inside it, or a row someone
      // has already ticked in the very commit the page was drawn from
      // — which a sha alone cannot tell from a fresh render.
      //
      // Chained one row after another, which is safe because exactly
      // one character moves per tick and the cell keeps its padding:
      // a tick never reflows the table, so every other row's text is
      // still what it was.
      let ticked = specFileText(dir, STATUS_SPEC_FILE) ?? "";
      for (const line of ticks) {
        const next = tickStatusLine(ticked, body.checksPhase, line);
        // One row that is not there refuses the WHOLE press, the boxes
        // beside it included — never applied silently while one of them
        // is dropped.
        if (next === null) {
          return specsRedirect(
            {},
            { error: "that check is not there to tick any more — reload the page and look again" },
            back,
          );
        }
        ticked = next;
      }
      // Spec 190: the hold-back note goes with the last check it was
      // waiting on. A declined archive run writes `## Archive held
      // back` naming one open row and where to close it out; ticking
      // that row IS closing it out, so leaving the section behind
      // makes the page go on reporting a spec held back after the
      // reason is gone.
      //
      // The whole file's checks, not the ticked phase's — a spec with
      // open work in another phase is still held back.
      if (!parseStatusChecks(ticked).some((check) => !check.done)) {
        const cleared = clearArchiveHeldBack(ticked);
        if (cleared !== null) ticked = cleared;
      }
      const statusBaseSha = typeof body.statusBaseSha === "string" && body.statusBaseSha ? body.statusBaseSha : null;
      const result = await mergeLock.run(await specsRoot(dir), () =>
        saveSpecFiles(
          gitRun,
          dir,
          (root) => branchStatus.defaultBranch(root),
          [{ file: STATUS_SPEC_FILE, text: ticked, baseSha: statusBaseSha }],
          { specLabel: specFolder!, message: tickMessage(specFolder!) },
        ),
      );
      if (!result.ok) {
        logRefusal("tick", `${project}/${specFolder}`, result.note);
        return specsRedirect({}, { error: result.note }, back);
      }
      return specsRedirect({}, undefined, back, { note: result.note, ok: true });
    }

    // One job, in full: what it IS (the spec's title and description),
    // every step it has already run, and — while a step is running —
    // what that session is doing. Deliberately AFTER the approve/cancel
    // match above, so the new route cannot swallow those.
    // `/specs/<id>` for the page, `/api/queue/<id>` for its JSON twin:
    // the page was renamed, the API contract was not. The first group
    // therefore says WHICH of the two answered, rather than merely
    // whether an `api/` prefix was there.
    const detail = path.match(/^\/(api\/queue|specs)\/([A-Za-z0-9-]+)$/);
    if (detail) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const [, surface, id] = detail;
      const api = surface !== "specs";
      const job = queue.get(id!);
      if (!job) {
        return api ? json({ error: "no such job" }, 404) : new Response("not found", { status: 404 });
      }
      if (api) return json({ generatedAt: new Date().toISOString(), job });
      const html = renderJobDetailPage(await jobDetailView(job), new Date().toISOString(), nav(), {
        tab: url.searchParams.get("tab") ?? undefined,
        step: url.searchParams.get("step") ?? undefined,
      });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("not found", { status: 404 });
  }

  /** The four files, each with the commit that last touched it (spec
   *  150). Read straight off disk on every request, never through
   *  `targets()`'s 5-second cache: the Update button exists to put a
   *  just-pulled file on the screen, and a cached read would show the
   *  one before it.
   *
   *  A file git cannot date still renders — a spec outside git, a file
   *  never committed. The content is what the page is for; the stamp is
   *  what tells one version from another when there is one to tell. */
  function specFileViews(dir: string): SpecFileView[] {
    return SPEC_FILES.map((name) => {
      const { sha, at, checkedAt } = specFileCommits.peekCommitFor(dir, name);
      // The one cache in this spec a sweep over the live list cannot
      // fill: an ARCHIVED spec's page is a real render path too, and
      // archived specs are not `targets()`'s business. So the fill is
      // started from the request and never waited on — bounded by how
      // many archived specs anyone actually opens, rather than by how
      // many exist, which is the unbounded cost spec 178's own plan
      // review rejected. The next view of this page has the stamp.
      if (checkedAt === null) void specFileCommits.commitFor(dir, name);
      return {
        label: name,
        text: specFileText(dir, name),
        sha: sha ?? undefined,
        at: at ?? undefined,
        // Nothing has ever asked. Not "git cannot date this file" —
        // that is a real, timestamped answer and shows no stamp at all,
        // exactly as it did before this cache existed.
        checking: checkedAt === null,
      };
    });
  }

  /** WHEN a spec was archived. The stamp the archive step writes into
   *  `4-status.md` first; failing that, the commit that last touched the
   *  folder — an archived spec is not edited afterwards, so the newest
   *  commit under `archive/<folder>` IS the one that moved it there.
   *
   *  `dir` is the spec's OWN folder and the pathspec is `"."`, the same
   *  dir/pathspec pairing every other `lastCommitOf` call here uses: git
   *  is run IN the directory being asked about, and a pathspec naming a
   *  path outside it would answer nothing at all.
   *
   *  `null` from both is a real answer and the page prints it in words.
   *  Only a spec with no stamp reaches git, which since spec 147 is a
   *  shrinking minority. */
  function archivedAt(dir: string): { date: string | null; checking: boolean } {
    const stamped = specArchivedDate(dir);
    if (stamped) return { date: stamped, checking: false };
    // A peek since spec 208, and the same "read, never take" rule as
    // everywhere else: `refreshSpecCaches` warms exactly this question,
    // for exactly the archived specs that have no stamp on disk.
    const { at, checkedAt } = specFileCommits.peekCommitFor(dir, ".");
    // Nothing is started from here, unlike `specFileViews`: this exact
    // question is on the warmer's own sweep, for exactly the archived
    // specs that have no stamp, so `/archive` spawns nothing at all.
    if (checkedAt === null) return { date: null, checking: true };
    // The DATE, not the instant: every stamp on disk is a date, and one
    // column reading two ways is worse than either.
    return { date: at ? at.slice(0, 10) : null, checking: false };
  }

  /** Which steps an archived spec's own `4-status.md` CLAIMS it has had
   *  (spec 224) — what its phase lines and its pip strip are drawn from
   *  once its row is opened.
   *
   *  The file's own word, and deliberately: a LIVE row's done-set is
   *  git-verified, through the `workflowHistory` cache `withFreshness`
   *  peeks — and `refreshSpecCaches` never warms that cache for an
   *  archived spec, because doing so is the unbounded cost spec 178's
   *  plan review turned down. Reusing the live path here would read
   *  `{history: null}` for every archived row and draw "checking…" for
   *  ever, which is not a truer answer than this one, only a slower way
   *  of giving none.
   *
   *  A THIRD reader of the same file beside `archivedAt` and
   *  `specDurationMs`, on the same terms as both: its own question, and
   *  an empty list for every way the answer can be missing. */
  function archivedSteps(dir: string): string[] {
    const status = specFileText(dir, "4-status.md");
    return status ? parseStatus(status).workflowSteps : [];
  }

  /** What each of this archived spec's phases actually ran on, from its
   *  own `4-status.md` (spec 244) — the model reader beside
   *  `archivedSteps`' step reader, on the same terms: the file's own
   *  claim, and an empty map for a spec that predates the line or names
   *  nothing. */
  function archivedModels(dir: string): Record<string, string> {
    const status = specFileText(dir, "4-status.md");
    return status ? parseStatus(status).stepModels : {};
  }

  /** What each of this archived spec's phases recorded about its OWN
   *  run (spec 245's write side, spec 247's read side) — Model, Time
   *  spent and Cost, each in the phase's own file rather than
   *  `4-status.md` alone. Beside `archivedModels` above, on the same
   *  terms: the file's own claim, an empty entry for a step whose file
   *  names nothing. */
  function archivedPhaseOutcomes(dir: string): Record<string, PhaseOutcome> {
    const result: Record<string, PhaseOutcome> = {};
    for (const step of PHASE_LINES) {
      const outcome = specPhaseOutcome(dir, step);
      if (Object.keys(outcome).length > 0) result[step] = outcome;
    }
    return result;
  }

  /** Every archived spec the reader's own chip asks for, as a row for
   *  the Specs list (spec 221; this built the `/archive` page until that
   *  page retired).
   *
   *  Off the scan every other lookup on this route already shares:
   *  `refs` holds what each spec IS — title, description, folder,
   *  directory — for archived and live specs alike, and `archived` holds
   *  the keys of the archived ones with the allowlist already applied.
   *  It used to walk `discoverProjects` a second time for the same
   *  answer. One flat list, unordered: the ordering, the filtering and
   *  the search are the render layer's, so there is one copy of each
   *  rule and the route has none. `description` is whole, because the
   *  search reads all of it.
   *
   *  **The state is what decides how much of this gets built, and that
   *  is the whole point.** A row costs three small file reads
   *  (`archivedAt`, the duration stamp and the steps its `4-status.md`
   *  claims — spec 224, when the row grew phase lines), aide alone archives about
   *  150 specs, and this page rebuilds itself on every change event on
   *  every open tab. A view whose chip cannot show an archived row
   *  builds nothing for one — with ONE exception, and it is spec 193's:
   *  an archived spec whose own branch is still on origin has NOT
   *  finished, and taking its row off the reading view would hide the
   *  exact failure spec 193 exists to surface. 1-description.md asks for
   *  the default chip to be today's reading view unchanged in content,
   *  and that is what this keeps. The set is `peekUnlanded()`, it is
   *  normally empty, and it is bounded by how many specs are genuinely
   *  stranded rather than by how big the archive has grown.
   *
   *  Nothing here runs git: `archivedAt` and the not-landed mark are
   *  peeks against caches a background schedule keeps warm (spec 208),
   *  exactly as `/archive` relied on. */
  function archivedSpecRows(state: string | undefined): ArchivedSpecView[] {
    if (!opts.projectRoot) return [];
    // Fills `scan`, and — through `peekUnlanded` below — refills
    // `unlanded`, which `resolveProject` reads to decide whether an
    // archived spec may have `archive` asked for it a second time (spec
    // 193's way out, spec 202's other half). Both are peeks and an
    // intersection in memory, never a walk, so neither is what the gate
    // below is holding back.
    targets();
    const open = new Set(peekUnlanded());
    // Filled by the same call, and read after it (spec 220): the subset
    // of `open` that is open because the project reviews its code.
    const reviewing = new Set(prOpen);
    const openCheckedAt = peekUnlandedCheckedAt();
    const everyOne = filterShowsArchived(state);
    const rows: ArchivedSpecView[] = [];
    for (const key of scan?.archived ?? []) {
      // The two marks come from one fact and mean opposite things (spec
      // 220), so the deliberate one wins outright rather than both being
      // set and the renderer picking.
      const prWaiting = reviewing.has(key);
      const notLanded = open.has(key) && !prWaiting;
      // The gate, and it is BEFORE the two file reads under it — after
      // them it would be a filter, not a gate, and would cost the
      // default view exactly what it exists to save. A PR waiting on
      // review is not the failure this gate exists to surface, so it
      // does not bypass it the way `notLanded` does.
      if (!everyOne && !notLanded) continue;
      const ref = scan?.refs.get(key);
      if (!ref) continue;
      const project = key.slice(0, key.indexOf("/"));
      const when = archivedAt(ref.dir);
      rows.push({
        project,
        folder: ref.folder,
        title: ref.title ?? undefined,
        description: ref.description ?? undefined,
        archivedAt: when.date,
        dateChecking: when.checking,
        notLanded,
        notLandedCheckedAt: notLanded ? (openCheckedAt ?? undefined) : undefined,
        prOpen: prWaiting,
        // Off the newest job that reported one. The queue keeps two
        // hundred jobs and the archive grows past that, so an old row
        // simply has no link — the mark still says the branch is open,
        // which is the part that matters.
        prUrl: prWaiting ? queue.pullRequestFor(project, ref.folder).prUrl : undefined,
        // The stored figure and nothing else (spec 207): the queue's own
        // records are gone for all but the newest rows here, and a
        // column that answered for some of them out of memory would be a
        // column whose blanks move about.
        durationMs: specDurationMs(ref.dir) ?? undefined,
        // The row opens now (spec 224), and this is what it opens on.
        done: archivedSteps(ref.dir),
        models: archivedModels(ref.dir),
        phaseOutcomes: archivedPhaseOutcomes(ref.dir),
      });
    }
    return rows;
  }

  /** Spec 212: the page's own tab decides how much this has to ask git.
   *  The Description tab's form carries `1-description.md`'s commit as
   *  its guard, and that is a `git log` this page never made before —
   *  so it is made for that tab and no other. The checks' own guard is
   *  bounded the same way, by there being an open check to draw at all;
   *  the Depends-on resolution short-circuits with no git at all for a
   *  spec whose description carries no `Depends on:` line.
   *
   *  The Description tab is also the one that AWAITS the dashboard's own
   *  checkout rather than peeking (spec 205): the text in the box and
   *  the commit Save compares it against have to come out of the same
   *  checkout Save will write through, or the first edit after a restart
   *  refuses as "changed since you opened it". Every other tab keeps the
   *  peek, because a spec page must not wait on the boot-time clone
   *  (spec 208, criterion 9) — including Overview, whose checks form
   *  therefore carries a `4-status.md` sha read through whichever
   *  checkout answered. In the minutes before the clone lands that can
   *  be the person's own, and a tick drawn from it is REFUSED rather
   *  than misapplied: the guard fails safe, and a reload fixes it. */
  async function specPageView(
    project: string,
    specFolder: string,
    tab?: string,
  ): Promise<SpecPageView | null> {
    const found = specDir(project, specFolder);
    if (!found) return null;
    // The four files as the dashboard's own checkout has them (spec
    // 205) — which is where Save writes, so it is where a save has to be
    // visible. The person's checkout catches up when the specs cron
    // pulls it, and the Update button is what closes that gap on
    // demand.
    const dir = peekMachinerySpecDir(project, found);
    const ref = specRef(project, specFolder);
    // Whatever is in flight, or failing that the most recently active —
    // the rule `jobGroup` uses for the row's own lead, over the same
    // in-flight states (queued and running — there is no stop between
    // steps since spec 149) and the same "started, or failing that
    // created" clock, so the page a name opens speaks for the job the
    // name spoke for.
    const matchingJobs = queue
      .list()
      .filter((j) => j.project === project && j.specFolder === specFolder);
    const jobs = currentWorkRoundJobs(matchingJobs)
      .sort((a, b) => (Date.parse(b.startedAt ?? b.createdAt) || 0) - (Date.parse(a.startedAt ?? a.createdAt) || 0));
    const inFlight = (j: Job): boolean => j.state === "queued" || j.state === "running";
    const leadJob = jobs.find(inFlight) ?? jobs[0];
    const files = specFileViews(dir);
    // Off the text `specFileViews` has already read, so the page makes
    // no second git or disk read for the same file.
    const status = files.find((f) => f.label === STATUS_SPEC_FILE);
    const statusText = status?.text ?? "";
    const rows = parseStatusChecks(statusText);
    // Which phase's open rows may be TICKED (spec 188, back on Overview
    // since spec 212): the CURRENT phase, which is the first phase
    // section still carrying an open mark — the same phase the spec
    // list's own column shows. `null` for a `4-status.md` with no phase
    // sections at all (a LOW-complexity spec on the simple checklist
    // layout, or one never analysed) and `"done"` when every section is
    // clear; both leave nothing tickable, and the page then draws the
    // rows with no form.
    const parsedStatus = parseStatus(statusText);
    const statusPhase = parsedStatus.phase;
    const anyTickable = rows.some((row) => !row.done && row.phase === statusPhase);
    // Read out of the DASHBOARD's own checkout, like the text beside it
    // (spec 205): the commit stamp a form compares against and the text
    // in the box have to be the same instant, or every save would refuse
    // as "changed since you opened it".
    const statusCommit = anyTickable ? await lastCommitOf(gitRun, dir, STATUS_SPEC_FILE) : null;
    const formDir = tab === "description" ? await machinerySpecDir(project, found) : null;
    const descriptionCommit = formDir ? await lastCommitOf(gitRun, formDir, EDITABLE_SPEC_FILE) : null;
    const descriptionText = formDir ? specFileText(formDir, EDITABLE_SPEC_FILE) : null;
    // Spec 239: the same join the front page's row composes
    // (`phasesFor`), over this spec's own jobs and target — never a
    // second count. The per-job git work `jobRow` does is not new load:
    // the front page already pays it over every job of every spec, and
    // this is one spec's own attempts (typically 1-3).
    // `withFreshness` (never a live git spawn — spec 208 — it only peeks
    // the `workflowHistory` cache the schedule already warmed) is what
    // fills a live spec's `done` in from its own commits; the raw
    // `targets()` entry never carries it. Every other caller of
    // `targets()` on this route already goes through it (the front
    // page's row, the job page); this one had not.
    const target = withFreshness(
      targets().filter((t) => t.project === project && t.specFolder === specFolder),
    )[0];
    const jobRows = await Promise.all(jobs.map(jobRow));
    const jobDetails = await Promise.all(jobs.map(jobDetailView));
    // jobs is newest-first; oldest = attempt 1. Only tagged when there is
    // more than one job — a single-attempt spec draws no marker at all
    // (spec 242's own "nothing to show, show nothing" rule, at row level).
    const multiAttempt = jobs.length > 1;
    const attemptNumber = (j: Job): number | undefined =>
      multiAttempt ? jobs.length - jobs.indexOf(j) : undefined;
    const leadDetail = leadJob ? jobDetails[jobs.indexOf(leadJob)] : undefined;
    const lead = leadDetail && {
      ...leadDetail,
      runningStep: leadDetail.runningStep && { ...leadDetail.runningStep, attempt: attemptNumber(leadJob!) },
    };
    // Spec 242: every step from every job in this work round, oldest job
    // first — `jobs` is newest-first, so this flattens it in reverse.
    const steps = jobs
      .map((j, i) => jobDetails[i]!.results.map((r) => ({ ...r, attempt: attemptNumber(j) })))
      .reverse()
      .flat();
    return {
      project,
      specFolder,
      title: ref?.title ?? undefined,
      archived: ref?.archived ?? false,
      // Spec 166: the dependency line is lifted OUT of the textarea and
      // into a field of its own. Left in both, a save could not tell
      // which of the two the person meant. The Description tab strips
      // it; Overview shows what it resolves to, read-only.
      files: files.map((f) => {
        if (f.label !== EDITABLE_SPEC_FILE) return f;
        const text = formDir ? descriptionText : f.text;
        return text === null ? { ...f, text } : { ...f, text: stripDependsOnLine(text) };
      }),
      checks: { rows, phase: statusPhase ?? undefined, baseSha: statusCommit?.sha },
      // Ticked by what the LINE resolves to, not by what it says:
      // `resolve_dependency_folder` takes a bare number, and a
      // hand-written line usually is one — matching the raw string
      // against a folder would leave a real dependency unticked, and
      // the next Save would then silently drop it.
      dependsOn: dependencyFolders(project, dir),
      // Spec 174: the New-spec page's picker, fed this project's own
      // active specs. Self excluded — the one box that could only ever
      // earn spec 166's "cannot depend on itself" refusal.
      dependsOnOptions: targets().filter((t) => t.project === project && t.specFolder !== specFolder),
      phases: phasesFor(jobRows, target),
      // `targets()` deliberately drops an archived spec (serve.ts:792-796),
      // so `target` — and `target?.done` — is always empty for one. The
      // file's own claim is the only answer left, the same one
      // `archivedSteps()` reads for the front page's archived rows (spec
      // 224) — read here from the `statusText` already in hand rather than
      // through that helper, which re-reads the file from disk.
      done: ref?.archived ? parsedStatus.workflowSteps : (target?.done ?? []),
      descriptionBaseSha: descriptionCommit?.sha,
      lead,
      steps,
      // Built from the page's own path, so the two cannot drift into a
      // button that posts where nothing listens.
      updateAction: `/api/queue${specPagePath(project, specFolder)}/update`,
      resetAction: `${specPagePath(project, specFolder)}/reset`,
      resetUnavailableReason: matchingJobs.some((job) => job.state === "queued" || job.state === "running")
        ? "another job for this spec is still running"
        : queue.list().some((job) => job.landing)
          ? "a landing is in progress"
          : undefined,
      saveAction: `/api/queue${specPagePath(project, specFolder)}/save`,
      tickAction: `/api/queue${specPagePath(project, specFolder)}/tick`,
      // The Reopen control on an archived spec posts to `/api/queue`,
      // which checks the token like every other enqueue (spec 198).
      token: queueToken,
    };
  }

  async function jobDetailView(job: Job): Promise<JobDetailView> {
    const target = targets().find((t) => t.project === job.project && t.specFolder === job.specFolder);
    // Which CLI this page is about (spec 125). A running step's tool is
    // not recorded anywhere yet — the result file that would carry it is
    // written when the step ENDS — so it is resolved the same way the
    // argv resolved it: from the config entry the chosen model name
    // points at. A finished job answers from its own last result.
    const step = job.steps[job.stepIndex];
    const running = job.state === "running";
    const named = running
      ? queue.defaults.modelChoices?.[resolveStepModel(job, step ?? "", queue.defaults.model) ?? ""]?.tool
      : job.results[job.results.length - 1]?.tool;
    const tool = named ?? "claude";
    // What this job's step WROTE (spec 150). The step running now, or
    // failing that the last one that ran — read off disk, uncached and
    // ungitted: this page says what the phase produced, and which
    // VERSION of it is the spec page's question.
    const shownStep = step ?? job.steps[job.steps.length - 1];
    const dir = specDir(job.project, job.specFolder);
    const phase = dir && shownStep ? specPhaseFile(dir, shownStep) : null;
    return {
      ...(await jobRow(job)),
      tool,
      title: target?.title,
      finishedAt: job.finishedAt,
      // Each finished step's OWN transcript (spec 240), read from its
      // own `streamFile` rather than the job's last one — a three-step
      // attempt used to make only its last step's log reachable at all.
      results: job.results.map((r) => ({
        ...r,
        tokens: r.tokens?.total,
        logs: r.streamFile ? summarizeStream(tailFile(r.streamFile), { tool: r.tool ?? named }) : undefined,
      })),
      phase: phase ?? undefined,
      // The step running RIGHT NOW, when one is: it has no `StepResult`
      // yet, so it cannot ride along in `results` above, and its
      // transcript is the job's own live pointer.
      runningStep:
        running && step
          ? {
              step,
              sessionId: job.sessionId,
              logs: job.streamFile ? summarizeStream(tailFile(job.streamFile), { tool: named }) : [],
            }
          : undefined,
      archiveHeldBack: target?.archiveHeldBack?.reason,
    };
  }

  return {
    port: server.port,
    /** How many specs roots are being watched right now (spec 204).
     *  Here for one question nothing else can answer: that `stop()` let
     *  the handles go. A watcher nobody closes outlives the server for
     *  the life of the process, and the directories it points at are
     *  removed underneath it. */
    specWatchCount: () => specWatchers.size,
    // `server.stop` resolves once the last connection is closed. Nothing
    // here waits for that — the caller is shutting down — so the promise
    // is dropped on purpose rather than by accident.
    stop: () => {
      if (timer) clearInterval(timer);
      if (driftTimer) clearInterval(driftTimer);
      if (specCacheTimer) clearInterval(specCacheTimer);
      clearInterval(keepAlive);
      closeSpecWatchers();
      // Every watching page, let go of deliberately: `server.stop(true)`
      // cuts the sockets, and a controller left in the set would be
      // written to by nothing but would still be held.
      for (const c of [...watchers]) {
        try {
          c.close();
        } catch {
          // already gone, which is the outcome either way
        }
      }
      watchers.clear();
      void server.stop(true);
    },
  };
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

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] !== "serve") {
    console.error(
      "usage: serve.ts serve --site DIR [--port N] [--bind ADDR] [--claude-usage URL]\n" +
        "                     [--mirror FILE] [--root DIR] [--token-file FILE]\n" +
        "                     [--queue-mirror FILE] [--queue-projects a,b]\n" +
        "                     [--runner-bin PATH] [--result-dir DIR] [--queue-config FILE]",
    );
    process.exit(2);
  }
  const opts = parseArgs(argv.slice(1));
  const s = createServer(opts);
  console.log(`aide-dashboard serving ${opts.siteDir} on :${s.port}`);
}
