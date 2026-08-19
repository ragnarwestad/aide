// The aide-dashboard server (spec 80): serves the generated static
// site, receives aide-run events (POST /api/aide-run), and renders
// /live through the generator's layout, enriched lazily from
// claude-usage's /api/live. Replaces the python3 static server on the
// serving host — same port, same launchd label.
//
// CLI: serve --site DIR [--port N] [--claude-usage URL] [--mirror FILE]

import { createHash, timingSafeEqual } from "node:crypto";
import {
  closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { AideRunStore, parseAideRun } from "./aide-run-store.ts";
import {
  BranchStatusChecker, createGitRunner, projectCheckout, specBranch, type GitRunner,
} from "./branch-status.ts";
import { DescriptionFreshnessChecker } from "./description-freshness.ts";
import { mergeBranchIntoDefault, type RepoMergeResult } from "./branch-merge.ts";
import { LiveEnricher } from "./live.ts";
import {
  buildProjectViews, configValue, discoverProjects,
  type DiscoveredProject, type SpecRef,
} from "./discover.ts";
import { parseManifest, type ManifestData } from "./parse-manifest.ts";
import { previewUrlFor } from "./preview-url.ts";
import { archiveHeldBackReason, parseStatus } from "./parse-status.ts";
import { Notifier } from "./notify.ts";
import {
  QueueStore, mergeQueueDefaults, parseQueueProjects, persistQueueProjects,
  type BranchRef, type Job, type QueueDefaults, type ProjectResolver,
} from "./queue.ts";
import { addProject, projectNameError, removeProject, type ProjectStep } from "./project-admin.ts";
import { Runner, type StepOutcome } from "./runner.ts";
import { summarizeStream } from "./parse-stream.ts";
import {
  ABOUT_PAGE,
  NEW_SPEC_ROUTE,
  OVERVIEW_PAGE,
  PROJECTS_ROUTE,
  FILTER_FIELD_PREFIX,
  FILTER_KEYS,
  navEntries,
  renderJobDetailPage,
  renderNewSpecPage,
  renderProjectsPage,
  renderAddProjectPage,
  renderRemoveProjectPage,
  ADD_PROJECT_ROUTE,
  renderQueuePage,
  renderQueueRows,
  type JobDetailView,
  type NavEntry,
  type ProjectView,
  type QueueRowView,
  type QueueTarget,
} from "./render.ts";

const MAX_BODY = 4096;

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
  timeoutSec: 1200,
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  // `resolve` would fall to `default` anyway; it is named because a
  // merge is not an implement and that is a decision, not an accident
  // of which key happens to be missing (spec 106).
  model: { implement: "opus", resolve: "sonnet", default: "sonnet" },
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
  /** Where each allowlisted project is checked out on this machine. */
  queueProjectRoot?: string;
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
  /** How the merge check runs git. A test seam: the real one spawns a
   *  subprocess, which no test should. */
  gitRun?: GitRunner;
  /** How long the project's own install command may run after its code
   *  merged. A test seam above all — the default is a bound, not a
   *  setting anybody is expected to tune. */
  queueInstallTimeoutMs?: number;
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
async function readBounded(req: Request): Promise<{ text: string } | { refusal: Response }> {
  const claimed = Number(req.headers.get("content-length") ?? "0");
  if (claimed > MAX_BODY) return { refusal: json({ error: "payload too large" }, 413) };
  const text = await req.text();
  if (text.length > MAX_BODY) return { refusal: json({ error: "payload too large" }, 413) };
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

/** Where a form POST goes back to. Built from the five view keys the
 *  page's own forms send (`FILTER_KEYS`, under `FILTER_FIELD_PREFIX`),
 *  so pressing Run, Approve, Cancel or Merge lands the reader back on
 *  the list they were looking at instead of the default one.
 *
 *  Encoded one key at a time rather than through `URLSearchParams`,
 *  which writes a space as `+`: a refusal's reason goes in this string
 *  and is read by a person. With nothing to carry the target stays
 *  exactly `/`, never `/?`. */
function specsRedirect(
  body: unknown,
  refusal?: { error: string; spec?: string; reason?: string },
  // Which page the form was ON. `/` for every control on the spec list,
  // which is all of them but three: the project panel moved to
  // `/projects` with spec 115 and the New-spec form to `/new` with spec
  // 121, and a reader refused on either must not be dropped onto the
  // spec list to read the answer.
  target: string = "/",
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
    // And WHY, when the answer is one the page can act on rather than
    // only show: a conflict is the one refusal a `resolve` step could
    // finish, so it is the one the row may offer that step for. Absent
    // for every other refusal, which is what keeps the offer narrow.
    if (refusal.reason) parts.push(`errorReason=${encodeURIComponent(refusal.reason)}`);
  }
  const query = parts.join("&");
  return new Response(null, { status: 303, headers: { location: query ? `${target}?${query}` : target } });
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
    if (typeof out.gateAfter === "string") out.gateAfter = [out.gateAfter];
    if (typeof out.extraProjects === "string") out.extraProjects = [out.extraProjects];
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
        const value = params.get(key);
        if (value) picked[key.slice("model.".length)] = value;
        delete out[key];
      }
      if (Object.keys(picked).length) out.model = picked;
    }
    // A form posts a checkbox only when it is ticked. Unticked means
    // "run straight through", which must be said explicitly — the
    // schema's default is to gate after every step.
    if (out.gateAfter === undefined) out.gateAfter = out.gate ? undefined : [];
    delete out.gate;
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

