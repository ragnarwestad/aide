// The landing's test run is told how many workers it may use: the host's cores
// divided among the steps and landings running as it starts, so a landing
// leaves the other cores to the specs running beside it.

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
  test("is given the cores divided among the running steps and landings (AC-1)", async () => {
    const root = mkdtempSync(join(tmpdir(), "aide-gate-workers-"));
    dirs.push(root);
    mkdirSync(join(root, ".aide"));
    writeFileSync(join(root, ".aide", "project.yaml"), "name: demo\nAIDE_TEST_CMD: make it\n");
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
    const seen = join(bin, "env.txt");
    writeFileSync(
      join(bin, "record"),
      `#!/bin/sh\necho "$AIDE_TEST_WORKERS" > ${seen}\n`,
      { mode: 0o755 },
    );
    process.env.AIDE_RESOLVE_TEST_CMD_BIN = RESOLVER;
    process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
    process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");

    // The landing itself and one running job fewer than the host has cores:
    // every core is spoken for, so the run gets one worker.
    const jobs = () => [
      { state: "done", landing: true },
      ...Array.from({ length: availableParallelism() - 1 }, () => ({ state: "running", landing: false })),
    ] as { state: "running" | "done"; landing: boolean }[];
    const verdict = await runProjectSuiteBeforePush(root, { project: "demo", specFolder: "1-x" }, "aide/1-x", { jobs });
    expect(verdict.ok).toBe(true);
    expect(readFileSync(seen, "utf-8").trim()).toBe("1");
  });
});
