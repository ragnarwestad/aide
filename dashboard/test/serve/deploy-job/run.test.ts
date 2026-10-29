// The deploy job's run, in the process the restart takes down: its five marked
// steps, the wait for a landing before the fetch and before the restart, and
// the result it leaves for the runner. Git, the install and the restart are
// fakes; the queue store is the real one.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import type { Sentence } from "../../../src/i18n/message.ts";
import { runDeploy, type DeployRunDeps } from "../../../src/serve/deploy-job/run.ts";
import { createRootLock } from "../../../src/serve/serve-helpers";
import { cleanupHarness, dir, enqueue, resetHarness, store } from "../../queue/runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const ROOT = "/srv/aide";
const HEAD = "abc1234deadbeef";
const OLDER = "9999999cafefeed";

interface Setup {
  deps: DeployRunDeps;
  id: string;
  git: string[];
  calls: { install: number; restart: number; restartWhenSettled: number };
  faults: (Sentence | null)[];
  failures: ({ step: string; error: string } | null)[];
  lock: ReturnType<typeof createRootLock>;
  writes: () => number;
  result: () => Record<string, unknown> | undefined;
  marks: () => string[];
}

/** A started deploy job and the dependencies its run is given. */
function setup(over: Partial<DeployRunDeps> = {}, opts: { mergeFails?: boolean } = {}): Setup {
  const job = enqueue({ specFolder: "deploy", steps: ["deploy"] });
  const resultFile = join(dir, `${job.id}.json`);
  const streamFile = join(dir, `${job.id}.deploy.stream.jsonl`);
  store.transition(job.id, "start", {
    pid: process.pid,
    pgid: 0,
    resultFile,
    streamFile,
    startedAt: new Date().toISOString(),
    stepStartedAt: new Date().toISOString(),
  });
  const git: string[] = [];
  const gitRun: GitRunner = async (_dir, args) => {
    const line = args.join(" ");
    git.push(line);
    if (line === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "master\n" };
    if (line === "rev-parse HEAD") return { code: 0, stdout: `${HEAD}\n` };
    if (line.startsWith("merge") && opts.mergeFails) return { code: 1, stdout: "", stderr: "not a fast-forward" };
    return { code: 0, stdout: "" };
  };
  const calls = { install: 0, restart: 0, restartWhenSettled: 0 };
  const faults: (Sentence | null)[] = [];
  const failures: ({ step: string; error: string } | null)[] = [];
  const lock = createRootLock();
  let updates = 0;
  const deps: DeployRunDeps = {
    queue: {
      get: (i) => store.get(i),
      update: (i, patch) => {
        if ("errorReason" in patch) updates += 1;
        return store.update(i, patch);
      },
    },
    projectRoot: () => ROOT,
    isBoard: (root) => root === ROOT,
    gitRun,
    branchStatus: { defaultBranch: async () => "master", commitsBehindOrigin: async () => 0 },
    mergeLock: lock,
    installCheckout: async () => {
      calls.install += 1;
      return false;
    },
    restartRegistered: async () => false,
    restartWhenSettled: async () => {
      calls.restartWhenSettled += 1;
      return false;
    },
    readServing: () => ({ sha: HEAD, repoRoot: ROOT }),
    setFailure: (_p, f) => void failures.push(f),
    setFault: (f) => void faults.push(f),
    startedAt: "2026-10-13T08:00:00.000Z",
    lockPollMs: 5,
    restartWaitMs: 60_000,
    ...over,
  };
  return {
    deps,
    id: job.id,
    git,
    calls,
    faults,
    failures,
    lock,
    writes: () => updates,
    result: () => (existsSync(resultFile) ? (JSON.parse(readFileSync(resultFile, "utf-8")) as Record<string, unknown>) : undefined),
    marks: () => {
      const log = streamFile.replace(/\.stream\.jsonl$/, ".run.log");
      return existsSync(log)
        ? readFileSync(log, "utf-8").split("\n").filter((l) => l.includes("--- Step")).map((l) => l.replace(/^.*?(--- Step)/, "$1"))
        : [];
    },
  };
}

const sentenceKey = (s: Setup): unknown => (s.result()?.sentence as { key?: string } | undefined)?.key;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("a deploy with nothing to restart", () => {
  test("marks its five steps, records the commit it fetched and ends done when the service runs it", async () => {
    const s = setup();
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    expect(s.result()).toMatchObject({ ok: true, terminalReason: "completed", tool: "none", costMeasured: false });
    expect(s.marks().map((m) => m.replace(/^--- Step (\d) of 5: .* — /, "$1 "))).toEqual([
      "1 started", "1 done", "2 started", "2 done", "3 skipped", "4 skipped", "5 started", "5 done",
    ]);
    expect(store.get(s.id)?.deploy).toMatchObject({ root: ROOT, commit: HEAD });
    expect(s.git).toContain("merge -q --ff-only origin/master");
    expect(s.calls.install).toBe(1);
    expect(s.calls.restartWhenSettled).toBe(0);
  });

  test("ends failed when the service runs an older commit than the checkout, and says so at the top", async () => {
    const s = setup({ readServing: () => ({ sha: OLDER, repoRoot: ROOT }) });
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    expect(s.result()).toMatchObject({ ok: false, terminalReason: "deploy-failed" });
    expect(s.result()?.sentence).toEqual({ key: "landing.deployNoRestart", values: { served: OLDER.slice(0, 7), head: HEAD.slice(0, 7) } });
    expect(s.faults.at(-1)).toMatchObject({ key: "landing.deployNoRestart" });
  });

  test("ends done when the served commit is not known yet", async () => {
    const s = setup({ readServing: () => ({ sha: null, repoRoot: null }) });
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    expect(s.result()).toMatchObject({ ok: true });
  });
});

