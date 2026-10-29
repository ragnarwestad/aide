// The process that starts after a deploy's restart finishes the job: it checks
// the commit it runs and writes the result the runner's boot `reconcile` ends
// the job on. The job is read back from the stored queue file, as a restart
// leaves it, and ended through a real `Runner.reconcile`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { QueueStore } from "../../../src/queue/queue.ts";
import type { Sentence } from "../../../src/i18n/message.ts";
import { finishDeployAfterRestart } from "../../../src/serve/deploy-job/after-restart.ts";
import { cleanupHarness, DEFAULTS, dir, enqueue, makeRunner, resetHarness, store } from "../../queue/runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const ROOT = "/srv/aide";
const FETCHED = "abc1234deadbeef";
const LATER = "def5678cafefeed";
const MINUTE = 60_000;

/** A deploy job that fired its restart `ago` ms before `NOW`, left running by the process that went. */
const NOW = Date.parse("2026-10-13T09:00:00.000Z");
function restartedDeploy(ago = 10_000, deploy: Record<string, unknown> = {}): string {
  const job = enqueue({ specFolder: "deploy", steps: ["deploy"] });
  const stamp = new Date(NOW - ago - 5000).toISOString();
  store.transition(job.id, "start", {
    pid: 4_194_000,
    pgid: 0,
    resultFile: join(dir, `${job.id}.json`),
    streamFile: join(dir, `${job.id}.deploy.stream.jsonl`),
    startedAt: stamp,
    stepStartedAt: stamp,
  });
  store.update(job.id, {
    deploy: { root: ROOT, commit: FETCHED, restartedAt: new Date(NOW - ago).toISOString(), leaving: "old", ...deploy },
  });
  return job.id;
}

/** The queue as the new process reads it from the file the old one wrote. */
const reread = () =>
  new QueueStore({
    mirrorPath: join(dir, "queue.json"),
    defaults: DEFAULTS,
    resolve: (p) => (p === "aide" ? { specFolders: ["81-queue-and-runner"] } : null),
  });

/** What the process that boots runs, and whether it contains the fetched commit. */
function git(head: string, contains: boolean) {
  const calls: string[] = [];
  return {
    calls,
    run: (_root: string, args: string[]): { code: number; stdout: string } => {
      const line = args.join(" ");
      calls.push(line);
      if (line === "rev-parse HEAD") return { code: 0, stdout: `${head}\n` };
      if (line.startsWith("merge-base --is-ancestor")) return { code: contains ? 0 : 1, stdout: "" };
      return { code: 1, stdout: "" };
    },
  };
}

/** Boot: finish the deploy, then reconcile. */
function boot(head: string, contains = false): { board: QueueStore; faults: (Sentence | null)[]; git: ReturnType<typeof git> } {
  const board = reread();
  const faults: (Sentence | null)[] = [];
  const g = git(head, contains);
  finishDeployAfterRestart({
    queue: board,
    dashboardRoot: ROOT,
    git: g.run,
    setFault: (f) => void faults.push(f),
    now: () => NOW,
    restartWaitMs: 3 * MINUTE,
  });
  makeRunner({
    store: board,
    alive: () => false,
    readResult: (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null),
  }).reconcile();
  return { board, faults, git: g };
}

const marks = (id: string): string[] => {
  const log = join(dir, `${id}.deploy.run.log`);
  return existsSync(log)
    ? readFileSync(log, "utf-8").split("\n").filter((l) => l.includes("--- Step")).map((l) => l.replace(/^.*?(--- Step)/, "$1"))
    : [];
};

describe("the new process checks the commit it runs", () => {
  test("the fetched commit itself: the wait and the check are marked done and the job ends done", () => {
    const id = restartedDeploy();
    const { board } = boot(FETCHED);
    expect(board.get(id)?.state).toBe("done");
    expect(board.get(id)?.results.at(-1)).toMatchObject({ ok: true, terminalReason: "completed" });
    expect(marks(id).map((m) => m.replace(/^--- Step (\d) of 5: .* — /, "$1 "))).toEqual(["4 done", "5 started", "5 done"]);
  });

  test("a later commit that contains the fetched one is the same", () => {
    const id = restartedDeploy();
    const { board, git: g } = boot(LATER, true);
    expect(board.get(id)?.state).toBe("done");
    expect(g.calls).toContain(`merge-base --is-ancestor ${FETCHED} ${LATER}`);
  });
});

describe("the new process fails a deploy that did not take", () => {
  test("a commit that does not contain the fetched one ends the job failed with the served commit, and sets the header fault", () => {
    const id = restartedDeploy();
    const { board, faults } = boot(LATER, false);
    expect(board.get(id)?.state).toBe("failed");
    expect(board.get(id)?.error).toEqual({
      key: "landing.deployServiceOlder",
      values: { served: LATER.slice(0, 7), head: FETCHED.slice(0, 7) },
    });
    expect(faults.at(-1)).toMatchObject({ key: "landing.deployServiceOlder" });
    expect(marks(id).at(-1)).toContain("stopped");
  });

  test("a restart more than three minutes ago is a service that did not answer in time", () => {
    const id = restartedDeploy(4 * MINUTE);
    const { board } = boot(FETCHED);
    expect(board.get(id)?.state).toBe("failed");
    expect(board.get(id)?.error).toEqual({ key: "landing.deployNoAnswer" });
    expect(marks(id).at(-1)).toContain("Step 4 of 5");
    expect(marks(id).at(-1)).toContain("stopped");
  });
});

describe("what the new process leaves alone", () => {
  test("a deploy cut before its own restart is interrupted by the boot's reconcile, not finished", () => {
    const id = restartedDeploy(10_000, { restartedAt: undefined });
    const { board } = boot(FETCHED);
    expect(board.get(id)?.state).toBe("interrupted");
    expect(board.get(id)?.error).toMatchObject({ key: "runner.serverRestarted" });
  });

  test("a running job that is not a deploy is untouched", () => {
    const job = enqueue();
    store.transition(job.id, "start", { pid: 4_194_000, pgid: 0, resultFile: join(dir, "other.json") });
    const { board, git: g } = boot(FETCHED);
    expect(g.calls).toEqual([]);
    expect(board.get(job.id)?.state).toBe("interrupted");
  });
});
