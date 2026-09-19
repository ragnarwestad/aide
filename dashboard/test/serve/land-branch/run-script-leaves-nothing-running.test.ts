// A landing's script leaves nothing running when it ends. The suite a
// landing runs starts boards and decoy servers of its own, and a test
// that timed out left them alive: they held the output pipes open and
// their ports taken, and the next landing's suite timed out on them
// (498, 2026-09-19).

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScript } from "../../../src/serve/land-branch/run-script.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("what the script left running is stopped, and its output still comes back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-run-script-"));
  dirs.push(dir);
  const script = join(dir, "leaves-a-server.sh");
  // The leftover keeps the script's stdout open, as a board started by a
  // suite does: a run that waited for the pipe to close never returned.
  writeFileSync(script, `#!/bin/bash\nsleep 300 &\necho $! > "${dir}/pid"\necho done\n`);
  const began = Date.now();
  const out = await runScript(["bash", script], dir, 30_000);
  expect(Date.now() - began).toBeLessThan(10_000);
  expect(out.code).toBe(0);
  expect(out.stdout).toContain("done");
  const pid = Number(readFileSync(join(dir, "pid"), "utf-8"));
  await Bun.sleep(200);
  expect(alive(pid)).toBe(false);
});