// Which workflow steps a spec has already had. Read off the files
// themselves, so the answer cannot drift from what is on disk:
//   * create — the folder exists at all
//   * analyze — 2-analysis.md is no longer the placeholder
//   * review-plan — 3-solution.md carries a "Plan review" section
//   * implement — the status file reports 100%
// A finished step is MARKED, not forbidden: re-analyzing after the code
// has moved on is a legitimate thing to want.
function stepsAlreadyDone(specDir: string, percent: number | undefined): string[] {
  // `create`'s file-truth is that this folder EXISTS — which it does, by
  // construction: this function only ever runs against a directory
  // `discoverProjects` already found on disk (spec 116). The three
  // checks below each exist because their truth is not implied by the
  // folder alone; create's is, so it needs no read.
  const done: string[] = ["create"];
  const read = (name: string): string => {
    try {
      return readFileSync(join(specDir, name), "utf-8");
    } catch {
      return "";
    }
  };
  const analysis = read("2-analysis.md");
  if (analysis.length > 400 && !analysis.includes("[filled in by")) done.push("analyze");
  const solution = read("3-solution.md");
  if (/^##\s+Plan review/m.test(solution)) done.push("review-plan");
  if (percent === 100) done.push("implement");
  return done;
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

/** The argv `aide-run-spec` is started with. Extracted so it can be read
 *  in a test: an unattended run's arguments are the whole contract, and
 *  a missing `--extra-project-dir` loses half a job's work silently. */
export function runnerArgv(
  job: Job,
  step: string,
  resultFile: string,
  o: { runnerBin: string; projectRoot: string; push: string },
  sessionId?: string,
  streamFile?: string,
): string[] {
  const model = job.model[step];
  return [
    o.runnerBin,
    "--project-dir", join(o.projectRoot, job.project),
    "--command", step,
    "--spec", job.specFolder,
    "--budget-usd", String(job.budgetUsd),
    "--timeout-sec", String(job.timeoutSec),
    "--permission-mode", job.permissionMode[step] ?? "acceptEdits",
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
    // Chosen by the runner BEFORE the spawn, so the queue can watch the
    // session while the step runs instead of learning it from a result
    // that only exists once the step is over.
    ...(sessionId ? ["--session-id", sessionId] : []),
    ...(streamFile ? ["--stream-file", streamFile] : []),
    // Every other repo this job said it would touch, by name, resolved
    // against the same root the primary project comes from.
    ...(job.extraProjects ?? []).flatMap((p) => ["--extra-project-dir", join(o.projectRoot, p)]),
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
 *  BUILD on merged code. `analyze`, `review-plan` and `create` write
 *  only the spec's own folder in the specs repo and conflict with
 *  nothing, so a chain of dependent specs can be analysed in parallel
 *  the moment it is queued.
 *
 *  A literal array, matched by a test rather than shared: the same
 *  vocabulary is a plain string in `core/scripts/aide-run-spec`, with no
 *  shared source and no compiler between the two, and
 *  `test_the_two_copies_of_the_dependency_gate_agree` is what notices
 *  the drift — exactly as `WORKFLOW_STEPS` already does. */
export const DEPENDENCY_GATED_STEPS = ["implement", "resolve", "archive"] as const;

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
  let scan: { at: number; targets: QueueTarget[]; archived: string[] } | null = null;
  const targets = (): QueueTarget[] => {
    const now = Date.now();
    if (scan && now - scan.at < 5000) return scan.targets;
    const found: QueueTarget[] = [];
    const gone: string[] = [];
    if (opts.projectRoot) {
      for (const p of discoverProjects(opts.projectRoot)) {
        if (!allowed.has(p.name)) continue;
        for (const s of p.specs) {
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
            percent: status?.progress?.percent,
            // The FILES, and nothing else (spec 108). It used to be
            // unioned with the queue's own record of what it ran, so
            // either one being true was enough — which is how an
            // archive job that finished without moving anything counted
            // as an archived spec, and how a phase could read "done" on
            // a row whose files said otherwise. What a job reported is
            // still shown, as a qualifier on the phase's line.
            done: stepsAlreadyDone(s.dir, status?.progress?.percent),
            archiveHeldBack: heldBack ? { reason: heldBack } : undefined,
          });
        }
      }
    }
    scan = { at: now, targets: found, archived: gone };
    return found;
  };
  const resolveProject: ProjectResolver = (project) => {
    if (!allowed.has(project)) return null;
    const folders = targets().filter((t) => t.project === project).map((t) => t.specFolder);
    return folders.length > 0 ? { specFolders: folders } : null;
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
  });

  // The runner exists only when a binary is configured. Spawned
  // DETACHED, in its own process group: measured on the mini, such a
  // child survives `launchctl bootout`, so a redeploy does not kill a
  // run — and the group is what SIGTERM must reach, since claude spawns
  // children of its own.
  const notifier = new Notifier({ command: opts.queueNotifyCommand });
  // One resolution, two users: the runner runs a spec in this directory,
  // and the merge check asks git about the branch it pushed from there.
  const projectDir = (project: string) => projectCheckout(opts.queueProjectRoot, project);
  // One runner, two users now: the read path asks whether a branch
  // landed, the write path lands it.
  const gitRun: GitRunner = opts.gitRun ?? createGitRunner();
  const branchStatus = new BranchStatusChecker({ run: gitRun });
  // One merge at a time per repo. Every spec shares the specs root, and
  // two specs in one project share that repo too, so two presses a few
  // milliseconds apart were two git sequences in one working tree.
  const mergeLock = createRootLock();
  // A third user of the same runner: has the description moved on since
  // the plan was written?
  const freshness = new DescriptionFreshnessChecker({ run: gitRun });
  const runner = opts.queueRunnerBin
    ? new Runner({
        store: queue,
        projectDir,
        runnerBin: opts.queueRunnerBin,
        resultDir: opts.queueResultDir ?? join(homedir(), "aide-dashboard", "jobs"),
        maxConcurrent: opts.queueConcurrency ?? DEFAULT_QUEUE_CONCURRENCY,
        now: () => new Date().toISOString(),
        today: () => new Date().toISOString().slice(0, 10),
        spawn: (job, step, resultFile, sessionId, streamFile) => {
          mkdirSync(dirname(resultFile), { recursive: true });
          const proc = Bun.spawn({
            cmd: runnerArgv(
              job,
              step,
              resultFile,
              {
                runnerBin: opts.queueRunnerBin!,
                projectRoot: opts.queueProjectRoot ?? "",
                push: opts.queuePush ?? "branch",
              },
              sessionId,
              streamFile,
            ),
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
        // A created spec is invisible to this page until its branch is
        // on the default branch of the checkout the page reads, so the
        // one step that MAKES a spec lands its own work. The returned
        // promise holds the queue for as long as that takes; see
        // `Runner.tick()`.
        onStepDone: (job, step, outcome) =>
          step === "create" && outcome.ok ? landNewSpec(job, outcome) : undefined,
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
   *  against data that existed after it did. What it rests on is cached
   *  anyway — `targets()` for 5 s, each merge answer for 30 s. */
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
        for (const root of [projectDir(job.project), project.specsRoot]) {
          merged = (await branchStatus.isMerged(root, branch)) && merged;
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
    runner.tick(await blockedDependencies());
  }

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
        ? [{ root: projectDir(job.project), url: job.branchUrl }]
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
      const text = readFileSync(join(projectDir(project), ".aide", "project.yaml"), "utf-8");
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
    // Asked of EACH repo's own checkout. Asking `projectDir(job.project)`
    // about a branch that lives in the specs repo was not merely a
    // missing warning: a stale remote-tracking ref of the same name in
    // the project answered it cleanly, and the page said "merged" about
    // work that was not (1-description.md, "Measured again").
    const branch = specBranch(job.specFolder);
    // Asked of the project's OWN checkout only. A spec pushes a branch
    // of the same name to the repo holding its plan, and a plan is not
    // something anyone can open and try — the same distinction the merge
    // button already draws, drawn the same way, by comparing roots.
    const codeRoot = projectDir(job.project);
    const preview = projectManifest(job.project)?.deployment?.preview;
    const branchUrls = await Promise.all(
      jobBranches(job).map(async (b) => ({
        label: repoLabel(b.root),
        url: b.url,
        merged: await branchStatus.isMerged(b.root, branch),
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
      state: job.state,
      model: job.modelChoice ?? (step ? job.model[step] : undefined),
      spentUsd: job.spentUsd,
      // The stored split is five numbers; the page shows one. Flattened
      // here, at the boundary, so no render file has to know what a
      // result file looks like (spec 118).
      spentTokens: job.spentTokens,
      timeoutSec: job.timeoutSec,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      branchUrls,
      stopReason: job.stopReason,
      error: job.error,
      results: job.results.map((r) => ({
        step: r.step, ok: r.ok, costUsd: r.costUsd, tokens: r.tokens?.total,
      })),
    };
  }

  /** Merge every repo this spec has a branch in, one at a time, and
   *  report each on its own. Several repos cannot be merged atomically:
   *  if one succeeds and another fails, saying so plainly is the whole
   *  point — a single green tick would recreate the problem this route
   *  exists to solve, mirrored. */
  async function mergeSpecBranches(job: Job): Promise<RepoMergeResult[]> {
    const branch = specBranch(job.specFolder);
    // The queue's own history, re-derived HERE from the job id. Nothing
    // the browser sent is used to decide which directory git runs in.
    const known = queue.branchesFor(job.project, job.specFolder);
    const branches = known.length ? known : jobBranches(job);
    // The plan first, the code last. A run records the project before
    // its specs root (`aide-run-spec`, `roots`), so a reader watching
    // the page saw the code land before the plan describing it — and the
    // code is the one that matters, so it should be the last word. Sorted
    // here rather than in the script: `roots` also decides commit,
    // worktree and push order on every future run, none of which this is
    // about. A passenger repo named with --extra-project-dir carries code
    // too, so it goes last for the same reason the project does.
    const codeRoots = new Set([projectDir(job.project), ...job.extraProjects.map(projectDir)]);
    // `sort` is stable, so two repos of the same kind keep the order the
    // run recorded them in.
    const ordered = [...branches].sort(
      (a, b) => Number(codeRoots.has(a.root)) - Number(codeRoots.has(b.root)),
    );
    const results: RepoMergeResult[] = [];
    for (const b of ordered) {
      const base = await branchStatus.defaultBranch(b.root);
      if (!base) {
        // No mutation is attempted on a repo whose default branch we
        // cannot name — guessing which branch to merge INTO is the one
        // guess with no safe direction.
        results.push({ root: b.root, ok: false, error: `cannot work out the default branch in ${b.root}` });
        continue;
      }
      // The lock goes around the git-mutating call and nothing else:
      // `defaultBranch` above only asks a question, and holding the
      // root while asking it would serialize page loads too.
      const result = await mergeLock.run(b.root, () => mergeBranchIntoDefault(gitRun, b.root, branch, base));
      // The check caches for 30 s. Without this, the page that triggered
      // the merge would show its own result as "not merged".
      if (result.ok) branchStatus.invalidate(b.root, branch);
      // Merged is not deployed. For a tool that lives in `~/.local/bin`,
      // the code landing on the default branch changes nothing on the
      // machine until it is installed — which is why spec 92's merged
      // code kept running as the old version. The install belongs to the
      // project, so the project says what it is.
      if (result.ok && b.root === projectDir(job.project)) await installAfterMerge(result);
      results.push(result);
    }
    return results;
  }

  /** Put a newly created spec where the page can see it (spec 93).
   *
   *  This is the one merge on the dashboard that no one pressed a button
   *  for, and it is not a convenience: the spec list shows what is on
   *  disk in the main checkout, which every run is careful never to
   *  leave its default branch, so a created spec that is only pushed to
   *  a branch appears nowhere at all. A job parked in `awaiting-approval` until
   *  somebody notices would not be the feature with one extra click — it
   *  would be the feature not working.
   *
   *  The branch comes from the RESULT, never from `specBranch(...)`: the
   *  folder this spec ended up with did not exist when its branch was
   *  named. Everything else is `mergeBranchIntoDefault` unchanged — the
   *  same function, the same three decisions, the same per-repo report
   *  the Merge button already gets.
   *
   *  No install is run afterwards, unlike the manual route: a create step
   *  writes four templated markdown files and no code, so there is
   *  nothing to deploy. */
  async function landNewSpec(job: Job, outcome: Partial<StepOutcome>): Promise<void> {
    try {
      const branch = outcome.branch;
      const repos = outcome.branchUrls ?? [];
      if (!branch || repos.length === 0) {
        queue.update(job.id, {
          error:
            "the spec was created, but the run reported no pushed branch to land it from — " +
            "merge it by hand, or check the queue's push mode",
        });
        return;
      }
      const failures: string[] = [];
      for (const repo of repos) {
        const base = await branchStatus.defaultBranch(repo.root);
        if (!base) {
          // Guessing which branch to merge INTO is the one guess with no
          // safe direction — the same refusal the manual route makes.
          failures.push(`cannot work out the default branch in ${repo.root}`);
          continue;
        }
        // Up to three tries with a pause: this landing races the runs
        // that pull the same checkout (index.lock, a briefly stale
        // main), and both 111 and 112 were left stranded by giving up
        // on the first loss. A real conflict fails all three the same
        // way and is reported as before.
        let result = await mergeBranchIntoDefault(gitRun, repo.root, branch, base);
        for (let retry = 0; !result.ok && retry < 2; retry++) {
          await new Promise((r) => setTimeout(r, 700 * (retry + 1)));
          result = await mergeBranchIntoDefault(gitRun, repo.root, branch, base);
        }
        if (result.ok) branchStatus.invalidate(repo.root, branch);
        else failures.push(result.error ?? `cannot merge ${branch} in ${repo.root}`);
      }
      if (failures.length > 0) {
        // The provisional key stays: the job is still the only handle on
        // a branch that has not landed, and renaming it to a folder the
        // page cannot see would hide the work rather than report it.
        queue.update(job.id, { error: failures.join("; ") });
        return;
      }
      // Landed. The branch is on the default branch now, so the job stops
      // advertising one: a compare page for a merged branch shows
      // nothing, and the row would otherwise offer to merge a name it can
      // no longer derive (`specBranch` reads the RENAMED folder).
      queue.update(job.id, {
        specFolder: outcome.specFolder ?? job.specFolder,
        branchUrl: undefined,
        branchUrls: [],
        error: undefined,
      });
      // The page caches its scan for five seconds. Without this the very
      // request that follows a landing would still not show the spec.
      scan = null;
    } catch (err) {
      // Never rethrown: the `landing` flag holds the WHOLE queue, and
      // the runner clears it when this promise settles — which it must
      // do, however this went.
      queue.update(job.id, {
        error: `the spec was created, but landing it failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** Spec 97: what the files say a spec has had, corrected by what git
   *  says about WHEN. A description committed after the last finished
   *  analyze means the plan on disk answers an older question, so the
   *  two phases that produced it stop counting as done and the row
   *  pre-ticks `analyze` again.
   *
   *  Applied here rather than inside `targets()` for two reasons: that
   *  scan is cached for five seconds and must stay a pure function of
   *  what is on disk, and it is handed to the queue as a SYNCHRONOUS
   *  resolver — making it async to ask git would thread `await` through
   *  the enqueue path for a signal enqueueing has no use for.
   *
   *  `implement` is deliberately untouched: it is earned from
   *  4-status.md, and nothing here blocks running a spec whose
   *  description change turns out to be cosmetic. */
  async function withFreshness(list: QueueTarget[]): Promise<QueueTarget[]> {
    return Promise.all(
      list.map(async (t) => {
        if (!t.dir) return t;
        if (!(await freshness.isStale(t.dir, t.specFolder))) return t;
        return {
          ...t,
          analyzeStale: true,
          done: (t.done ?? []).filter((s) => s !== "analyze" && s !== "review-plan"),
        };
      }),
    );
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
  ): Response {
    const ok = steps.every((s) => s.ok);
    for (const s of steps) if (s.error) logRefusal(action, project, s.error);
    if (wantsJson) return json({ ok, project, results: steps }, ok ? 200 : 400);
    const summary = steps.map((s) => s.error).filter(Boolean).join("; ");
    // A refusal goes back to the page the FORM is on — the Add page or
    // the row's own Remove page (2026-08-19) — a success to the list.
    const formPage =
      action === "add-project" ? ADD_PROJECT_ROUTE : `/projects/${encodeURIComponent(project)}/remove`;
    return summary
      ? specsRedirect(sent, { error: summary }, formPage)
      : specsRedirect(sent, undefined, PROJECTS_ROUTE);
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
      const liveTargets = await withFreshness(targets());
      const archivedKeys = scan?.archived ?? [];
      const view = {
        runnerAvailable: opts.runnerAvailable ?? runner !== null,
        targets: liveTargets,
        archived: archivedKeys,
        script: queueClientScript(),
        // Only what the config granted a budget to is offerable: a
        // dropdown naming a model the machine has not agreed to pay for
        // would be a way around the caps.
        modelChoices: Object.entries(queue.defaults.modelChoices ?? {}).map(([name, c]) => ({
          name,
          budgetUsd: c.budgetUsd,
        })),
        defaultModels: queue.defaults.model,
        error: url.searchParams.get("error") ?? undefined,
        // Which row the refusal belongs to. It rides in the query
        // string with the reason itself, so it survives the
        // five-second row swap the same way the filter does.
        errorSpec: url.searchParams.get("errorSpec") ?? undefined,
        // And why, when the reason is one the row offers a way out of.
        // Rides in the query string beside the reason itself, for the
        // same reason: it has to survive the five-second row swap.
        errorReason: url.searchParams.get("errorReason") ?? undefined,
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
        filter: {
          state: url.searchParams.get("state") ?? undefined,
          project: url.searchParams.get("project") ?? undefined,
          sort: url.searchParams.get("sort") ?? undefined,
          dir: url.searchParams.get("dir") ?? undefined,
          open: url.searchParams.get("open") ?? undefined,
        },
      };
      // The rows alone: the page swaps them from script every few
      // seconds, so a half-filled form is never wiped by a refresh.
      // Only the projects the queue may run. A project taken out of the
      // allowlist keeps its jobs in the history (and in /api/queue), but
      // a row for it could only offer a Run that would be refused.
      const listed = queue.list().filter((j) => allowed.has(j.project));
      if (url.searchParams.get("rows")) {
        return new Response(renderQueueRows(await Promise.all(listed.map(jobRow)), view), {
          headers: { "content-type": "text/html; charset=utf-8" },
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
      if (url.searchParams.get("token") && queueToken) {
        headers["set-cookie"] =
          `aide_token=${encodeURIComponent(queueToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
      }
      return new Response(html, { headers });
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
        targets: await withFreshness(targets()),
        script: queueClientScript(),
        // Why the last submission was refused, carried back here by the
        // create route's own redirect.
        error: url.searchParams.get("error") ?? undefined,
      });
      const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
      // The same one-time handover `/` and `/projects` do, for a reader
      // who arrived with the token in the address.
      if (url.searchParams.get("token") && queueToken) {
        headers["set-cookie"] =
          `aide_token=${encodeURIComponent(queueToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
      }
      return new Response(html, { headers });
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
      const html = renderAddProjectPage(nav(), new Date().toISOString(), {
        token: queueToken,
        script: queueClientScript(),
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
      const html = renderProjectsPage(
        buildProjectViews(opts.projectRoot),
        new Date().toISOString(),
        nav(),
        {
          token: queueToken,
          // The RAW allowlist, like the New-spec dropdown: a project
          // with no spec yet is exactly what this page is for.
          createProjects: [...allowed].sort(),
          script: queueClientScript(),
          error: url.searchParams.get("error") ?? undefined,
        },
      );
      const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
      // The same one-time handover `/` does: projects.html passes the
      // address on with its query string, so a bookmarked token arrives
      // here.
      if (url.searchParams.get("token") && queueToken) {
        headers["set-cookie"] =
          `aide_token=${encodeURIComponent(queueToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
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
      const name = typeof asked.name === "string" ? asked.name : "";
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
        name,
        gitUrl: text(asked.gitUrl),
        existingPath: text(asked.existingPath),
        description: text(asked.description),
        specsPath: text(asked.specsPath),
      });
      const steps = [...result.steps];
      if (result.ok) {
        allowed.add(name);
        // The five-second scan is what every other list on this page
        // reads; without this the very request after an Add would still
        // not see the project.
        scan = null;
        steps.push(persistAllowlist("added to the allowlist"));
      }
      return answerProjectChange("add-project", name, steps, raw, wantsJson);
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
          : specsRedirect(raw, { error: result.error, spec });
      }
      await tickRunner();
      return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(raw);
    }

    const action = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/(approve|cancel|merge)$/);
    if (action) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, id, verb] = action;
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
      // Never off the body: the server already knows which spec this
      // job is, and identity is re-derived here for the same reason the
      // repo roots are.
      const spec = `${job.project}/${job.specFolder}`;
      if (verb === "merge") {
        const results = await mergeSpecBranches(job);
        if (results.length === 0) {
          return json({ error: "no branch has been recorded for this spec" }, 400);
        }
        const ok = results.every((r) => r.ok);
        for (const r of results) {
          if (r.error) logRefusal("merge", spec, `${r.root}: ${r.error}`);
          // Both, when both happened: a merge can install nothing AND
          // leave its branch on origin, and the log is the only record
          // of either once the page has moved on.
          for (const note of [r.installError, r.branchDeleteError]) {
            if (note) console.error(`queue: merge of ${spec} in ${r.root} — ${note}`);
          }
        }
        // A merge from the page is the very event a parked job is
        // waiting on (spec 122). The other four actions already
        // re-tick; this one never did, so a job held back on the spec
        // just merged would have sat until the next interval. Above
        // BOTH answers, never beside one of them: an API caller merges
        // for the same reason a reader pressing the button does.
        await tickRunner();
        // `spec` is additive and for the page's own code: it navigates
        // on a refusal and has to say WHICH row the reason belongs to,
        // which only the server can answer.
        if (wantsJson) return json({ ok, results, spec });
        // A person who pressed a button gets the answer on the page they
        // pressed it from, per repo — never a bare "something failed".
        // A merge that went through but did not install says so here
        // too: for a project that installs itself, merged is not
        // deployed, and a silent success reads as though it were. The
        // branch that outlived its own merge belongs in the same
        // sentence, for the same reason.
        const summary = results
          .flatMap((r) => [r.error, r.installError, r.branchDeleteError])
          .filter(Boolean)
          .join("; ");
        // One repo conflicting is enough to offer the way out: the
        // resolve step runs against the spec's branch in every repo it
        // has one in, which is the same set this route just merged.
        const reason = results.some((r) => r.reason === "conflict") ? "conflict" : undefined;
        return summary ? specsRedirect(view, { error: summary, spec, reason }) : specsRedirect(view);
      }
      if (verb === "cancel") {
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
      } else {
        if (job.state !== "awaiting-approval") {
          const why = `cannot approve a ${job.state} job`;
          logRefusal("approve", spec, why);
          // The API contract is untouched: a caller asking for JSON
          // still gets the 409. A person pressing a button on a page
          // used to get that JSON body in the browser instead of the
          // page they pressed it from.
          return wantsJson ? json({ error: why, spec }, 409) : specsRedirect(view, { error: why, spec });
        }
        // Approving a gate releases the job back into the queue.
        queue.update(id, { state: "queued" });
        await tickRunner();
      }
      return wantsJson ? json({ ok: true, job: queue.get(id) }) : specsRedirect(view);
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
      });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("not found", { status: 404 });
  }

  async function jobDetailView(job: Job): Promise<JobDetailView> {
    const target = targets().find((t) => t.project === job.project && t.specFolder === job.specFolder);
    // The step running now, or failing that the last one that ran: a
    // reader opening a finished job still wants to see what it did.
    const streamFile = job.streamFile ?? job.results[job.results.length - 1]?.streamFile;
    // Degrade, never throw: an unreachable claude-usage leaves the rest
    // of the page intact and says the session is unknown.
    const live = job.state === "running" && job.sessionId ? await enricher.lookup(job.sessionId) : null;
    return {
      ...(await jobRow(job)),
      title: target?.title,
      description: target?.description,
      finishedAt: job.finishedAt,
      sessionId: job.sessionId,
      results: job.results.map((r) => ({ ...r, tokens: r.tokens?.total })),
      live,
      activity: streamFile ? summarizeStream(tailFile(streamFile)) : [],
      archiveHeldBack: target?.archiveHeldBack?.reason,
    };
  }

  return {
    port: server.port,
    // `server.stop` resolves once the last connection is closed. Nothing
    // here waits for that — the caller is shutting down — so the promise
    // is dropped on purpose rather than by accident.
    stop: () => {
      if (timer) clearInterval(timer);
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
      const raw = JSON.parse(readFileSync(queueConfigFile, "utf-8")) as Record<string, unknown>;
      opts.queueDefaults = mergeQueueDefaults(QUEUE_DEFAULTS, raw);
      // The notify command is an argv ARRAY: it is run with no shell,
      // so a string would have to be split by someone, and that someone
      // would get quoting wrong.
      if (Array.isArray(raw.notifyCommand) && raw.notifyCommand.every((a) => typeof a === "string")) {
        opts.queueNotifyCommand = raw.notifyCommand as string[];
      }
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
  if (root) {
    const projects: ProjectView[] = discoverProjects(root).map((p) => ({
      name: p.name,
      manifest: parseManifest(readFileSync(p.manifestPath, "utf-8")),
      specs: [],
    }));
    opts.navEntries = navEntries(projects);
  }
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
