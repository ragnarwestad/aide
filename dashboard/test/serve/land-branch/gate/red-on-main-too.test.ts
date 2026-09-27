// A landing whose tests are red twice runs them once more on the default
// branch alone, without the spec. Red there too, the failure is main's, and
// the sentence says so: a browser test broken on main stopped 548's archive
// as if 548 had broken it (2026-09-27).
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";

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
  const dir = mkdtempSync(join(tmpdir(), "aide-red-on-main-"));
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

/** A recorder red wherever `redWhen` holds for the tree it is run in. */
function recorder(redWhen: "always" | "with the spec"): void {
  const bin = mkdtempSync(join(tmpdir(), "aide-red-on-main-bin-"));
  dirs.push(bin);
  writeFileSync(join(bin, "resolve"), `#!/bin/sh\nprintf '{"ok":true,"commands":["true"]}\\n'\n`, { mode: 0o755 });
  const test = redWhen === "always" ? "exit 1" : '[ -f "$2/spec-change" ] && exit 1; exit 0';
  writeFileSync(join(bin, "record"), `#!/bin/sh\necho "(fail) a test"\n${test}\n`, { mode: 0o755 });
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
}

const job = { project: "aide", specFolder: "81-x" };

test("red on main as well: the sentence says the failure is not the spec's", async () => {
  const root = merged();
  recorder("always");
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/81-x");
  expect(verdict.ok).toBe(false);
  expect(verdict.error).toContain("red on main as well");
}, 30_000);

test("green on main: the sentence is the ordinary one, about this merge", async () => {
  const root = merged();
  recorder("with the spec");
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/81-x");
  expect(verdict.ok).toBe(false);
  expect(verdict.error).toContain("red on this merge");
  expect(verdict.error).not.toContain("red on main as well");
}, 30_000);
