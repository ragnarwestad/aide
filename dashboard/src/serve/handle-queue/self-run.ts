// The test board's own Run control: put the round's fixture specs
// through again, on this same board, without starting a new server.
//
// What `test/round/run` used to do in its own loop — send every fixture
// spec through `/api/queue/create`, wait for the folder it becomes,
// queue that spec's own steps — lives here now, so the board owns the
// round and the script is a thin shell around it (2026-09-11). Before
// the fixtures go in again the board is put back where the round left
// it at the start: every live job is cancelled and the project's jobs
// dropped, and the two throwaway repositories (the fixture project and
// its specs) are brought back to their first commit — history and all,
// with a force-push, and the dashboard's own clones of them set to the
// same point. Not a new commit on top: a spec's phases are read from
// the runner's own commits in the specs repository's history, so a
// history that still held "Run /aide-implement for 01" would have the
// board refuse to analyze the 01 the next round creates.
//
// Not scoped to a project/specFolder, like `self-stop.ts`: a test board
// serves exactly one project, the round's own.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getBoardInfo, isRoundBoard } from "../../render/ui/board-info.ts";
import { configSpecsPath } from "../../project/discover/config.ts";
import type { HandleQueueContext } from "../handle-queue.ts";
import { json } from "../serve-helpers/http.ts";

/** What the spec's row is expected to show once the round is over
 *  (`dashboard/test/round/run` reads it back and compares): the job's
 *  state, its stop reason when stopped, and the message — a message
 *  KEY when the board wrote one (`runner.jobCapExceeded`), or a piece
 *  of the sentence when the runner script's own English is the text. */
export interface RoundExpect {
  state?: string;
  stopReason?: string;
  message?: string;
}

export interface RoundSpec {
  slug: string;
  title: string;
  steps: string[];
  expected: string;
  dependsOn: string[];
  /** A tighter time limit for every step of this spec, in seconds —
   *  the one way a fixture can make the runner's clock the outcome. */
  timeoutSec?: number;
  expect?: RoundExpect;
  /** The `NN-slug` folder the create step made — absent until it has. */
  folder?: string;
}

export interface RoundState {
  /** `idle` until the first press; `resetting` while the board is being
   *  put back; `queueing` while the fixtures go in one by one; `running`
   *  once every spec's own steps are in the queue and until the queue
   *  has drained — the round's checkouts follow origin meanwhile, the
   *  way the specs cron does on the serving host; `done` after that;
   *  `failed` with `error` when a step of this route's own could not be
   *  done. */
  stage: "idle" | "resetting" | "queueing" | "running" | "done" | "failed";
  startedAt?: string;
  error?: string;
  specs: RoundSpec[];
}

// `stage`, not `state`: a job's `state` is written by the store alone
// (transitions.test.ts guards the literal), and this is the round's own
// progress, not a job's.
let current: RoundState = { stage: "idle", specs: [] };

/** For tests: back to the boot-time state between cases. */
export function resetRoundState(): void {
  current = { stage: "idle", specs: [] };
}

/** Where the fixtures live: beside the code that is being served, so a
 *  branch under test carries its own — the same `dashboard/test/round/
 *  specs` the script reads. `roundFixturesDir` overrides it (a test
 *  seam). */
function fixturesDir(ctx: HandleQueueContext): string {
  return ctx.opts.roundFixturesDir ?? join(import.meta.dir, "..", "..", "..", "test", "round", "specs");
}

/** `undefined` for a path that is not this route's own, so it joins the
 *  same `??`-chain `handleQueue()`'s dispatcher already is. */
