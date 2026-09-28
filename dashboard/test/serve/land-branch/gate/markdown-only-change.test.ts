// A landing whose change touches Markdown files alone runs the project's
// documentation check, not its whole suite — the same answer the step's
// own run got from aide-resolve-test-cmd --changed-from.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** The commands the landing handed its test run, for a branch that
 *  changes the files named. */
async function commandsRunFor(files: Record<string, string>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "aide-gate-docs-"));
  dirs.push(root);
  mkdirSync(join(root, ".aide"));
  writeFileSync(join(root, ".aide", "project.yaml"), "name: demo\nAIDE_TEST_CMD: make it\n");
  writeFileSync(join(root, "README.md"), "# demo\n");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "check-docs"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(root, "scripts", "check-docs"), 0o755);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "first");
  git(root, "switch", "-q", "-c", "aide/1-x");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "the spec's change");

  const bin = mkdtempSync(join(tmpdir(), "aide-gate-docs-bin-"));
  dirs.push(bin);
  const seen = join(bin, "seen.txt");
  writeFileSync(
    join(bin, "record"),
    "#!/bin/sh\n" + `while [ $# -gt 0 ]; do [ "$1" = "--cmd" ] && echo "$2" >> ${seen}; shift; done\n`,
    { mode: 0o755 },
  );
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = RESOLVER;
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");

  const verdict = await runProjectSuiteBeforePush(root, { project: "demo", specFolder: "1-x" }, "aide/1-x");
  expect(verdict.ok).toBe(true);
  return existsSync(seen) ? readFileSync(seen, "utf-8").trim() : "";
}

describe("a landing tests a Markdown-only change with the documentation check", () => {
  test("only Markdown changed: the documentation check runs, not the suite", async () => {
    expect(await commandsRunFor({ "README.md": "# demo, reworded\n", "NOTES.md": "new\n" })).toBe("scripts/check-docs");
  });

  test("anything else changed too: the project's test command runs", async () => {
    expect(await commandsRunFor({ "README.md": "# demo, reworded\n", "app.py": "print(1)\n" })).toBe("make it");
  });
});
