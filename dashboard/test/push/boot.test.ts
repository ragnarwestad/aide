// A restart is not news (AC-5, criterion 12): a job that finished before
// the server went down sends nothing when it comes back up, and the one
// job the last server left `running` sends exactly one push when the
// runner reconciles it. The whole path is the real one: `createServer`
// with a mirror on disk, a subscription, and a fake `fetch`.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../../src/serve/serve.ts";
import { loadOrCreateKeys } from "../../src/push/vapid.ts";
import { writeSubscriptions } from "../../src/push/subscriptions.ts";
import { fakeFetch, subscribeBody, DEFAULTS, SPEC } from "./fixtures.ts";

const dirs: string[] = [];
const servers: { stop: () => void }[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.stop();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const job = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id, project: "aide", specFolder: SPEC, steps: ["implement"], stepIndex: 0, state,
  timeoutSec: { implement: 60 }, permissionMode: { implement: "acceptEdits" }, model: { implement: "sonnet" },
  createdAt: "2026-09-01T10:00:00.000Z", results: [], spentUsd: 0, ...extra,
});

async function boot(jobs: object[]) {
  const dir = mkdtempSync(join(tmpdir(), "aide-push-boot-"));
  dirs.push(dir);
  const root = join(dir, "root");
  mkdirSync(join(root, "aide", ".aide"), { recursive: true });
  writeFileSync(join(root, "aide", ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(join(root, "aide", "specs", SPEC), { recursive: true });
  writeFileSync(join(root, "aide", "specs", SPEC, "1-description.md"), "# x\n");
  writeFileSync(join(dir, "queue.json"), JSON.stringify(jobs));
  // The device subscribed under an earlier run: its subscription and the
  // server's key are already on disk when this one starts.
  const keyPath = join(dir, "push-key.json");
  const subscriptionsPath = join(dir, "push-subscriptions.json");
  const keys = await loadOrCreateKeys(keyPath);
  const body = await subscribeBody();
  writeSubscriptions(subscriptionsPath, [
    { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, lang: "en", origin: "https://board.test", key: keys.publicKey },
  ]);
  const sent = fakeFetch();
  const runner = join(dir, "runner");
  writeFileSync(runner, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const server = createServer({
    port: 0, mirrorPath: join(dir, "runs.json"), queueMirrorPath: join(dir, "queue.json"),
    projectRoot: root, queueProjectRoot: root, queueProjects: ["aide"], dashboardCheckoutRoot: join(dir, "owned"),
    queueRunnerBin: runner, queueResultDir: join(dir, "results"), queueDefaults: DEFAULTS,
    specCachePollMs: 0, driftPollMs: 0, scheduleCheckMs: 0,
    restart: { registered: async () => false, fire: () => {} }, landingGate: async () => ({ ok: true }),
    testServersPortProbe: () => true,
    pushSubscriptionsPath: subscriptionsPath, pushKeyPath: keyPath, pushFetch: sent.fetch,
  });
  servers.push(server);
  return sent;
}

describe("a restart sends one push for the job it cut off, and none for the finished ones (criterion 12)", () => {
  test("finished jobs stay quiet; a job left running with no process is interrupted and announced once", async () => {
    const sent = await boot([
      job("f1", "failed"), job("s1", "stopped", { stopReason: "timeout" }), job("d1", "done"),
      job("r1", "running", { pid: 2_000_000_000, startedAt: "2026-09-01T10:00:00.000Z" }),
    ]);
    await Bun.sleep(300);
    expect(sent.calls).toHaveLength(1);
  });

  test("with nothing left running there is nothing to announce", async () => {
    const sent = await boot([job("f1", "failed"), job("d1", "done")]);
    await Bun.sleep(300);
    expect(sent.calls).toHaveLength(0);
  });
});
