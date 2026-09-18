// A script is started through its own interpreter, so macOS's check of
// a freshly written executable is never paid (10-13 s per new file).

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptArgv } from "../../src/integrations/script-argv.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function file(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-script-argv-"));
  dirs.push(dir);
  const path = join(dir, "s");
  writeFileSync(path, text, { mode: 0o644 });
  return path;
}

describe("a script's argv", () => {
  test("puts the shebang's interpreter in front", () => {
    const s = file("#!/bin/sh\necho hi\n");
    expect(scriptArgv([s, "--x", "1"])).toEqual(["/bin/sh", s, "--x", "1"]);
  });

  test("keeps the one argument the kernel would pass it", () => {
    const s = file("#!/usr/bin/env bash\necho hi\n");
    expect(scriptArgv([s])).toEqual(["/usr/bin/env", "bash", s]);
  });

  test("runs a script that is not even executable, so no exec of the file itself is needed", async () => {
    const s = file("#!/bin/sh\necho \"$1\"\n");
    const proc = Bun.spawn({ cmd: scriptArgv([s, "ran"]), stdout: "pipe" });
    expect((await new Response(proc.stdout).text()).trim()).toBe("ran");
  });

  test("finds a bare name on the PATH it is given, and reads that file", () => {
    const s = file("#!/bin/sh\necho hi\n");
    chmodSync(s, 0o755);
    const dir = join(s, "..");
    expect(scriptArgv(["s", "--x"], dir)).toEqual(["/bin/sh", s, "--x"]);
  });

  test("leaves a binary, an unknown name and a missing path alone", () => {
    expect(scriptArgv(["/bin/sh", "-c", "true"])).toEqual(["/bin/sh", "-c", "true"]);
    expect(scriptArgv(["no-such-command-anywhere"], "/usr/bin:/bin")).toEqual(["no-such-command-anywhere"]);
    expect(scriptArgv(["/no/such/file"])).toEqual(["/no/such/file"]);
  });
});
