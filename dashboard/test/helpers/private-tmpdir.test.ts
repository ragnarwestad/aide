// The preload beside this file (bunfig.toml) gives every `bun test`
// process a temp directory of its own and removes it on exit, so a test
// that leaves its directory behind no longer leaves it in the machine's
// shared temp directory for good.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const DASHBOARD = join(import.meta.dir, "..", "..");

describe("a test process keeps its temp directories inside its own", () => {
  test("tmpdir() is a directory made for this test process", () => {
    expect(basename(tmpdir())).toStartWith("aide-bun-test-");
    expect(existsSync(tmpdir())).toBe(true);
  });

  test("that directory is removed when the process exits, whatever a test left in it", () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-"));
    const probe = join(dir, "leaves-a-directory.test.ts");
    writeFileSync(probe,
      'import { test } from "bun:test";\n' +
      'import { mkdtempSync } from "node:fs";\n' +
      'import { tmpdir } from "node:os";\n' +
      'import { join } from "node:path";\n' +
      'test("leaks", () => { mkdtempSync(join(tmpdir(), "left-behind-")); console.log("TMP=" + tmpdir()); });\n');
    const r = Bun.spawnSync(["bun", "test", probe], { cwd: DASHBOARD, env: process.env });
    const own = /TMP=(\S+)/.exec(r.stdout.toString() + r.stderr.toString())?.[1] ?? "";
    expect(basename(own)).toStartWith("aide-bun-test-");
    expect(existsSync(own)).toBe(false);
  });
});