describe("a deploy that fails stops where it failed", () => {
  test("a fetch that cannot fast-forward ends failed with that sentence, installs nothing and restarts nothing", async () => {
    const s = setup({ restartRegistered: async () => true }, { mergeFails: true });
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    expect(s.result()).toMatchObject({ ok: false, terminalReason: "deploy-failed" });
    expect(sentenceKey(s)).toBe("landing.deployCannotFastForward");
    expect(s.marks().at(-1)).toContain("Step 1 of 5");
    expect(s.marks().at(-1)).toContain("stopped");
    expect(s.calls.install).toBe(0);
    expect(s.calls.restartWhenSettled).toBe(0);
    expect(s.failures.at(-1)).toMatchObject({ step: "fetch" });
  });

  test("an install that fails ends failed with its sentence and restarts nothing", async () => {
    const s = setup({
      restartRegistered: async () => true,
      installCheckout: async (r) => {
        r.installError = "the install exploded";
        return false;
      },
    });
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    expect(s.result()).toMatchObject({ ok: false, error: "the install exploded", sentence: "the install exploded" });
    expect(s.marks().at(-1)).toContain("Step 2 of 5");
    expect(s.marks().at(-1)).toContain("stopped");
    expect(s.calls.restartWhenSettled).toBe(0);
    expect(s.failures.at(-1)).toMatchObject({ step: "install" });
  });

  test("a checkout that is not the board's ends failed before anything is fetched", async () => {
    const s = setup({ isBoard: () => false });
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    expect(s.result()).toMatchObject({ ok: false, terminalReason: "deploy-failed" });
    expect(s.git).toEqual([]);
    expect(s.calls.install).toBe(0);
  });
});

describe("a deploy waits for a landing before its fetch", () => {
  test("it fetches nothing while a landing holds the checkout, the job carries the hold, and both go when it clears", async () => {
    const s = setup();
    let release = (): void => {};
    const held = s.lock.run(ROOT, () => new Promise<void>((r) => (release = r)));
    const running = runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    await wait(60);
    expect(s.git.some((l) => l.startsWith("fetch"))).toBe(false);
    expect(store.get(s.id)?.error).toEqual({ key: "runner.landingPause" });
    expect(store.get(s.id)?.errorReason).toBe("held-back");
    expect(s.writes()).toBe(1);

    release();
    await held;
    await running;
    expect(s.git.some((l) => l.startsWith("fetch"))).toBe(true);
    expect(store.get(s.id)?.error).toBeUndefined();
    expect(store.get(s.id)?.errorReason).toBeUndefined();
    expect(s.result()).toMatchObject({ ok: true });
  });
});

describe("a deploy whose service can be restarted", () => {
  /** A restart that waits for a landing for three polls, then clears and fires. */
  function restarting() {
    const snap: { during?: ReturnType<typeof store.get>; after?: ReturnType<typeof store.get> } = {};
    const own = { id: "" };
    let fired = 0;
    const s = setup({
      restartRegistered: async () => true,
      restartWhenSettled: async (h) => {
        fired += 1;
        for (let i = 0; i < 3; i++) h.onWait(["aide:81-queue-and-runner"]);
        snap.during = store.get(own.id);
        h.onWait([]);
        snap.after = store.get(own.id);
        h.beforeFire();
        return true;
      },
    });
    own.id = s.id;
    return { s, snap, fired: () => fired };
  }

  test("goes through the restart that waits, with the hold on the job written once while it waits, and gone after", async () => {
    const { s, snap, fired } = restarting();
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    expect(fired()).toBe(1);
    expect(snap.during?.error).toEqual({ key: "runner.landingPause" });
    expect(snap.during?.errorReason).toBe("held-back");
    expect(snap.after?.error).toBeUndefined();
    expect(snap.after?.errorReason).toBeUndefined();
    // Once when the wait starts, once when it ends — not on every poll.
    expect(s.writes()).toBe(2);
  });

  test("records the restart in the job before the process goes, marks the wait started, and writes no result itself", async () => {
    const { s } = restarting();
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    const after = store.get(s.id);
    expect(after?.state).toBe("running");
    expect(after?.deploy?.restartedAt).toBeDefined();
    expect(after?.deploy?.leaving).toBe("2026-10-13T08:00:00.000Z");
    expect(after?.deploy?.commit).toBe(HEAD);
    expect(s.marks().at(-2)).toContain("Step 3 of 5");
    expect(s.marks().at(-2)).toContain("done");
    expect(s.marks().at(-1)).toContain("Step 4 of 5");
    expect(s.marks().at(-1)).toContain("started");
    expect(s.result()).toBeUndefined();
  });

  test("a process still alive when the wait for the new one ends fails the job with the no-answer sentence", async () => {
    const s = setup({
      restartRegistered: async () => true,
      restartWhenSettled: async (h) => {
        h.beforeFire();
        return true;
      },
      restartWaitMs: 30,
    });
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    expect(s.result()).toBeUndefined();
    await wait(120);
    expect(s.result()).toMatchObject({ ok: false, terminalReason: "deploy-failed" });
    expect(sentenceKey(s)).toBe("landing.deployNoAnswer");
  });

  test("the wait ends quietly for a job that is no longer running", async () => {
    const s = setup({
      restartRegistered: async () => true,
      restartWhenSettled: async (h) => {
        h.beforeFire();
        return true;
      },
      restartWaitMs: 30,
    });
    await runDeploy(s.deps, s.id, join(dir, `${s.id}.json`));
    store.transition(s.id, "step-succeeded-last", { finishedAt: new Date().toISOString() });
    await wait(120);
    expect(s.result()).toBeUndefined();
  });
});
