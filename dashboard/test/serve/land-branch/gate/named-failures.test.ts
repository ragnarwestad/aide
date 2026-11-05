// A merge red twice and green on main alone names the tests that failed.
// The same tests on both runs are the merge's doing; different tests on the
// two runs point at unstable tests or a busy machine, and only then does
// the sentence say so.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failingLines, runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";

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

/** main, and the merge checked out on top of it carrying the spec's change. */
function merged(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-named-failures-"));
  dirs.push(dir);
  writeFileSync(join(dir, "README.md"), "# p\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "main");
  git(dir, "switch", "-q", "-c", "merge");
  writeFileSync(join(dir, "spec-change"), "x\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "the spec");
  return dir;
}

/** A recorder green on main alone, and red on the merge with the tests
 *  `first` names on its first run and `second` on its second. */
function recorder(first: string, second: string): void {
  const bin = mkdtempSync(join(tmpdir(), "aide-named-failures-bin-"));
  dirs.push(bin);
  writeFileSync(join(bin, "resolve"), `#!/bin/sh\nprintf '{"ok":true,"commands":["true"]}\\n'\n`, { mode: 0o755 });
  const runs = join(bin, "runs");
  writeFileSync(
    join(bin, "record"),
    `#!/bin/sh\n[ -f "$2/spec-change" ] || exit 0\necho run >> ${runs}\n` +
      `if [ "$(wc -l < ${runs})" -eq 1 ]; then ${first ? `echo 'FAILED t/test_a.py::${first} - first error'` : "echo 'error: command stopped before naming a test'"}; else echo 'FAILED t/test_a.py::${second} - second error'; fi\n` +
      `echo '{"ok":true,"exitCode":1,"terminalReason":"recorded"}'\nexit 1\n`,
    { mode: 0o755 },
  );
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
}

const job = { project: "aide", specFolder: "81-x" };

test("the same test on both runs is named with its latest error (AC-2)", async () => {
  recorder("test_one", "test_one");
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x");
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMerge",
    values: { tests: "t/test_a.py::test_one — second error", branch: "aide/81-x", button: "Archive" },
  });
}, 30_000);

test("a test shared by both runs is the merge's even when the first run named another test (AC-3)", async () => {
  recorder("test_one - first error'; echo 'FAILED t/test_a.py::test_two", "test_one");
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x");
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMerge",
    values: { tests: "t/test_a.py::test_one — second error", branch: "aide/81-x", button: "Archive" },
  });
}, 30_000);

test("an unnamed first run does not claim that a named failure repeated (AC-5)", async () => {
  recorder("", "test_one");
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x");
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMergeUnnamed",
    values: { branch: "aide/81-x", button: "Archive" },
  });
}, 30_000);

test("different tests on the two runs: both named, and the sentence points at a busy machine", async () => {
  recorder("test_one", "test_two");
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x");
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMergeVaried",
    values: { tests: "t/test_a.py::test_one — first error; t/test_a.py::test_two — second error", branch: "aide/81-x", button: "Archive" },
  });
}, 30_000);

test("a repeated failure stays the merge's when the retry adds another failure (AC-3)", async () => {
  recorder("test_one", "test_one - second error'; echo 'FAILED t/test_a.py::test_two");
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x");
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMerge",
    values: { tests: "t/test_a.py::test_one — second error", branch: "aide/81-x", button: "Archive" },
  });
}, 30_000);

describe("failingLines", () => {
  test("the recorder's own answer is not a line the tests said", () => {
    expect(failingLines('noise\n{"ok":true,"exitCode":1}\n', "")).toBe("noise");
  });

  test("a cut tail starts at a line, never inside a word", () => {
    const out = failingLines(`${"word ".repeat(30)}\nmake sure the database is reachable\n`, "", 50);
    expect(out).toBe("make sure the database is reachable");
  });
});
