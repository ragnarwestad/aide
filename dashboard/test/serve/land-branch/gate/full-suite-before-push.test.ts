// Land and Archive resolve the tests the way Implement does: what the branch
// changed beyond the default branch picks the command.

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
async function commandsRunFor(files: Record<string, string>, manifest = "", withOrigin = false): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "aide-gate-docs-"));
  dirs.push(root);
  mkdirSync(join(root, ".aide"));
  writeFileSync(join(root, ".aide", "project.yaml"), `name: demo\nAIDE_TEST_CMD: make it\n${manifest}`);
  writeFileSync(join(root, "README.md"), "# demo\n");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "check-docs"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(root, "scripts", "check-docs"), 0o755);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "first");
  if (withOrigin) {
    const origin = mkdtempSync(join(tmpdir(), "aide-gate-docs-origin-"));
    dirs.push(origin);
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", origin);
    git(root, "push", "-q", "origin", "main");
    git(root, "fetch", "-q", "origin");
  }
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

  const verdict = await runProjectSuiteBeforePush(root, { project: "demo", specFolder: "1-x" }, "aide/1-x", { button: "Archive" });
  expect(verdict.ok).toBe(true);
  return existsSync(seen) ? readFileSync(seen, "utf-8").trim() : "";
}

describe("a landing picks its tests from what the branch changed", () => {
  test("Markdown-only changes run the documentation check", async () => {
    expect(await commandsRunFor({ "README.md": "# demo, reworded\n", "NOTES.md": "new\n" })).toBe("scripts/check-docs");
  });

  test("the project's changed-code command gets the default branch to compare with", async () => {
    expect(await commandsRunFor({ "app.py": "print(1)\n" }, "AIDE_TEST_CHANGED_CMD: make changed\n"))
      .toBe("make changed 'main'");
  });

  test("with an origin, the landing names the default branch as Implement does", async () => {
    expect(await commandsRunFor({ "app.py": "print(1)\n" }, "AIDE_TEST_CHANGED_CMD: make changed\n", true))
      .toBe("make changed 'origin/main'");
  });

  test("without a changed-code command the project's whole test command runs", async () => {
    expect(await commandsRunFor({ "README.md": "# demo, reworded\n", "app.py": "print(1)\n" })).toBe("make it");
  });
});
