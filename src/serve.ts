// The aide-dashboard server (spec 80): serves the generated static
// site, receives aide-run events (POST /api/aide-run), and renders
// /live through the generator's layout, enriched lazily from
// claude-usage's /api/live. Replaces the python3 static server on the
// mac mini — same port, same launchd label.
//
// CLI: serve --site DIR [--port N] [--claude-usage URL] [--mirror FILE]

import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { AideRunStore, parseAideRun } from "./aide-run-store.ts";
import { LiveEnricher } from "./live.ts";
import { discoverProjects } from "./discover.ts";
import { parseManifest } from "./parse-manifest.ts";
import { QueueStore, mergeQueueDefaults, type QueueDefaults, type ProjectResolver } from "./queue.ts";
import { Runner } from "./runner.ts";
import {
  navEntries,
  renderLivePage,
  renderQueuePage,
  type NavEntry,
  type ProjectView,
  type QueueRowView,
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
    for (const numeric of ["budgetUsd", "jobCapUsd", "timeoutSec"]) {
      if (typeof out[numeric] === "string") out[numeric] = Number(out[numeric]);
    }
    return out;
  }
  return JSON.parse(text) as unknown;
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
  let scan: { at: number; targets: { project: string; specFolder: string }[] } | null = null;
  const targets = () => {
    const now = Date.now();
    if (scan && now - scan.at < 5000) return scan.targets;
    const found: { project: string; specFolder: string }[] = [];
    if (opts.projectRoot) {
      for (const p of discoverProjects(opts.projectRoot)) {
        if (!allowed.has(p.name)) continue;
        for (const s of p.specs) if (!s.archived) found.push({ project: p.name, specFolder: s.folder });
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
  const queue = new QueueStore({
    mirrorPath: opts.queueMirrorPath,
    defaults: opts.queueDefaults ?? QUEUE_DEFAULTS,
    resolve: resolveProject,
  });

  // The runner exists only when a binary is configured. Spawned
  // DETACHED, in its own process group: measured on the mini, such a
  // child survives `launchctl bootout`, so a redeploy does not kill a
  // run — and the group is what SIGTERM must reach, since claude spawns
  // children of its own.
  const runner = opts.queueRunnerBin
    ? new Runner({
        store: queue,
        projectDir: (project) => join(opts.queueProjectRoot ?? "", project),
        runnerBin: opts.queueRunnerBin,
        resultDir: opts.queueResultDir ?? join(homedir(), "aide-dashboard", "jobs"),
        now: () => new Date().toISOString(),
        today: () => new Date().toISOString().slice(0, 10),
        spawn: (job, step, resultFile) => {
          mkdirSync(dirname(resultFile), { recursive: true });
          const model = job.model[step];
          const proc = Bun.spawn({
            cmd: [
              opts.queueRunnerBin!,
              "--project-dir", join(opts.queueProjectRoot ?? "", job.project),
              "--command", step,
              "--spec", job.specFolder,
              "--budget-usd", String(job.budgetUsd),
              "--timeout-sec", String(job.timeoutSec),
              "--permission-mode", job.permissionMode[step] ?? "acceptEdits",
              "--result-file", resultFile,
              "--pull",
              ...(model ? ["--model", model] : []),
            ],
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
  const isQueuePath = (path: string) => path === "/queue" || path === "/api/queue" || path.startsWith("/api/queue/");

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
    return {
      id: job.id,
      project: job.project,
      specFolder: job.specFolder,
      steps: job.steps,
      stepIndex: job.stepIndex,
      state: job.state,
      spentUsd: job.spentUsd,
      timeoutSec: job.timeoutSec,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      stopReason: job.stopReason,
      error: job.error,
    };
  }

  async function handleQueue(req: Request, url: URL, path: string): Promise<Response> {
    const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");

    if (path === "/queue") {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      const html = renderQueuePage(queue.list().map(jobRow), new Date().toISOString(), nav(), {
        runnerAvailable: opts.runnerAvailable ?? runner !== null,
        targets: targets(),
      });
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
      if (!result.ok) return json({ error: result.error }, 400);
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

    return new Response("not found", { status: 404 });
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
      opts.queueDefaults = mergeQueueDefaults(
        QUEUE_DEFAULTS,
        JSON.parse(readFileSync(queueConfigFile, "utf-8")) as unknown,
      );
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
