// The aide-dashboard server (spec 80): serves the generated static
// site, receives aide-run events (POST /api/aide-run), and renders
// /live through the generator's layout, enriched lazily from
// claude-usage's /api/live. Replaces the python3 static server on the
// mac mini — same port, same launchd label.
//
// CLI: serve --site DIR [--port N] [--claude-usage URL] [--mirror FILE]

import { createHash, timingSafeEqual } from "node:crypto";
import {
  closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { AideRunStore, parseAideRun } from "./aide-run-store.ts";
import { LiveEnricher } from "./live.ts";
import { discoverProjects } from "./discover.ts";
import { parseManifest } from "./parse-manifest.ts";
import { parseStatus } from "./parse-status.ts";
import { Notifier } from "./notify.ts";
import { QueueStore, mergeQueueDefaults, type Job, type QueueDefaults, type ProjectResolver } from "./queue.ts";
import { Runner } from "./runner.ts";
import { summarizeStream } from "./parse-stream.ts";
import {
  navEntries,
  renderJobDetailPage,
  renderLivePage,
  renderQueuePage,
  renderQueueRows,
  type JobDetailView,
  type NavEntry,
  type ProjectView,
  type QueueRowView,
  type QueueTarget,
} from "./render.ts";

const MAX_BODY = 4096;

// The caps decided in spec 81: deliberately tight. An `analyze` step
// fits; an `implement` on Opus will stop early, on purpose, until the
// per-step value is raised from a measurement.
const QUEUE_DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: 1200,
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
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
  /** The allowlist. Empty or absent means no project may be queued. */
  queueProjects?: string[];
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
  /** argv for the gate notifier — claude-usage's contract, run with no
   *  shell. Absent means no notifications are sent. */
  queueNotifyCommand?: string[];
  runnerAvailable?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Nav for /live when no project set is injected: reconstruct entries
// from the generated site (index + every *.html except live).
function navFromSite(siteDir: string): NavEntry[] {
  const entries: NavEntry[] = [{ label: "Overview", path: "index.html" }];
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    for (const f of readdirSync(siteDir).sort()) {
      if (!f.endsWith(".html") || f === "index.html") continue;
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
//   * analyze — 2-analysis.md is no longer the placeholder
//   * review-plan — 3-solution.md carries a "Plan review" section
//   * implement — the status file reports 100%
// A finished step is MARKED, not forbidden: re-analysing after the code
// has moved on is a legitimate thing to want.
function stepsAlreadyDone(specDir: string, percent: number | undefined): string[] {
  const done: string[] = [];
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
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
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
  // Declared before `targets`, which asks it what has already run.
  let queue: QueueStore;
  let scan: { at: number; targets: QueueTarget[] } | null = null;
  const targets = (): QueueTarget[] => {
    const now = Date.now();
    if (scan && now - scan.at < 5000) return scan.targets;
    const found: QueueTarget[] = [];
    if (opts.projectRoot) {
      for (const p of discoverProjects(opts.projectRoot)) {
        if (!allowed.has(p.name)) continue;
        for (const s of p.specs) {
          if (s.archived) continue;
          // What a reader needs to CHOOSE a spec: what it is called and
          // how far it has got. Both are already on disk.
          let status: ReturnType<typeof parseStatus> | null = null;
          try {
            status = parseStatus(readFileSync(join(s.dir, "4-status.md"), "utf-8"));
          } catch {
            status = null;
          }
          found.push({
            project: p.name,
            specFolder: s.folder,
            title: s.title ?? undefined,
            description: s.description ?? undefined,
            phase: status?.phase ?? undefined,
            percent: status?.progress?.percent,
            // Two sources, union: what the files show, and what the
            // queue actually ran. Neither alone is enough — a spec can
            // be analysed by hand, and a percentage counts the user's
            // own tasks too.
            done: [
              ...new Set([
                ...stepsAlreadyDone(s.dir, status?.progress?.percent),
                ...queue.stepsCompletedFor(p.name, s.folder),
              ]),
            ],
          });
        }
      }
    }
    scan = { at: now, targets: found };
    return found;
  };
  const resolveProject: ProjectResolver = (project) => {
    if (!allowed.has(project)) return null;
    const folders = targets().filter((t) => t.project === project).map((t) => t.specFolder);
    return folders.length > 0 ? { specFolders: folders } : null;
  };
  queue = new QueueStore({
    mirrorPath: opts.queueMirrorPath,
    defaults: opts.queueDefaults ?? QUEUE_DEFAULTS,
    resolve: resolveProject,
  });

  // The runner exists only when a binary is configured. Spawned
  // DETACHED, in its own process group: measured on the mini, such a
  // child survives `launchctl bootout`, so a redeploy does not kill a
  // run — and the group is what SIGTERM must reach, since claude spawns
  // children of its own.
  const notifier = new Notifier({ command: opts.queueNotifyCommand });
  const runner = opts.queueRunnerBin
    ? new Runner({
        store: queue,
        projectDir: (project) => join(opts.queueProjectRoot ?? "", project),
        runnerBin: opts.queueRunnerBin,
        resultDir: opts.queueResultDir ?? join(homedir(), "aide-dashboard", "jobs"),
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
        clearResult: (path) => {
          try {
            rmSync(path, { force: true });
          } catch {
            /* nothing to clear */
          }
        },
      })
    : null;

  // On boot, resolve every job left `running` by the last restart
  // before anything new is started.
  runner?.reconcile();
  const timer = runner
    ? setInterval(() => {
        runner.poll();
        runner.tick();
      }, 2000)
    : null;
  timer?.unref?.();

  const queueToken = opts.queueToken;
  // `/queue/<id>` joins the guarded set HERE, never as a special case
  // further down: a read route outside the guard is exactly the silent
  // bypass this check exists to prevent.
  const isQueuePath = (path: string) =>
    path === "/queue" ||
    path === "/api/queue" ||
    path.startsWith("/api/queue/") ||
    path.startsWith("/queue/");

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
        "The queue needs its token. Open /queue?token=<the token> once and the\n" +
        "browser keeps it in a cookie; API callers send it as X-Aide-Token.\n" +
        "The token lives in the file this server was started with.\n",
      { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.bindHost ?? "0.0.0.0",
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
        const len = Number(req.headers.get("content-length") ?? "0");
        if (len > MAX_BODY) return json({ error: "payload too large" }, 413);
        const text = await req.text();
        if (text.length > MAX_BODY) return json({ error: "payload too large" }, 413);
        let raw: unknown;
        try {
          raw = JSON.parse(text);
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

      if (path === "/live") {
        if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
        const { rows, enriched } = await enricher.rows(store);
        const notice = enriched ? null : "claude-usage is unreachable — liveness, subagents and cost are unknown right now.";
        const html = renderLivePage(rows, notice, new Date().toISOString(), nav());
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 });
      }
      return serveStatic(opts.siteDir, path);
    },
  });

  function jobRow(job: ReturnType<QueueStore["list"]>[number]): QueueRowView {
    // The step whose model the row is about: the one running, or the
    // last one for a job that has finished.
    const step = job.steps[job.stepIndex] ?? job.steps[job.steps.length - 1];
    return {
      id: job.id,
      project: job.project,
      specFolder: job.specFolder,
      steps: job.steps,
      stepIndex: job.stepIndex,
      state: job.state,
      model: job.modelChoice ?? (step ? job.model[step] : undefined),
      spentUsd: job.spentUsd,
      timeoutSec: job.timeoutSec,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      branchUrl: job.branchUrl,
      stopReason: job.stopReason,
      error: job.error,
    };
  }

  async function handleQueue(req: Request, url: URL, path: string): Promise<Response> {
    const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");

    if (path === "/queue") {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const view = {
        runnerAvailable: opts.runnerAvailable ?? runner !== null,
        targets: targets(),
        script: queueClientScript(),
        // Only what the config granted a budget to is offerable: a
        // dropdown naming a model the machine has not agreed to pay for
        // would be a way around the caps.
        modelChoices: Object.entries(queue.defaults.modelChoices ?? {}).map(([name, c]) => ({
          name,
          budgetUsd: c.budgetUsd,
        })),
        error: url.searchParams.get("error") ?? undefined,
        projects: [...new Set(targets().map((t) => t.project))].sort(),
      };
      // The rows alone: the page swaps them from script every few
      // seconds, so a half-filled form is never wiped by a refresh.
      if (url.searchParams.get("rows")) {
        return new Response(renderQueueRows(queue.list().map(jobRow), view), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const html = renderQueuePage(queue.list().map(jobRow), new Date().toISOString(), nav(), view);
      const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
      // Hand the token over ONCE, as an HttpOnly cookie, so the forms
      // never have to carry it in their markup.
      if (url.searchParams.get("token") && queueToken) {
        headers["set-cookie"] =
          `aide_token=${encodeURIComponent(queueToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
      }
      return new Response(html, { headers });
    }

    if (path === "/api/queue") {
      if (req.method === "GET") {
        return json({ generatedAt: new Date().toISOString(), jobs: queue.list() });
      }
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const len = Number(req.headers.get("content-length") ?? "0");
      if (len > MAX_BODY) return json({ error: "payload too large" }, 413);
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: "payload too large" }, 413);
      let raw: unknown;
      try {
        raw = bodyToObject(text, req.headers.get("content-type"));
      } catch {
        return json({ error: "malformed body" }, 400);
      }
      const result = queue.enqueue(raw);
      if (!result.ok) {
        // A person who pressed a button gets the reason on the page
        // they pressed it from; an API caller gets a status code.
        return wantsJson
          ? json({ error: result.error }, 400)
          : new Response(null, {
              status: 303,
              headers: { location: `/queue?error=${encodeURIComponent(result.error)}` },
            });
      }
      runner?.tick();
      return wantsJson
        ? json({ ok: true, job: result.job })
        : new Response(null, { status: 303, headers: { location: "/queue" } });
    }

    const action = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/(approve|cancel)$/);
    if (action) {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const [, id, verb] = action;
      const job = queue.get(id);
      if (!job) return json({ error: "no such job" }, 404);
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
        if (job.state !== "awaiting-approval") return json({ error: `cannot approve a ${job.state} job` }, 409);
        // Approving a gate releases the job back into the queue.
        queue.update(id, { state: "queued" });
        runner?.tick();
      }
      return wantsJson
        ? json({ ok: true, job: queue.get(id) })
        : new Response(null, { status: 303, headers: { location: "/queue" } });
    }

    // One job, in full: what it IS (the spec's title and description),
    // every step it has already run, and — while a step is running —
    // what that session is doing. Deliberately AFTER the approve/cancel
    // match above, so the new route cannot swallow those.
    const detail = path.match(/^\/(api\/)?queue\/([A-Za-z0-9-]+)$/);
    if (detail) {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const [, api, id] = detail;
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
      ...jobRow(job),
      title: target?.title,
      description: target?.description,
      finishedAt: job.finishedAt,
      sessionId: job.sessionId,
      results: job.results,
      live,
      activity: streamFile ? summarizeStream(tailFile(streamFile)) : [],
    };
  }

  return {
    port: server.port,
    stop: () => {
      if (timer) clearInterval(timer);
      server.stop(true);
    },
  };
}

function parseArgs(argv: string[]): ServerOptions {
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
