// The landing's test gate runs the suite in a throwaway worktree of the
// merge commit, never in the live checkout: a run's own git and a
// fast-forward of main moved that checkout under a running suite once
// (2026-09-03), and tests on disk changed while the code they import was
// already loaded. The worktree carries the project's worktreeLinks and
// its .aide/config, and is gone when the gate is over.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../src/serve/land-branch/test-gate.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.AIDE_RESOLVE_TEST_CMD_BIN;
  delete process.env.AIDE_RECORD_TEST_RUN_BIN;
  delete process.env.AIDE_TEST_GATE_LOG;
});

function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

/** A committed project whose manifest links `deps/` and whose config
 *  carries a test command, with a gitignored `deps/` directory. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-gate-tree-"));
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
  writeFileSync(join(dir, ".aide", "config"), "AIDE_TEST_CMD=true\n");
  return dir;
}

/** Fake resolver and recorder: the recorder writes where it ran and
 *  what it saw there. */
function fakeScripts(record: string): void {
  const bin = mkdtempSync(join(tmpdir(), "aide-gate-bin-"));
  dirs.push(bin);
  writeFileSync(join(bin, "resolve"), '#!/bin/sh\nprintf \'{"ok":true,"commands":["true"]}\\n\'\n', { mode: 0o755 });
  writeFileSync(
    join(bin, "record"),
    "#!/bin/sh\n" +
      'while [ $# -gt 0 ]; do [ "$1" = "--project-dir" ] && dir="$2"; shift; done\n' +
      `{ echo "dir=$dir"; echo "deps=$(cat "$dir/deps/marker" 2>/dev/null)"; echo "config=$(cat "$dir/.aide/config" 2>/dev/null)"; git -C "$dir" rev-parse HEAD; } > ${record}\n`,
    { mode: 0o755 },
  );
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
}

describe("the landing's test gate", () => {
  test("runs the suite in a worktree of HEAD, with the links and the config, and removes it after", async () => {
    const root = project();
    const record = join(root, "..", `gate-record-${Date.now()}.txt`);
    dirs.push(record);
    fakeScripts(record);

    const verdict = await runProjectSuiteBeforePush(root, { project: "aide", specFolder: "81-x" });
    expect(verdict.ok).toBe(true);

    const lines = readFileSync(record, "utf-8").trim().split("\n");
    const ranIn = lines[0]!.replace("dir=", "");
    expect(ranIn).not.toBe(root);
    expect(lines[1]).toBe("deps=installed");
    expect(lines[2]).toBe("config=AIDE_TEST_CMD=true");
    expect(lines[3]).toBe(git(root, "rev-parse", "HEAD").trim());
    expect(existsSync(ranIn)).toBe(false);
    expect(git(root, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });

  // What the row shows is one sentence: what happened, and the one move
  // that resolves it. The log's path, the caveat about a timing test
  // that lost to a busy host, and the test output are for whoever goes
  // looking, so they belong in the detail the row shows on hover — a row
  // that carries all four reads as four different instructions.
  test("a red suite says one thing on the row and keeps the rest in the detail", async () => {
    const root = project();
    const record = join(root, "..", `gate-red-${Date.now()}.txt`);
    dirs.push(record);
    fakeScripts(record);
    // The recorder exits non-zero: a red suite, as far as the gate is
    // concerned.
    writeFileSync(process.env.AIDE_RECORD_TEST_RUN_BIN!, "#!/bin/sh\necho 'FAILED test_x'\nexit 1\n", { mode: 0o755 });

    const verdict = await runProjectSuiteBeforePush(root, { project: "aide", specFolder: "81-x" });

    expect(verdict.ok).toBe(false);
    expect(verdict.error).toBe(
      "the project's tests are red on this merge, so nothing was pushed. " +
        "The gate log names the failing test; archive lands the work once it passes.",
    );
    // Nothing here knows that a second implement run would turn the
    // suite green: it starts from the same description and plan, and is
    // never told which test failed. The sentence says what is known.
    expect(verdict.error).not.toContain("run implement again");
    expect(verdict.error).not.toContain(".log");
    expect(verdict.error).not.toContain("quieter");
    expect(verdict.detail).toContain(".log");
    expect(verdict.detail).toContain("quieter");
  });
});
