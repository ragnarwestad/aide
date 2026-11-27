// The test board's own Run control (2026-09-11): `POST /api/self-run`
// puts the board back to its start — live jobs cancelled, the project's
// jobs dropped, the two throwaway repositories back to their first
// commit as a new commit on main — and sends the round's fixtures
// through create again.
//
// The fixture set here is EMPTY on purpose: a create job only lands
// through a real runner, which no unit test should start. What is
// proven is everything before the fixtures go in — the reset — and
// that the route then reports the round as queued.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../../helpers/queue-server.ts";
import {
  cancelLiveJobs,
  followUntilDrained,
  resetRepo,
  resetRoundState,
  settledCreateFolder,
} from "../../../src/serve/routes/self-run.ts";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";
import { groupAlive, signalGroup } from "../../../src/serve/serve-helpers/signal-group.ts";
import { clearStartedGroups, noteStartedGroup } from "../../../src/queue/job-rules/started-groups.ts";
import { heldLock, watchLock } from "../../helpers/held-lock.ts";

const auth = { headers: { accept: "application/json" } };
const TEST_BOARD = "aide-wt-run";

const harness = queueHarness("aide-self-run-");

/** An empty fixture set of its own: the harness's directory is only
 *  known once the server is up, and the option has to be given first. */
let fixtures: string;
beforeEach(() => {
  fixtures = mkdtempSync(join(tmpdir(), "aide-self-run-fixtures-"));
});
afterEach(() => {
  harness.cleanup();
  rmSync(fixtures, { recursive: true, force: true });
  resetRoundState();
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@localhost", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A repository with a bare origin, its first commit on `main` (tagged
 *  `baseline` when asked), and one more commit after it — the state a
 *  round's fixture project is in once a run has landed something. */
function repoWithHistory(dir: string, origin: string, tag: boolean): void {
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", origin);
  writeFileSync(join(dir, "fact.txt"), "first\n");
  // The round's own fixture project ignores `.aide/config` (its
  // `.gitignore`), which is what lets the config outlive a reset to the
  // first commit. Without this line the file is only kept out of the
  // commits below by a GLOBAL git ignore — which this machine has and a
  // clean one (CI) does not, where `add -A` then committed it and the
  // reset removed it as a tracked file (2026-09-13).
  writeFileSync(join(dir, ".gitignore"), ".aide/config\n");
  git(dir, "add", "fact.txt", ".gitignore");
  git(dir, "commit", "-q", "-m", "start");
  if (tag) git(dir, "tag", "baseline");
  writeFileSync(join(dir, "fact.txt"), "first\nsecond\n");
  writeFileSync(join(dir, "extra.txt"), "left by a run\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "a run landed this");
  git(dir, "push", "-q", "origin", "main");
  // A branch a run left behind, on origin and here.
  git(dir, "branch", "aide/01-something");
  git(dir, "push", "-q", "origin", "aide/01-something");
}

describe("POST /api/self-run", () => {

  test("with no board info, answers 404 to both the press and the status", async () => {
    const { base } = harness.start({ extra: {} });
    expect((await fetch(`${base}/api/self-run`, { method: "POST", ...auth })).status).toBe(404);
    expect((await fetch(`${base}/api/self-run`, auth)).status).toBe(404);
  });

  // A board started from a spec's branch (a numbered folder) previews
  // that spec and is never re-run: no Run there, whatever is sent.
  // The round script seeds a branch board's fixtures through this route
  // when the board comes up; without that first press the board shows
  // no specs at all (2026-09-12). What a branch board never gets is a
  // SECOND round: no Run button is drawn, and a press by hand is refused.
  test("on a board started from a spec's branch, the first press seeds the round and a second is refused", async () => {
    const { base, dir } = harness.start({
      extra: { testBoardSpec: "424-headeren-sier-hvilket-board", roundFixturesDir: fixtures },
    });
    const code = join(dir, "root", "aide");
    const specs = join(dir, "specs-repo");
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(code, ".aide", "config"), `AIDE_SPECS_PATH=${specs}\n`);
    repoWithHistory(code, join(dir, "code-origin.git"), true);
    repoWithHistory(specs, join(dir, "specs-origin.git"), false);

    const first = await fetch(`${base}/api/self-run`, { method: "POST", ...auth });
    expect(first.status).toBe(200);
    let state: { stage: string } = { stage: "resetting" };
    for (let i = 0; i < 100 && state.stage !== "done" && state.stage !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const res = await fetch(`${base}/api/self-run`, auth);
      expect(res.status).toBe(200);
      state = (await res.json()) as typeof state;
    }
    expect(state.stage).toBe("done");

    expect((await fetch(`${base}/api/self-run`, { method: "POST", ...auth })).status).toBe(404);
    // The status stays readable: the page's own header reads it.
    expect((await fetch(`${base}/api/self-run`, auth)).status).toBe(200);
  });

  test("a board that serves no project ends the round as failed, saying so", async () => {
    const { base } = harness.start({
      extra: { testBoardSpec: TEST_BOARD, roundFixturesDir: fixtures, queueProjects: [] },
    });
    const pressed = await fetch(`${base}/api/self-run`, { method: "POST", ...auth });
    expect(pressed.status).toBe(200);
    let state: { stage: string; error?: string } = { stage: "resetting" };
    for (let i = 0; i < 50 && state.stage !== "done" && state.stage !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      state = (await (await fetch(`${base}/api/self-run`, auth)).json()) as typeof state;
    }
    expect(state).toMatchObject({ stage: "failed", error: "this board serves no project" });
  });

  test("before any press the status is idle", async () => {
    const { base } = harness.start({ extra: { testBoardSpec: TEST_BOARD } });
    const res = await fetch(`${base}/api/self-run`, auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stage: "idle", specs: [] });
  });

  test("a press resets both repositories to their start, drops the project's jobs, and queues the round", async () => {
    const { base, dir } = harness.start({
      extra: { testBoardSpec: TEST_BOARD, roundFixturesDir: fixtures },
    });
    // The harness's project is `aide` at root/aide; its specs go to a
    // repository of their own, the way a round's `.aide/config` says.
    const code = join(dir, "root", "aide");
    const specs = join(dir, "specs-repo");
    // The queue holds a row from the last round, while the harness's original
    // specs path still names the row.
    expect((await queueAnalyze(base)).status).toBe(200);

    mkdirSync(specs, { recursive: true });
    writeFileSync(join(code, ".aide", "config"), `AIDE_SPECS_PATH=${specs}\n`);
    repoWithHistory(code, join(dir, "code-origin.git"), true);
    repoWithHistory(specs, join(dir, "specs-origin.git"), false);

    const pressed = await fetch(`${base}/api/self-run`, { method: "POST", ...auth });
    expect(pressed.status).toBe(200);
    expect(await pressed.json()).toEqual({ ok: true, stage: "resetting" });

    const state = await roundSettled(base);
    expect(state).toEqual({ stage: "done", startedAt: expect.any(String), specs: [] });

    // Both working trees are what the first commit held, and main IS
    // that commit again — history and all, on origin too, since the
    // spec's phases are read from the runner's commits in it; the run's
    // branch is gone.
    for (const [repo, origin] of [
      [code, join(dir, "code-origin.git")],
      [specs, join(dir, "specs-origin.git")],
    ]) {
      expect(readFileSync(join(repo, "fact.txt"), "utf8")).toBe("first\n");
      expect(git(repo, "ls-files")).toBe(".gitignore\nfact.txt");
      expect(git(repo, "log", "--format=%s")).toBe("start");
      expect(git(repo, "rev-parse", "main")).toBe(git(origin, "rev-parse", "main"));
      expect(git(origin, "branch", "--list", "aide/*")).toBe("");
      expect(git(repo, "branch", "--list", "aide/*")).toBe("");
      // And no ref of any kind reaches the old history any more — the
      // runner reads completed steps with `git log --all`, so a stale
      // remote-tracking `origin/aide/*` would hand the next round the
      // last one's steps.
      expect(git(repo, "for-each-ref", "refs/remotes/origin/aide/")).toBe("");
      expect(git(repo, "log", "--all", "--format=%s")).toBe("start");
    }
    // The dashboard's own clones, where the landings merge, sit at the
    // same start with the same clean set of refs.
    for (const owned of [join(dir, "owned", "aide", "code"), join(dir, "owned", "aide", "specs")]) {
      if (!existsSync(join(owned, ".git"))) continue;
      expect(git(owned, "log", "--all", "--format=%s")).toBe("start");
      expect(git(owned, "for-each-ref", "refs/remotes/origin/aide/")).toBe("");
    }
    // The gitignored config a round writes stays where it was.
    expect(readFileSync(join(code, ".aide", "config"), "utf8")).toContain("AIDE_SPECS_PATH=");
    const jobs = (await (await fetch(`${base}/api/queue`, auth)).json()) as { jobs: unknown[] };
    expect(jobs.jobs).toEqual([]);
  });

  test("a press dismisses the failed-create messages the project's last round left, and no other project's", async () => {
    const failedCreatesPath = join(fixtures, "..", `failed-creates-${Date.now()}.json`);
    const record = (id: string, project: string) => ({
      id, project, title: `Title of ${id}`, description: "",
      reason: { key: "runner.serverRestarted", values: { button: "Create" } }, failedAt: "2026-10-30T07:00:00.000Z",
    });
    writeFileSync(failedCreatesPath, JSON.stringify([record("last-round", "aide"), record("elsewhere", "other")]));
    try {
      const { base, dir } = harness.start({
        extra: { testBoardSpec: TEST_BOARD, roundFixturesDir: fixtures, failedCreatesPath },
      });
      const code = join(dir, "root", "aide");
      repoWithHistory(code, join(dir, "code-origin.git"), true);

      await fetch(`${base}/api/self-run`, { method: "POST", ...auth });
      let state: { stage: string } = { stage: "resetting" };
      for (let i = 0; i < 100 && state.stage !== "done" && state.stage !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        state = (await (await fetch(`${base}/api/self-run`, auth)).json()) as typeof state;
      }
      expect(state.stage).toBe("done");
      const kept = JSON.parse(readFileSync(failedCreatesPath, "utf8")) as { id: string; dismissedAt?: string }[];
      expect(kept.find((r) => r.id === "last-round")?.dismissedAt).toEqual(expect.any(String));
      expect(kept.find((r) => r.id === "elsewhere")?.dismissedAt).toBeUndefined();
    } finally {
      rmSync(failedCreatesPath, { force: true });
    }
  });

  test("a second press while the first is still queueing is refused", async () => {
    const { base, dir } = harness.start({
      extra: { testBoardSpec: TEST_BOARD, roundFixturesDir: fixtures },
    });
    const code = join(dir, "root", "aide");
    const specs = join(dir, "specs-repo");
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(code, ".aide", "config"), `AIDE_SPECS_PATH=${specs}\n`);
    repoWithHistory(code, join(dir, "code-origin.git"), true);
    repoWithHistory(specs, join(dir, "specs-origin.git"), false);
    expect((await fetch(`${base}/api/self-run`, { method: "POST", ...auth })).status).toBe(200);
    expect((await fetch(`${base}/api/self-run`, { method: "POST", ...auth })).status).toBe(409);
  });
});

