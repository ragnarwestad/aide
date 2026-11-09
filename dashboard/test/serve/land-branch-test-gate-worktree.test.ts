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
import { timeoutVerdict } from "../../src/serve/land-branch/test-gate.ts";
import { runProjectSuiteBeforePush } from "../../src/serve/land-branch/test-gate.ts";
import { renderSentence } from "../../src/i18n/message.ts";
import { namingRecorder } from "../helpers/naming-recorder.ts";

/** What a reader would see: a message is stored as
 *  its key and the values that fill its blanks, and composed when
 *  the page is drawn. */
function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}


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
  test("a timeout names the last test that was running without blaming the machine (AC-6)", () => {
    const verdict = timeoutVerdict("running make test\n--- dashboard/test/slow.test.ts\n", 60, "Archive");
    expect(verdict.error).toEqual({
      key: "landing.testsTimedOut",
      values: { minutes: 60, test: "dashboard/test/slow.test.ts", button: "Archive" },
    });
    expect(sentence(verdict.error)).not.toContain("quieter");
  });

  test("a timeout recognises an ordinary runner test heading (AC-6)", () => {
    const verdict = timeoutVerdict("bun test v1\ndashboard/test/slow.test.ts:\n", 60, "Archive");
    expect(verdict.error).toEqual({
      key: "landing.testsTimedOut",
      values: { minutes: 60, test: "dashboard/test/slow.test.ts", button: "Archive" },
    });
  });

  test("a timed-out run keeps no list of failed tests (AC-7)", () => {
    const verdict = timeoutVerdict("(fail) a test\n--- dashboard/test/slow.test.ts\n", 60, "Archive");
    expect(verdict.failedTests).toBeUndefined();
  });

  test("runs the suite in a worktree of HEAD, with the links and the config, and removes it after", async () => {
    const root = project();
    const record = join(root, "..", `gate-record-${Date.now()}.txt`);
    dirs.push(record);
    fakeScripts(record);

    const verdict = await runProjectSuiteBeforePush(root, { project: "aide", specFolder: "81-x" }, "aide/81-x");
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

  // A landing merges in a worktree of its own, and the gate runs there:
  // `.venv`, `node_modules` and `.aide/config` are gitignored, so they
  // exist ONLY in the main checkout. Linked from the worktree they
  // linked nothing, and aide's own landing came back
  // "bash: .venv/bin/pytest: No such file or directory" — a red suite
  // that had nothing to do with the merge.
  test("run from a worktree, it still finds the checkout's own gitignored files", async () => {
    const root = project();
    const landing = join(root, "..", `landing-${Date.now()}`);
    dirs.push(landing);
    git(root, "worktree", "add", "--detach", "-q", landing, "HEAD");
    const record = join(root, "..", `gate-worktree-${Date.now()}.txt`);
    dirs.push(record);
    fakeScripts(record);

    const verdict = await runProjectSuiteBeforePush(landing, { project: "aide", specFolder: "81-x" }, "aide/81-x");
    expect(verdict.ok).toBe(true);

    const lines = readFileSync(record, "utf-8").trim().split("\n");
    expect(lines[1]).toBe("deps=installed");
    expect(lines[2]).toBe("config=AIDE_TEST_CMD=true");
  });

  // What the row shows is one sentence: what happened, the tests that
  // failed, and the one move that resolves it. The test output is for
  // whoever goes looking, so it belongs in the detail the row shows on
  // hover.
  test("a red suite names its failing tests on the row and keeps the output in the detail", async () => {
    const root = project();
    const record = join(root, "..", `gate-red-${Date.now()}.txt`);
    dirs.push(record);
    fakeScripts(record);
    // Red on the merge, both runs; green on main alone (the third run), so
    // the failure is this merge's.
    const runs = join(root, "..", `gate-red-runs-${Date.now()}.txt`);
    dirs.push(runs);
    writeFileSync(
      process.env.AIDE_RECORD_TEST_RUN_BIN!,
      namingRecorder(`echo run >> ${runs}\n[ $(wc -l < ${runs}) -gt 2 ] && exit 0\necho 'FAILED tests/test_x.py::test_x - assert 1 == 2'\nexit 1`),
      { mode: 0o755 },
    );

    const verdict = await runProjectSuiteBeforePush(root, { project: "aide", specFolder: "81-x" }, "aide/81-x");

    expect(verdict.ok).toBe(false);
    expect(verdict.error).toEqual({
      key: "landing.testsRedOnMerge",
      values: { count: 1, branch: "aide/81-x", button: "Archive" },
      lists: { tests: ["tests/test_x.py::test_x — assert 1 == 2"] },
    });
    // The same test failed on both runs and passes on main alone: nothing
    // supports a busy machine, so nothing says so.
    expect(sentence(verdict.error)).not.toContain("quieter");
    expect(verdict.detail).not.toContain("quieter");
    // No path to a file on the host, in the sentence or the detail.
    expect(sentence(verdict.error)).not.toContain(".log");
    expect(verdict.detail).not.toContain(".log");
    expect(verdict.detail).toContain("FAILED tests/test_x.py::test_x");
  });

  // A test that lost to a busy host passes the second time; a real
  // failure fails twice. The whole command is run again once, and the
  // lines the first run failed on travel with the green verdict.
  test("a suite red once and green on its retry lands, carrying what the first run failed on", async () => {
    const root = project();
    const record = join(root, "..", `gate-retry-${Date.now()}.txt`);
    dirs.push(record);
    fakeScripts(record);
    const count = join(root, "..", `gate-runs-${Date.now()}.txt`);
    dirs.push(count);
    writeFileSync(
      process.env.AIDE_RECORD_TEST_RUN_BIN!,
      `#!/bin/sh\necho run >> ${count}\n[ "$(wc -l < ${count})" -gt 1 ] && exit 0\necho '(fail) flaky > times out'\nexit 1\n`,
      { mode: 0o755 },
    );

    const verdict = await runProjectSuiteBeforePush(root, { project: "aide", specFolder: "81-x" }, "aide/81-x");

    expect(verdict.ok).toBe(true);
    expect(verdict.retriedAfter).toContain("(fail) flaky > times out");
    expect(readFileSync(count, "utf-8").trim().split("\n")).toHaveLength(2);
    expect(readFileSync(process.env.AIDE_TEST_GATE_LOG!, "utf-8")).toContain("(retry)");
  });

  test("a suite red twice stays red, and runs no third time on the merge", async () => {
    const root = project();
    const record = join(root, "..", `gate-red-twice-${Date.now()}.txt`);
    dirs.push(record);
    fakeScripts(record);
    const count = join(root, "..", `gate-runs-red-${Date.now()}.txt`);
    dirs.push(count);
    writeFileSync(process.env.AIDE_RECORD_TEST_RUN_BIN!, `#!/bin/sh\necho run >> ${count}\necho 'FAILED test_x'\nexit 1\n`, { mode: 0o755 });

    const verdict = await runProjectSuiteBeforePush(root, { project: "aide", specFolder: "81-x" }, "aide/81-x");

    expect(verdict.ok).toBe(false);
    expect(verdict.retriedAfter).toBeUndefined();
    // Twice on the merge, and once on main alone to ask whose failure it is.
    expect(readFileSync(count, "utf-8").trim().split("\n")).toHaveLength(3);
  });
});
