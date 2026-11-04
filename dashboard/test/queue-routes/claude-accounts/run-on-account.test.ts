// "Run on <account>": a step stopped on Claude's usage limit is queued
// again at once on another login. The rule for which accounts are offered
// is proven in `test/queue/runner/claude-accounts/`; this proves the route
// that presses it.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WAITING_RUNNER } from "../../helpers/waiting-runner.ts";
import { IMPLEMENTED } from "../../helpers/queue-server.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { defaultsOf } from "../settings-models/fixtures.ts";

const { harness } = setupQueueRoutesHarness(undefined, IMPLEMENTED);
const own: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (own.length) rmSync(own.pop()!, { recursive: true, force: true });
});

const STOPPED = {
  id: "old-1",
  project: "aide",
  specFolder: "81-queue-and-runner",
  steps: ["implement"],
  stepIndex: 0,
  state: "stopped",
  stopReason: "provider-limit",
  timeoutSec: {},
  permissionMode: {},
  model: {},
  results: [{ step: "implement", ok: false, terminalReason: "provider-limit", costUsd: 0, tool: "claude" }],
  spentUsd: 0,
  createdAt: "2026-08-16T08:00:00.000Z",
  finishedAt: "2026-08-16T10:00:00.000Z",
  usageLimitWait: { until: "2099-01-01T00:00:00.000Z", resetKnown: true },
  error: { key: "runner.runVanished", values: { button: "x" } },
};

function serve(job: Record<string, unknown> = STOPPED) {
  const scratch = mkdtempSync(join(tmpdir(), "aide-run-on-"));
  own.push(scratch);
  const queueDefaults = {
    ...defaultsOf(undefined, { implement: "opus", default: "sonnet" }),
    claudeAccounts: { Work: { configDir: "~/.claude-2" }, Spare: { configDir: "/opt/claude-3" } },
  };
  const started = harness.start({
    extra: { queueRunnerBin: WAITING_RUNNER, queueResultDir: scratch, queueConcurrency: 3, queueDefaults },
    queueMirror: JSON.stringify([job]),
  });
  const mirror = () =>
    (JSON.parse(readFileSync(join(started.dir, "queue.json"), "utf-8")) as Record<string, unknown>[]).find((j) => j.id === "old-1")!;
  const press = (id: string, body: Record<string, unknown>) =>
    fetch(`${started.base}/api/queue/${id}/run-on`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  return { ...started, mirror, press };
}

describe("pressing Run on <account>", () => {
  test("queues the step at once on that account, remembering the wait it leaves behind (AC-3)", async () => {
    const { press, mirror } = serve();
    const res = await press("old-1", { account: "Work" });
    expect(res.status).toBe(200);
    const job = mirror();
    expect(job.claudeAccount).toEqual({ name: "Work", configDir: join(homedir(), ".claude-2") });
    expect(job.pressed).toBe(true);
    expect(["queued", "running"]).toContain(job.state as string);
    expect(job.stopReason).toBeUndefined();
    expect(job.usageLimitWait).toBeUndefined();
    expect(job.error).toBeUndefined();
    expect(job.usageLimitLeft).toEqual({
      hold: "claude", until: "2099-01-01T00:00:00.000Z", resetKnown: true, since: "2026-08-16T10:00:00.000Z",
    });
  });

  test("Default moves a job that is on another account back, and leaves it with no account (AC-3)", async () => {
    const onWork = { ...STOPPED, claudeAccount: { name: "Work", configDir: join(homedir(), ".claude-2") } };
    const { press, mirror } = serve(onWork);
    expect((await press("old-1", { account: "Default" })).status).toBe(200);
    expect(mirror().claudeAccount).toBeUndefined();
    expect((mirror().usageLimitLeft as { hold: string }).hold).toBe(`claude:${join(homedir(), ".claude-2")}`);
  });

  test("is refused for no such job, for a job not stopped on a usage limit, and for an account not offered (AC-3)", async () => {
    const { press, mirror } = serve();
    expect((await press("nope", { account: "Work" })).status).toBe(404);
    expect((await press("old-1", { account: "Nobody" })).status).toBe(400);
    expect((await press("old-1", { account: "Default" })).status).toBe(400);
    expect(mirror().state).toBe("stopped");
    expect(mirror().claudeAccount).toBeUndefined();

    const other = serve({ ...STOPPED, stopReason: "cap", usageLimitWait: undefined });
    expect((await other.press("old-1", { account: "Work" })).status).toBe(409);
    expect(other.mirror().state).toBe("stopped");
  });
});
