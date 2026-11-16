import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "../../../src/queue/queue.ts";
import { createLandJob } from "../../../src/serve/land-job/index.ts";
import { handleJobActionRoutes } from "../../../src/serve/routes/job-actions.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aide-stop-land-"));
  dirs.push(dir);
  const queue = new QueueStore({ defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: {} },
    resolve: () => ({ specFolders: [] }) });
  const made = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "topic" });
  if (!made.ok) throw new Error(made.error);
  queue.transition(made.job.id, "start");
  const job = queue.get(made.job.id)!;
  const result = join(dir, "result.json");
  const stop = () => handleJobActionRoutes({ queue } as never,
    new Request(`http://board/api/queue/${job.id}/cancel`, { method: "POST" }), `/api/queue/${job.id}/cancel`);
  return { queue, job, result, stream: join(dir, "stream.log"), stop };
}

test("Stop during tests prevents push and preserves the cancelled outcome", async () => {
  const f = fixture();
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  let pushed = false;
  let settled!: () => void;
  const finished = new Promise<void>((resolve) => { settled = resolve; });
  const land = async (_ctx: unknown, _job: unknown, _outcome: unknown, what: { progress: (stage: string) => void }) => {
    what.progress("tests");
    await paused;
    try { what.progress("push"); pushed = true; } finally { settled(); }
  };
  createLandJob({ queue: f.queue, machineryProjectDir: () => "/project" } as never, land as never).start(f.job, f.result, f.stream);
  expect((await f.stop())?.status).toBe(200);
  release();
  await finished;
  await Bun.sleep(10);
  expect(pushed).toBe(false);
  expect(f.queue.get(f.job.id)?.state).toBe("cancelled");
  expect(JSON.parse(readFileSync(f.result, "utf8")).terminalReason).not.toBe("completed");
});

test("Stop is refused once push has begun and the job keeps running", async () => {
  const f = fixture();
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const land = async (_ctx: unknown, _job: unknown, _outcome: unknown, what: { progress: (stage: string) => void }) => {
    what.progress("push");
    await paused;
  };
  createLandJob({ queue: f.queue, machineryProjectDir: () => "/project" } as never, land as never).start(f.job, f.result, f.stream);
  try {
    expect((await f.stop())?.status).toBe(409);
    expect(f.queue.get(f.job.id)?.state).toBe("running");
  } finally { release(); await Bun.sleep(10); }
});

test("Stop kills the active test script and prevents another test attempt", async () => {
  const { runScript } = await import("../../../src/serve/land-branch/run-script.ts");
  const { landingProcessGroups } = await import("../../../src/serve/land-branch/cancel-landing.ts");
  const f = fixture();
  let answer!: (result: string) => void;
  const finished = new Promise<string>((resolve) => { answer = resolve; });
  let retried = false;
  const land = async () => {
    try {
      await runScript(["/bin/bash", "-c", "exec sleep 30"], tmpdir(), 35_000, f.job.id);
      answer("script continued");
    } catch { answer("stopped"); }
    await runScript(["/bin/bash", "-c", "exit 0"], tmpdir(), 1000, f.job.id);
    retried = true;
  };
  createLandJob({ queue: f.queue, machineryProjectDir: () => "/project" } as never, land as never).start(f.job, f.result, f.stream);
  try {
    const deadline = Date.now() + 3000;
    while (!landingProcessGroups().length && Date.now() < deadline) await Bun.sleep(5);
    expect(landingProcessGroups().length).toBeGreaterThan(0);
    expect((await f.stop())?.status).toBe(200);
    expect(await Promise.race([finished, Bun.sleep(3000).then(() => "timed out")])).toBe("stopped");
    await Bun.sleep(10);
    expect(JSON.parse(readFileSync(f.result, "utf8")).terminalReason).toBe("cancelled");
    expect(retried).toBe(false);
  } finally { await f.stop(); }
});

test("the shared merge never pushes or deletes the source branch after Stop", async () => {
  const { landCtx, landingGit } = await import("../land-branch/landing-fixtures.ts");
  const f = fixture();
  const git = landingGit({ "diff --quiet": { code: 1 } });
  let release!: () => void;
  const pause = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const testing = new Promise<void>((resolve) => { entered = resolve; });
  const { ctx } = landCtx(git.run, { queue: f.queue, machineryProjectDir: () => "/repos/aide-code",
    landingGate: async () => { entered(); await pause; return { ok: true }; } });
  createLandJob(ctx as never).start(f.job, f.result, f.stream);
  await testing;
  expect((await f.stop())?.status).toBe(200);
  release();
  const deadline = Date.now() + 3000;
  while (f.queue.get(f.job.id)?.landing && Date.now() < deadline) await Bun.sleep(5);
  expect(f.queue.get(f.job.id)).toMatchObject({ state: "cancelled", landing: undefined });
  expect(f.queue.get(f.job.id)?.landingError).toBeUndefined();
  expect(git.calls.some((call) => call.args[0] === "push")).toBe(false);
  expect(JSON.parse(readFileSync(f.result, "utf8")).terminalReason).toBe("cancelled");
});
