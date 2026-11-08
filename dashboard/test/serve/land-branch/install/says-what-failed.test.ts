// A failed install names its command, and keeps the end of what it printed,
// in whole lines, for the (?) behind the message.

import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installAfterMerge,
  type LandContext,
} from "../../../../src/serve/land-branch";
import type { RepoMergeResult } from "../../../../src/git/branch-merge/index.ts";
import { outputTail } from "../../../../src/format/output-tail.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ctx = { queueInstallTimeoutMs: undefined } as unknown as LandContext;

/** A checkout whose install command is `script`, written as a file. */
function checkout(script: string): { root: string; cmd: string } {
  const root = mkdtempSync(join(tmpdir(), "aide-install-says-"));
  dirs.push(root);
  mkdirSync(join(root, ".aide"), { recursive: true });
  const file = join(root, "install.sh");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  writeFileSync(join(root, ".aide", "config"), `AIDE_INSTALL_CMD=${file}\n`);
  return { root, cmd: file };
}

describe("an install that fails", () => {
  test("names its command and exit code, with its last lines of stderr as the detail", async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join(
      "\\n",
    );
    const { root, cmd } = checkout(`printf '${lines}\\n' >&2; exit 3`);
    const result: RepoMergeResult = { root, ok: true };
    await installAfterMerge(ctx, result);
    expect(result.installError).toEqual({
      key: "landing.installCommandFailed",
      values: { command: cmd, code: 3 },
    });
    expect(result.installDetail).toBe(
      Array.from({ length: 8 }, (_, i) => `line ${i + 5}`).join("\n"),
    );
  });

  test("falls back to stdout when it wrote nothing to stderr", async () => {
    const { root } = checkout(
      "echo 'npm ERR! missing script: install'; exit 1",
    );
    const result: RepoMergeResult = { root, ok: true };
    await installAfterMerge(ctx, result);
    expect(result.installDetail).toBe("npm ERR! missing script: install");
  });

  test("that cannot be started names its command, with the error as the detail", async () => {
    const root = mkdtempSync(join(tmpdir(), "aide-install-says-"));
    dirs.push(root);
    mkdirSync(join(root, ".aide"), { recursive: true });
    writeFileSync(
      join(root, ".aide", "config"),
      "AIDE_INSTALL_CMD=/no/such/install-program\n",
    );
    const result: RepoMergeResult = { root, ok: true };
    await installAfterMerge(ctx, result);
    expect(result.installError).toEqual({
      key: "landing.installCommandNotRun",
      values: { command: "/no/such/install-program" },
    });
    expect(result.installDetail).toBeTruthy();
  });
});

describe("outputTail", () => {
  test("keeps whole lines from the end, without colour codes, carriage returns or blank lines", () => {
    expect(outputTail("a\r\n\n\x1b[31mb\x1b[0m\rc\n", 2)).toBe("b\nc");
  });
});
