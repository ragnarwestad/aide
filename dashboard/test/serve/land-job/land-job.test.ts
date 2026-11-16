import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "../../../src/queue/store/index.ts";
import { createLandJob } from "../../../src/serve/land-job/index.ts";
import { runLogPath } from "../../../src/queue/runner/run-log-path.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aide-land-job-"));
  dirs.push(dir);
  const queue = new QueueStore({
    mirrorPath: join(dir, "queue.json"),
    defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => ({ specFolders: [] }),
  });
  const queued = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "topic" });
  if (!queued.ok) throw new Error(queued.error);
  return { dir, queue, job: queued.job, result: join(dir, "result.json"), stream: join(dir, "stream.log") };
}

describe("the Land board job", () => {
  test("hands the pushed branch to the shared landing and finishes its four tasks (AC-6, AC-10)", async () => {
    const f = fixture();
    let call: unknown;
    const land = async (_ctx: unknown, _job: unknown, outcome: unknown, what: { progress?: (stage: string) => void }) => {
      call = { outcome, what };
      what.progress?.("tests");
      what.progress?.("push");
      what.progress?.("delete");
    };
    createLandJob({ queue: f.queue, machineryProjectDir: () => "/project" } as never, land as never)
      .start(f.job, f.result, f.stream);
    await Bun.sleep(20);

    expect(call).toMatchObject({
      outcome: { branch: "topic", branchUrls: [{ root: "/project", url: "origin/topic" }] },
      what: { step: "land", repos: [{ root: "/project", url: "origin/topic" }] },
    });
    expect(readFileSync(f.result, "utf8")).toContain('"terminalReason":"completed"');
    expect(readFileSync(runLogPath(f.stream), "utf8")).toContain("--- Step 4 of 4: Delete source branch — done");
    const log = readFileSync(runLogPath(f.stream), "utf8");
    expect(log.indexOf("Merge branch — done")).toBeLessThan(log.indexOf("Run tests — started"));
    expect(log.indexOf("Run tests — done")).toBeLessThan(log.indexOf("Push default branch — started"));
    expect(log.indexOf("Push default branch — done")).toBeLessThan(log.indexOf("Delete source branch — started"));
  });

  test("keeps a conflict or red test result stopped instead of claiming completion (AC-8, AC-9)", async () => {
    for (const reason of ["conflict", "tests-red"] as const) {
      const f = fixture();
      const land = async () => { f.queue.update(f.job.id, { errorReason: reason }); };
      createLandJob({ queue: f.queue, machineryProjectDir: () => "/project" } as never, land as never)
        .start(f.job, f.result, f.stream);
      await Bun.sleep(20);
      expect(readFileSync(f.result, "utf8")).toContain(`"terminalReason":"${reason}"`);
      expect(readFileSync(runLogPath(f.stream), "utf8")).toContain(`stopped: ${reason}`);
    }
  });

  test("a source branch left on origin stops the job (AC-6)", async () => {
    const f = fixture();
    const land = async (_ctx: unknown, _job: unknown, _outcome: unknown, what: { progress?: (stage: string) => void }) => {
      what.progress?.("tests");
      what.progress?.("push");
      what.progress?.("delete");
      f.queue.update(f.job.id, { branchDeleteError: [{ key: "landing.branchDeleteFailed", values: { branch: "topic" } }] });
    };
    createLandJob({ queue: f.queue, machineryProjectDir: () => "/project" } as never, land as never)
      .start(f.job, f.result, f.stream);
    await Bun.sleep(20);
    expect(readFileSync(f.result, "utf8")).toContain('"terminalReason":"branch-delete-failed"');
    expect(readFileSync(runLogPath(f.stream), "utf8")).toContain("Delete source branch — stopped: branch delete failed");
  });
});

test("the test gate writes progress into the Land job's run log", async () => {
  const { stepLogLine } = await import("../../../src/serve/land-branch/test-gate.ts");
  const f = fixture();
  const land = async (_ctx: unknown, job: Parameters<typeof stepLogLine>[0]) => {
    stepLogLine(job, "tests: pytest 40%");
  };
  createLandJob({ queue: f.queue, machineryProjectDir: () => "/project" } as never, land as never)
    .start(f.job, f.result, f.stream);
  await Bun.sleep(20);
  expect(readFileSync(runLogPath(f.stream), "utf8")).toContain("tests: pytest 40%");
});
