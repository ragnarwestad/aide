// Spec 512: the landing gate's tree is cut from the merge commit, which
// carries tracked files only. A project whose manifest is not tracked
// keeps its settings in an untracked copy, and a tree without it finds no
// test command — "nothing to run is not red", so a landing merged
// untested and said nothing.
//
// The rule is the runner's, stated once in tests/fixtures/manifest-carry.json
// and tested on the bash side by test_aide_run_spec_manifest.py.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../src/serve/land-branch/test-gate.ts";

const ROWS = JSON.parse(readFileSync(join(import.meta.dir, "../../../../tests/fixtures/manifest-carry.json"), "utf-8"))
  .rows as { name: string; sourceHasManifest: boolean; trackedInTree: boolean; copied: boolean }[];
const RESOLVER = join(import.meta.dir, "../../../../core/scripts/aide-resolve-test-cmd");
const MANIFEST = "name: demo\ntestCmd: make it\nworktreeLinks: deps\n";

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

/** A project in the state one row of the table names, with a gitignored
 *  `deps/` the manifest links. Returns what the recorder saw, if it ran. */
async function gate(row: (typeof ROWS)[number]): Promise<{ ran: boolean; manifest: string; deps: string }> {
  const root = mkdtempSync(join(tmpdir(), "aide-gate-manifest-"));
  dirs.push(root);
  writeFileSync(join(root, ".gitignore"), "deps/\n.aide/config\n");
  writeFileSync(join(root, "README.md"), "# demo\n");
  mkdirSync(join(root, ".aide"));
  if (row.sourceHasManifest && row.trackedInTree) writeFileSync(join(root, ".aide", "project.yaml"), MANIFEST);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "first");
  if (row.sourceHasManifest && !row.trackedInTree) writeFileSync(join(root, ".aide", "project.yaml"), MANIFEST);
  mkdirSync(join(root, "deps"));
  writeFileSync(join(root, "deps", "marker"), "installed\n");

  const bin = mkdtempSync(join(tmpdir(), "aide-gate-manifest-bin-"));
  dirs.push(bin);
  const record = join(bin, "record.txt");
  writeFileSync(
    join(bin, "record"),
    "#!/bin/sh\n" +
      'while [ $# -gt 0 ]; do [ "$1" = "--project-dir" ] && dir="$2"; shift; done\n' +
      `{ echo "manifest=$(tr '\\n' ' ' < "$dir/.aide/project.yaml")"; echo "deps=$(cat "$dir/deps/marker" 2>/dev/null)"; } > ${record}\n`,
    { mode: 0o755 },
  );
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = RESOLVER;
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");

  const verdict = await runProjectSuiteBeforePush(root, { project: "demo", specFolder: "1-x" }, "aide/1-x");
  expect(verdict.ok).toBe(true);
  if (!existsSync(record)) return { ran: false, manifest: "", deps: "" };
  const lines = readFileSync(record, "utf-8").trim().split("\n");
  return { ran: true, manifest: lines[0]!.replace("manifest=", "").trim(), deps: lines[1]!.replace("deps=", "") };
}

describe("the landing gate carries the manifest by the rule in the table", () => {
  for (const row of ROWS) {
    test(`${row.name} (AC-5)`, async () => {
      const seen = await gate(row);
      // A manifest in the tree, tracked or copied, gives the gate its
      // command and its links; without one there is nothing to run.
      expect(seen.ran).toBe(row.sourceHasManifest);
      if (row.sourceHasManifest) {
        expect(seen.manifest).toContain("testCmd: make it");
        expect(seen.deps).toBe("installed");
      }
    });
  }
});
