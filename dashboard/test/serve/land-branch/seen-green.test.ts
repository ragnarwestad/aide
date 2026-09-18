// The landing skips its own run when the step it merges already saw the
// same commands green on the same tree — main has not moved since the
// archive's own run on the merged result (spec 480's archive ran the
// suite four times, 2026-09-18). Anything short of an exact match runs.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../src/serve/land-branch/test-gate.ts";
import type { StepResult } from "../../../src/queue/queue.ts";

const LIB = join(import.meta.dir, "..", "..", "..", "..", "core", "scripts", "_aide-spec-lib.sh");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.AIDE_RESOLVE_TEST_CMD_BIN;
  delete process.env.AIDE_RECORD_TEST_RUN_BIN;
  delete process.env.AIDE_TEST_GATE_LOG;
  delete process.env.AIDE_SPEC_LIB;
});

function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

/** A committed project linking `deps`, the way the gate meets one. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-seen-green-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".aide"), { recursive: true });
  writeFileSync(join(dir, ".aide", "project.yaml"), "name: aide\nworktreeLinks: deps\n");
  writeFileSync(join(dir, ".gitignore"), "deps/\n.aide/config\n");
  writeFileSync(join(dir, "README.md"), "# aide\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "first");
  mkdirSync(join(dir, "deps"));
  writeFileSync(join(dir, "deps", "marker"), "installed\n");
  return dir;
}

/** The tree the step would have reported, hashed by the same function. */
function hashOf(dir: string): string {
  const out = Bun.spawnSync({
    cmd: ["/bin/bash", "-c", 'source "$1" && aide_tree_hash "$2" deps', "_", LIB, dir],
    stdout: "pipe",
  });
  return out.stdout.toString().trim();
}

/** A resolver answering `true`, and a recorder that leaves a mark when
 *  it is run at all. */
function scripts(): { ran: string; log: string } {
  const bin = mkdtempSync(join(tmpdir(), "aide-seen-green-bin-"));
  dirs.push(bin);
  const ran = join(bin, "ran");
  writeFileSync(join(bin, "resolve"), '#!/bin/sh\nprintf \'{"ok":true,"commands":["true"]}\\n\'\n', { mode: 0o755 });
  writeFileSync(join(bin, "record"), `#!/bin/sh\necho ran > ${ran}\n`, { mode: 0o755 });
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
  process.env.AIDE_SPEC_LIB = LIB;
  return { ran, log: join(bin, "gate.log") };
}

const job = (testedGreen?: StepResult["testedGreen"]) => ({
  project: "aide",
  specFolder: "81-x",
  results: [
    { step: "archive", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", ...(testedGreen ? { testedGreen } : {}) },
  ] as StepResult[],
});

describe("the landing skips a run a step has already made", () => {
  test("the same commands green on the same tree: nothing is run, and the log says why", async () => {
    const root = project();
    const { ran, log } = scripts();

    const verdict = await runProjectSuiteBeforePush(root, job({ tree: hashOf(root), commands: ["true"] }), "aide/81-x");

    expect(verdict.ok).toBe(true);
    expect(existsSync(ran)).toBe(false);
    expect(readFileSync(log, "utf-8")).toContain("not run: the step already saw true green on this tree");
  });

  test("another tree — main moved since the step's run — runs as before", async () => {
    const root = project();
    const { ran } = scripts();

    await runProjectSuiteBeforePush(root, job({ tree: "0".repeat(40), commands: ["true"] }), "aide/81-x");

    expect(existsSync(ran)).toBe(true);
  });

  test("other commands on the same tree run as before", async () => {
    const root = project();
    const { ran } = scripts();

    await runProjectSuiteBeforePush(root, job({ tree: hashOf(root), commands: ["make test"] }), "aide/81-x");

    expect(existsSync(ran)).toBe(true);
  });

  test("a step that reported nothing green runs as before", async () => {
    const root = project();
    const { ran } = scripts();

    await runProjectSuiteBeforePush(root, job(), "aide/81-x");

    expect(existsSync(ran)).toBe(true);
  });
});