export function selfRunRoute(ctx: HandleQueueContext, req: Request, path: string): Response | null {
  if (path !== "/api/self-run") return null;
  // An ordinary (prod) server never draws the Run button, but a request
  // can be sent by hand regardless of what the page draws.
  if (!getBoardInfo()) return new Response("not a test board", { status: 404 });
  // A board started from a spec's branch previews that spec; its round
  // is never run again from here.
  if (!isRoundBoard()) return new Response("not a round board", { status: 404 });
  if (req.method === "GET") return json(current);
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  // A running round can be pressed over — that is what cancels it and
  // starts again; one still being put back or queued cannot.
  if (current.stage === "resetting" || current.stage === "queueing") {
    return json({ error: "a round is already being queued", stage: current.stage }, 409);
  }
  // The round takes minutes to queue (each create has to land before
  // the next fixture can name it as a dependency), so the answer is
  // "started", at once; `GET /api/self-run` says how far it has come.
  void runRound(ctx);
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  return wantsJson ? json({ ok: true, stage: "resetting" }) : new Response(null, { status: 303, headers: { location: "/" } });
}

async function runRound(ctx: HandleQueueContext): Promise<void> {
  current = { stage: "resetting", startedAt: new Date().toISOString(), specs: [] };
  try {
    const project = [...ctx.allowed][0];
    if (!project) throw new Error("this board serves no project");
    // The checkout the round made and the runs branch from — not the
    // dashboard's own landing clone, which follows origin by itself
    // the next time a landing fetches it.
    const code = ctx.displayProjectDir(project);
    // Its specs the way a run finds them: `.aide/config`'s
    // AIDE_SPECS_PATH, else the project's own specs/ — a repository of
    // its own on a round, and reset on its own; inside the code
    // repository (no round does this) the code reset already covers it.
    const specs = configSpecsPath(code) ?? join(code, "specs");
    const ownRepo = (await ctx.specsRoot(specs)) !== (await ctx.specsRoot(code));
    await cancelLiveJobs(ctx, project);
    ctx.queue.dropProject(project);
    await resetRepo(ctx, code, "baseline");
    if (ownRepo) await resetRepo(ctx, specs, null);
    // The dashboard's own clones AFTER both origins are back at their
    // start: a clone can appear at any moment (`ensureCheckout` runs on
    // its own clock) and one made a moment before a branch was deleted
    // on origin still carries it as `origin/aide/*`.
    const ownedCode = ctx.machineryProjectDir(project);
    for (const owned of [ownedCode === code ? undefined : ownedCode, ctx.ownedSpecsRoot(project)]) {
      if (owned) await resetOwned(ctx, owned);
    }
    ctx.invalidateScan();
    current = { ...current, stage: "queueing", specs: readFixtures(fixturesDir(ctx)) };
    await queueFixtures(ctx, project, current.specs, specs);
    current = { ...current, stage: "running" };
    await followUntilDrained(ctx, project, [specs, code]);
    current = { ...current, stage: "done" };
  } catch (e) {
    current = { ...current, stage: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Every job the project still holds is ended the way the Cancel button
 *  ends one — the transition, then SIGTERM to the process group — and
 *  the round waits for the runner to let go of them before the repos
 *  are touched under a run's feet. */
async function cancelLiveJobs(ctx: HandleQueueContext, project: string): Promise<void> {
  for (const job of ctx.queue.list()) {
    if (job.project !== project) continue;
    if (job.state !== "queued" && job.state !== "running") continue;
    const result = ctx.queue.transition(job.id, "cancel", {
      finishedAt: new Date().toISOString(),
      error: undefined,
      errorReason: undefined,
    });
    if (result.ok && job.pgid !== undefined) {
      try {
        process.kill(-job.pgid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const busy = ctx.queue.list().some((j) => j.project === project && (j.state === "running" || j.landing));
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** One git command, with a few retries on a lock clash: the dashboard's
 *  own checkout sync fetches the owned clone on its own clock
 *  (`ensureCheckout`), and two fetches at once end with "cannot lock
 *  ref" for one of them — a moment later it goes through. */
async function gitOrThrow(ctx: HandleQueueContext, at: string, args: string[], timeoutMs = 20_000): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const r = await ctx.gitRun(at, args, timeoutMs);
    if (r.code === 0) return r.stdout;
    const why = (r.stderr ?? r.stdout).trim();
    if (attempt < 5 && /cannot lock ref|index\.lock|\.lock': File exists/.test(why)) {
      await new Promise((res) => setTimeout(res, 300 * attempt));
      continue;
    }
    throw new Error(`git ${args.join(" ")} in ${at}: ${why}`);
  }
}

/** Every ref that can still reach the old history has to go, not the
 *  branches alone: the runner reads a spec's completed steps with
 *  `git log --all`, and a remote-tracking `origin/aide/*` left behind
 *  by a branch deleted on origin still reaches every commit the last
 *  round made — which is how a fresh 01 read as already implemented. */
async function dropRunBranches(ctx: HandleQueueContext, at: string): Promise<void> {
  const run = (args: string[], timeoutMs?: number) => gitOrThrow(ctx, at, args, timeoutMs);
  const local = (await run(["branch", "--list", "--format=%(refname:short)", "aide/*"]))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  await run(["worktree", "prune"]);
  if (local.length) await run(["branch", "-D", "-q", ...local]);
  await run(["fetch", "-q", "--prune", "origin"], 30_000);
  const tracking = (await run(["for-each-ref", "--format=%(refname)", "refs/remotes/origin/aide/"]))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const ref of tracking) await run(["update-ref", "-d", ref]);
}

/** The dashboard's own clone (where the landings merge) set hard to
 *  origin's main, under the same per-root lock the landings take, so no
 *  landing merges into it while it is being put back. */
async function resetOwned(ctx: HandleQueueContext, owned: string): Promise<void> {
  if (!existsSync(join(owned, ".git"))) return;
  await ctx.mergeLock.run(owned, async () => {
    await gitOrThrow(ctx, owned, ["fetch", "-q", "--prune", "origin"], 30_000);
    await gitOrThrow(ctx, owned, ["checkout", "-q", "main"]);
    await gitOrThrow(ctx, owned, ["reset", "-q", "--hard", "origin/main"]);
    await dropRunBranches(ctx, owned);
  });
}

/** The repository back to `base` — the `baseline` tag the round stamps
 *  on the fixture project, or the specs repo's own first commit — on
 *  `main`, force-pushed, with every `aide/*` branch the runs left
 *  deleted on origin and here. `reset --hard` leaves ignored files
 *  alone, so the project's `.aide/config` stays. */
async function resetRepo(ctx: HandleQueueContext, dir: string, base: string | null): Promise<void> {
  const run = (args: string[], timeoutMs?: number) => gitOrThrow(ctx, dir, args, timeoutMs);
  await run(["checkout", "-q", "main"]);
  const target = base ?? (await run(["rev-list", "--max-parents=0", "main"])).trim().split("\n").pop()!;
  await run(["reset", "-q", "--hard", target]);
  await run(["push", "-q", "--force", "origin", "main"], 30_000);
  const remote = (await run(["ls-remote", "--heads", "origin", "refs/heads/aide/*"], 20_000))
    .split("\n")
    .map((l) => l.split("\t")[1] ?? "")
    .filter((r) => r.startsWith("refs/heads/aide/"))
    .map((r) => r.slice("refs/heads/".length));
  if (remote.length) await run(["push", "-q", "origin", "--delete", ...remote], 30_000);
  await dropRunBranches(ctx, dir);
}

/** What the specs cron does on the serving host every two minutes, and
 *  what the script's own drain loop did: the round's checkouts follow
 *  origin while the queue works, so a spec's state (read from the
 *  checkout a person looks at) catches up with what a landing pushed —
 *  a dependency on an archived spec is answered from there. Until no
 *  job of the project is live; a queued archive held for its own
 *  acceptance-criteria gate never leaves `queued` on its own and is not
 *  live. */
async function followUntilDrained(ctx: HandleQueueContext, project: string, dirs: string[]): Promise<void> {
  const live = (): boolean =>
    ctx.queue.list().some(
      (j) =>
        j.project === project &&
        (j.state === "running" ||
          j.landing === true ||
          (j.state === "queued" && (j.error as { key?: string } | undefined)?.key !== "runner.acceptanceCriteriaUnticked")),
    );
  const deadline = Date.now() + 30 * 60_000;
  while (live() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    await pullDisplay(ctx, dirs);
  }
  await pullDisplay(ctx, dirs);
  ctx.invalidateScan();
}

/** A fast-forward of the checkouts a person looks at; a checkout that
 *  cannot fast-forward is left as it is — the next pull may. */
async function pullDisplay(ctx: HandleQueueContext, dirs: string[]): Promise<void> {
  for (const dir of dirs) await ctx.gitRun(dir, ["pull", "-q", "--ff-only"], 30_000);
}

/** The fixtures in file-name order: `<slug>.json` beside `<slug>.md`. A
 *  fixture names a dependency by the NUMBER in its file name ("01"),
 *  since the folder that number becomes is only decided when the spec
 *  is created. */
export function readFixtures(dir: string): RoundSpec[] {
  if (!existsSync(dir)) throw new Error(`no fixtures at ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const slug = basename(f, ".json");
      const meta = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        title: string;
        steps: string[];
        expected: string;
        dependsOn?: string[];
        timeoutSec?: number;
        expect?: RoundExpect;
      };
      return {
        slug,
        title: meta.title,
        steps: meta.steps,
        expected: meta.expected,
        dependsOn: meta.dependsOn ?? [],
        ...(typeof meta.timeoutSec === "number" ? { timeoutSec: meta.timeoutSec } : {}),
        ...(meta.expect ? { expect: meta.expect } : {}),
      };
    });
}

/** Through the board's own HTTP API, the same two calls the script made
 *  — so a fixture reaches the queue exactly as a spec made on the New
 *  spec page does, refusals included. */
async function queueFixtures(ctx: HandleQueueContext, project: string, specs: RoundSpec[], specsDir: string): Promise<void> {
  const base = `http://127.0.0.1:${ctx.serverPort()}`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (ctx.queueToken) headers["x-aide-token"] = ctx.queueToken;
  const api = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const answer = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`${path} refused: ${String(answer.error ?? res.status)}`);
    return answer;
  };
  const dir = fixturesDir(ctx);
  for (const spec of specs) {
    const dependsOn = spec.dependsOn.map((dep) => {
      const made = specs.find((s) => s.slug.startsWith(`${dep}-`))?.folder;
      if (!made) throw new Error(`no folder yet for dependency ${dep} of ${spec.slug}`);
      return made;
    });
    const description = readFileSync(join(dir, `${spec.slug}.md`), "utf8");
    const created = await api("/api/queue/create", {
      project,
      title: spec.title,
      description,
      ...(dependsOn.length ? { dependsOn } : {}),
    });
    const jobId = (created.job as { id?: string } | undefined)?.id;
    if (!jobId) throw new Error(`create gave no job for ${spec.slug}`);
    // A create job's OWN specFolder starts as a provisional "new-<8 hex>"
    // placeholder and only becomes the real "NN-slug" once the step has
    // run and landed.
    const until = Date.now() + 180_000;
    while (!spec.folder) {
      const job = ctx.queue.get(jobId);
      if (job && !/^new-[0-9a-f]{8}$/.test(job.specFolder)) spec.folder = job.specFolder;
      else if (job && (job.state === "failed" || job.state === "cancelled" || job.state === "stopped")) {
        throw new Error(`create ${job.state} for ${spec.slug}`);
      } else if (Date.now() > until) throw new Error(`create never landed for ${spec.slug}`);
      else await new Promise((r) => setTimeout(r, 1000));
    }
    // The folder the landing pushed, into the checkout the board reads
    // the spec's state from, before its steps are asked for.
    await pullDisplay(ctx, [specsDir]);
    ctx.invalidateScan();
    await api("/api/queue", {
      project,
      specFolder: spec.folder,
      steps: spec.steps,
      ...(spec.timeoutSec !== undefined ? { timeoutSec: spec.timeoutSec } : {}),
    });
  }
}
