import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "../../../../src/queue/queue.ts";
import { createLandingGate } from "../../../../src/serve/land-branch/repair/index.ts";

test("the gate factory runs the scripts beside the runner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "landing-gate-wiring-"));
  const root = join(dir, "code"); const bin = join(dir, "bin"); const marker = join(dir, "called");
  mkdirSync(root); mkdirSync(bin);
  const previousLog = process.env.AIDE_TEST_GATE_LOG;
  process.env.AIDE_TEST_GATE_LOG = join(dir, "gate.log");
  try {
    writeFileSync(join(root, "code.ts"), "export {};\n");
    for (const args of [["init", "-q", "-b", "main"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.com"], ["add", "code.ts"], ["commit", "-qm", "initial"]]) {
      if (Bun.spawnSync(["git", "-C", root, ...args]).exitCode) throw new Error("git setup failed");
    }
    writeFileSync(join(bin, "aide-resolve-test-cmd"), `#!/bin/sh\necho resolver >> '${marker}'\nprintf '%s\\n' '{"ok":true,"commands":["true"]}'\n`, { mode: 0o755 });
    writeFileSync(join(bin, "aide-record-test-run"), `#!/bin/sh\necho recorder >> '${marker}'\n`, { mode: 0o755 });
    const queue = new QueueStore({ mirrorPath: undefined, resolve: () => ({ specFolders: [] }),
      defaults: { model: {}, permissionMode: {}, timeoutSec: { default: 1200 } } });
    const job = queue.enqueue({ project: "p", specFolder: "land", steps: ["land"], branch: "feature" });
    if (!job.ok) throw new Error(job.error);
    const verdict = await createLandingGate(queue, bin)(root, job.job, "feature", "Land");
    expect(verdict.ok).toBe(true);
    expect(readFileSync(marker, "utf8").trim().split("\n")).toEqual(["resolver", "recorder"]);
  } finally {
    if (previousLog === undefined) delete process.env.AIDE_TEST_GATE_LOG; else process.env.AIDE_TEST_GATE_LOG = previousLog;
    rmSync(dir, { recursive: true, force: true });
  }
});