// The round queues a spec's steps only once its create has LANDED —
// the job carries its real folder before that, and the queue refuses a
// step for a spec whose create is still landing.
describe("a create's folder counts once its landing is over", () => {
  test("a provisional key is not a folder", () => {
    expect(settledCreateFolder({ specFolder: "new-0a1b2c3d", landing: true })).toBeUndefined();
    expect(settledCreateFolder({ specFolder: "new-0a1b2c3d" })).toBeUndefined();
  });
  test("the real folder, while the create still lands, is not one either", () => {
    expect(settledCreateFolder({ specFolder: "07-a-fact", landing: true })).toBeUndefined();
  });
  test("the real folder with the landing over is", () => {
    expect(settledCreateFolder({ specFolder: "07-a-fact" })).toBe("07-a-fact");
  });
});

// The round's reset moves the checkouts the runs branch from, so it
// takes the runner's lock for them like every other move.
describe("the round's reset and the checkout's lock", () => {
  const answering = (fail?: { prefix: string; stderr: string }) => {
    const calls: string[] = [];
    const gitRun = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      calls.push(a);
      if (fail && a.startsWith(fail.prefix)) return { code: 1, stdout: "", stderr: fail.stderr };
      return { code: 0, stdout: "", stderr: "" };
    };
    return { gitRun, calls };
  };

  test("reset removes fixture worktrees before deleting their branches", async () => {
    const root = join(fixtures, "code");
    mkdirSync(root);
    repoWithHistory(root, join(fixtures, "origin.git"), true);
    const worktree = join(fixtures, "worker");
    git(root, "worktree", "add", worktree, "aide/01-something");
    await resetRepo({ gitRun: async (dir, args) => {
      try { return { code: 0, stdout: git(dir, ...args) }; }
      catch (e) { return { code: 1, stdout: "", stderr: String(e) }; }
    } }, root, "baseline");
    expect(existsSync(worktree)).toBe(false);
    expect(git(root, "branch", "--list", "aide/*")).toBe("");
    expect(git(root, "worktree", "list", "--porcelain")).not.toContain("refs/heads/aide/");
  });

  test("waits for a lock another process holds, and resets only while holding it (AC-1)", async () => {
    const held = heldLock();
    try {
      held.releaseAfter(100);
      const watched = watchLock(held, answering().gitRun);
      await resetRepo({ gitRun: watched.run }, held.root, "baseline");
      const moves = watched.moves("checkout", "reset", "push", "fetch", "branch", "update-ref");
      expect(moves.map((m) => m.args.split(" ")[0])).toEqual(expect.arrayContaining(["checkout", "reset", "push", "fetch"]));
      expect(watched.seen.every((c) => c.ours)).toBe(true);
      expect(held.held()).toBe(false);
    } finally {
      held.cleanup();
    }
  });

  test("a lock that never frees resets nothing, and the error names the lock (AC-1)", async () => {
    const held = heldLock();
    try {
      const git = answering();
      await expect(resetRepo({ gitRun: git.gitRun }, held.root, "baseline", async () => {})).rejects.toThrow(held.lock);
      expect(git.calls).toEqual([]);
    } finally {
      held.cleanup();
    }
  });

  test("a round command that fails on cannot lock ref is run once (AC-3)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-self-run-once-"));
    try {
      const git = answering({ prefix: "checkout", stderr: "error: cannot lock ref 'refs/heads/main': File exists" });
      await expect(resetRepo({ gitRun: git.gitRun }, dir, "baseline")).rejects.toThrow("cannot lock ref");
      expect(git.calls.filter((c) => c.startsWith("checkout"))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The round's two waits: before the reset, for the work it cancelled to
// end; before `done`, for the round's own work to end. Each throws when
// its time runs out, and `runRound` turns the throw into `failed`.
const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};
const PROJECT = "aide-test";
afterEach(clearStartedGroups);

/** A store holding one job of the round's project, started with `patch`. */
function storeWithRunningJob(patch: { pgid?: number; landing?: boolean } = {}): { store: QueueStore; id: string } {
  const store = new QueueStore({
    defaults: DEFAULTS,
    resolve: (project) => (project === PROJECT ? { specFolders: ["01-add-the-first-fact"] } : null),
  });
  const made = store.enqueue({ project: PROJECT, specFolder: "01-add-the-first-fact", steps: ["implement"] });
  if (!made.ok) throw new Error(made.error);
  const id = made.job.id;
  store.transition(id, "start", { startedAt: new Date().toISOString(), pgid: patch.pgid, pid: patch.pgid });
  if (patch.landing) store.update(id, { landing: true });
  return { store, id };
}

/** Whether `promise` has settled after `ms`. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((r) => setTimeout(r, ms));
  return settled;
}

describe("cancelLiveJobs, with a real process group", () => {
  let leader: number | undefined;
  afterEach(() => {
    if (leader) signalGroup(leader, "SIGKILL");
    leader = undefined;
  });

  test("waits until the cancelled job's group has exited, and keeps the job meanwhile (AC-1)", async () => {
    // A step that takes about a second to let go after its SIGTERM.
    const child = spawn("bash", ["-c", "trap 'sleep 1; exit 0' TERM; while :; do sleep 0.05; done"], {
      detached: true,
      stdio: "ignore",
    });
    leader = child.pid!;
    await new Promise((r) => setTimeout(r, 200)); // the trap is set
    const { store, id } = storeWithRunningJob({ pgid: leader });

    const wait = cancelLiveJobs(store, PROJECT, { limitMs: 10_000 });
    expect(await settledWithin(wait, 400)).toBe(false);
    expect(store.get(id)?.state).toBe("cancelled");
    await wait;
    expect(groupAlive(leader)).toBe(false);
  });
});

describe("cancelLiveJobs and followUntilDrained, with made-up groups", () => {
  // These records carry pids no process here owns: nothing may reach a
  // real kill.
  let kills: unknown[];
  let killSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    kills = [];
    killSpy = spyOn(process, "kill").mockImplementation(((pid: number) => {
      kills.push(pid);
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    }) as typeof process.kill);
  });
  afterEach(() => killSpy.mockRestore());

  const ctxOf = (store: QueueStore) => {
    let scans = 0;
    return {
      ctx: {
        queue: store,
        gitRun: async () => ({ code: 0, stdout: "", stderr: "" }),
        invalidateScan: () => {
          scans += 1;
        },
      },
      scans: () => scans,
    };
  };

  test("a group whose SIGTERM could not be sent is still waited on (AC-1)", async () => {
    const { store } = storeWithRunningJob({ pgid: 4242 });
    const alive = new Set([4242]);
    const wait = cancelLiveJobs(store, PROJECT, { limitMs: 5000, alive: (g) => alive.has(g) });
    expect(await settledWithin(wait, 400)).toBe(false);
    expect(kills).toEqual([-4242]);
    alive.delete(4242);
    await wait;
  });

  test("a press after a cancel wait ran out still waits on the group the first press cancelled (AC-1, AC-2)", async () => {
    const { store, id } = storeWithRunningJob({ pgid: 4242 });
    const alive = new Set([4242]);
    const seams = { limitMs: 200, alive: (g: number) => alive.has(g) };
    await expect(cancelLiveJobs(store, PROJECT, seams)).rejects.toThrow(/process group 4242$/);
    expect(store.get(id)).toMatchObject({ state: "cancelled", pgid: undefined });
    await expect(cancelLiveJobs(store, PROJECT, seams)).rejects.toThrow(/process group 4242$/);
    alive.delete(4242);
    await cancelLiveJobs(store, PROJECT, seams);
  });

  test("the round's wait follows a group whose step started and ended between two polls (AC-3)", async () => {
    const { store, id } = storeWithRunningJob();
    store.transition(id, "step-succeeded-last");
    noteStartedGroup(PROJECT, 4243); // what the server's spawn records
    const { ctx } = ctxOf(store);
    await expect(followUntilDrained(ctx, PROJECT, [], { limitMs: 200, pollMs: 50, alive: (g) => g === 4243 })).rejects.toThrow(
      /^the round's work had not ended after .* seconds: process group 4243$/,
    );
  });

  test("a landing still going when the cancel wait runs out rejects, naming the job, and keeps it (AC-2)", async () => {
    const { store, id } = storeWithRunningJob({ landing: true });
    await expect(cancelLiveJobs(store, PROJECT, { limitMs: 300, alive: () => false })).rejects.toThrow(
      /^the cancelled work had not ended after .* seconds: 01-add-the-first-fact \(landing\)$/,
    );
    expect(store.get(id)).toBeDefined();
  });

  test("resolves at once when nothing of the project is live (AC-4)", async () => {
    const { store, id } = storeWithRunningJob();
    store.transition(id, "step-succeeded-last");
    expect(await settledWithin(cancelLiveJobs(store, PROJECT, { limitMs: 5000, alive: () => true }), 100)).toBe(true);
  });

  test("the round's wait rejects when a job is still running at its end (AC-3)", async () => {
    const { store } = storeWithRunningJob();
    const { ctx, scans } = ctxOf(store);
    await expect(followUntilDrained(ctx, PROJECT, [], { limitMs: 300, pollMs: 50, alive: () => false })).rejects.toThrow(
      /^the round's work had not ended after .* seconds: 01-add-the-first-fact \(running\)$/,
    );
    expect(scans()).toBe(1);
  });

  test("the round's wait rejects when a finished job's group, seen earlier, is still alive (AC-3)", async () => {
    const { store, id } = storeWithRunningJob({ pgid: 4242 });
    const { ctx } = ctxOf(store);
    setTimeout(() => store.transition(id, "step-succeeded-last", { pgid: undefined, pid: undefined }), 100);
    await expect(followUntilDrained(ctx, PROJECT, [], { limitMs: 400, pollMs: 50, alive: (g) => g === 4242 })).rejects.toThrow(
      /^the round's work had not ended after .* seconds: process group 4242$/,
    );
    expect(store.get(id)?.state).toBe("done");
  });

  test("the round's wait resolves once every job and group has ended (AC-4)", async () => {
    const { store, id } = storeWithRunningJob({ pgid: 4242 });
    const { ctx, scans } = ctxOf(store);
    const alive = new Set([4242]);
    setTimeout(() => {
      store.transition(id, "step-succeeded-last", { pgid: undefined, pid: undefined });
      alive.delete(4242);
    }, 100);
    await followUntilDrained(ctx, PROJECT, [], { limitMs: 5000, pollMs: 50, alive: (g) => alive.has(g) });
    expect(scans()).toBe(1);
  });
});

function queueAnalyze(base: string): Promise<Response> {
  return fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { ...auth.headers, "content-type": "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }),
  });
}

/** The round's status, polled until it is done or failed. */
async function roundSettled(base: string) {
  let state: { stage: string; startedAt?: string; error?: string; specs: unknown[] } = { stage: "resetting", specs: [] };
  for (let i = 0; i < 100 && state.stage !== "done" && state.stage !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    state = (await (await fetch(`${base}/api/self-run`, auth)).json()) as typeof state;
  }
  return state;
}
