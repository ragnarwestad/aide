// The Slack wrapper (spec 81, slice 81c). It is the only piece that
// knows what a webhook is, so it is worth proving on its own: one line
// of JSON in, one readable line out, the secret read from a file, and
// exit 0 whatever happens — a failed notification must never read as a
// failed run.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "deploy", "notify-slack.sh");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-notify-slack-"));
  dirs.push(dir);
  return dir;
}

/** A throwaway webhook: records what Slack would have received. */
function webhook() {
  const posted: { text?: string }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      posted.push((await req.json()) as { text?: string });
      return new Response("ok");
    },
  });
  // Awaited by the callers: the next test starts its own server, and a
  // port still closing is a flake waiting to happen.
  return { posted, url: `http://127.0.0.1:${server.port}/hook`, stop: () => server.stop(true) };
}

async function run(payload: unknown, opts: { webhookUrl?: string } = {}): Promise<number> {
  const dir = workspace();
  const file = join(dir, "slack-webhook");
  if (opts.webhookUrl !== undefined) writeFileSync(file, `${opts.webhookUrl}\n`);
  chmodSync(SCRIPT, 0o755);
  const proc = Bun.spawn({
    cmd: [SCRIPT],
    env: { ...process.env, AIDE_SLACK_WEBHOOK_FILE: file },
    stdin: new TextEncoder().encode(`${JSON.stringify(payload)}\n`),
    stdout: "ignore",
    stderr: "ignore",
  });
  return await proc.exited;
}

const GATE = {
  event: "gate",
  project: "aide",
  spec: "81-queue-and-runner",
  step: "analyze",
  jobId: "job-1",
  costUsd: 2.1,
  branchUrl: "https://github.com/ragnarwestad/aide/compare/main...aide/81-queue-and-runner",
  at: "2026-08-16T22:00:00Z",
};

describe("the line a phone shows at 02:00", () => {
  test("a gate says what is waiting, what it cost and where to look", async () => {
    const hook = webhook();
    try {
      expect(await run(GATE, { webhookUrl: hook.url })).toBe(0);
      expect(hook.posted.length).toBe(1);
      const text = hook.posted[0]!.text ?? "";
      expect(text).toContain("aide · 81-queue-and-runner");
      expect(text).toContain("analyze done, waiting for approval");
      expect(text).toContain("$2.1");
      expect(text).toContain(GATE.branchUrl);
    } finally {
      await hook.stop();
    }
  });

  test("a stop names its reason — a cap-stop must not read as a crash", async () => {
    const hook = webhook();
    try {
      await run({ ...GATE, event: "stopped", reason: "budget" }, { webhookUrl: hook.url });
      expect(hook.posted[0]!.text).toContain("stopped: budget");
      expect(hook.posted[0]!.text).not.toContain("failed");
    } finally {
      await hook.stop();
    }
  });
});

describe("failing quietly", () => {
  test("no webhook file → nothing posted, exit 0", async () => {
    expect(await run(GATE)).toBe(0);
  });

  test("an unreachable webhook is still exit 0", async () => {
    expect(await run(GATE, { webhookUrl: "http://127.0.0.1:9/hook" })).toBe(0);
  });
});
