// A test server's log holds both of its streams whole: the worktree
// setup's output goes to stderr before the start line goes to stdout,
// and two opens of one file wrote each over the other's lines.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnTestServer } from "../../../src/serve/setup/test-servers.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test("stderr written before stdout is kept whole in the log (AC-4)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-board-log-"));
  dirs.push(dir);
  const log = join(dir, "board.log");
  spawnTestServer(["/bin/sh", "-c", "echo 'worktree setup: installing-deps' >&2; sleep 0.2; echo 'board up: pid 1, http://x'"], log);
  for (let i = 0; i < 100 && !readFileSync(log, "utf-8").includes("http://x"); i++) await Bun.sleep(50);
  expect(readFileSync(log, "utf-8")).toBe("worktree setup: installing-deps\nboard up: pid 1, http://x\n");
});
