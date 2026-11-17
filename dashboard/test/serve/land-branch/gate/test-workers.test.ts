// Land uses the same live-recorder capacity calculation as Implement.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";

const RESOLVER = join(import.meta.dir, "../../../../../core/scripts/aide-resolve-test-cmd");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.AIDE_RESOLVE_TEST_CMD_BIN;
  delete process.env.AIDE_RECORD_TEST_RUN_BIN;
  delete process.env.AIDE_TEST_GATE_LOG;
});

function git(cwd: string, ...args: string[]): void {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
}

describe("the landing's test run", () => {
  test("shares cores with live test recorders, ignoring AI jobs", async () => {
    const root = mkdtempSync(join(tmpdir(), "aide-gate-workers-"));
    dirs.push(root);
    mkdirSync(join(root, ".aide"));
    writeFileSync(join(root, ".aide", "project.yaml"), `name: demo\nAIDE_TEST_CMD: printf '%s' "$AIDE_TEST_WORKERS" > "${join(root, "workers.txt")}"\n`);
    writeFileSync(join(root, "app.py"), "print(0)\n");
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.name", "Test");
    git(root, "config", "user.email", "test@example.com");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "first");
    git(root, "switch", "-q", "-c", "aide/1-x");
    writeFileSync(join(root, "app.py"), "print(1)\n");
    git(root, "commit", "-qam", "the spec's change");

    const bin = mkdtempSync(join(tmpdir(), "aide-gate-workers-bin-"));
    dirs.push(bin);
    const seen = join(root, "workers.txt");
    process.env.AIDE_RESOLVE_TEST_CMD_BIN = RESOLVER;
    process.env.AIDE_RECORD_TEST_RUN_BIN = join(import.meta.dir, "../../../../../core/scripts/aide-record-test-run");
    process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");

    const queueMirrorPath = join(bin, "queue.json");
    writeFileSync(queueMirrorPath, JSON.stringify(Array.from({ length: 10 }, () => ({ state: "running" }))));
    const options = { queueMirrorPath, button: "Archive" };
    const first = await runProjectSuiteBeforePush(root, { project: "demo", specFolder: "1-x" }, "aide/1-x", options);
    expect(first.ok).toBe(true);
    expect(readFileSync(seen, "utf-8").trim()).toBe(String(availableParallelism()));
    const activity = `${queueMirrorPath}.test-runs`;
    writeFileSync(join(activity, `run.${process.pid}`), "");
    const shared = await runProjectSuiteBeforePush(root, { project: "demo", specFolder: "1-x" }, "aide/1-x", options);
    expect(shared.ok).toBe(true);
    expect(readFileSync(seen, "utf-8").trim()).toBe(String(Math.max(1, Math.floor(availableParallelism() / 2))));

  });
});
