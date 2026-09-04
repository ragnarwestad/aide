// spec 355 (REQ-4): runAideWriteSpec spawns a real, stubbed
// `aide-write-spec` binary and pipes content to it on stdin — the same
// "a fake proves the shape, a real spawn proves it can execute" split
// `branch-file.test.ts` already uses for `writeStatusToBranch`.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAideWriteSpec } from "../../../src/git/run-aide-write-spec.ts";

const dirs: string[] = [];
const own = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

afterEach(() => {
  delete process.env.AIDE_WRITE_SPEC_BIN;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function stubBin(dir: string, script: string): string {
  const bin = join(dir, "fake-aide-write-spec");
  writeFileSync(bin, `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
  return bin;
}

/** A JSON line, written via a quoted heredoc so bash's own quoting
 *  rules never have to be threaded through a JS template literal. */
const printLine = (json: unknown): string => `cat <<'EOF'\n${JSON.stringify(json)}\nEOF`;

describe("runAideWriteSpec", () => {
  // launchd's PATH has no ~/.local/bin. With no AIDE_WRITE_SPEC_BIN set,
  // the installed copy under $HOME is what runs — the bare name found
  // nothing on the serving host, and every Checks-tab tick was refused.
  test("falls back to ~/.local/bin/aide-write-spec when no override is set", async () => {
    const home = own("aide-write-spec-home-");
    const bin = join(home, ".local", "bin");
    Bun.spawnSync({ cmd: ["mkdir", "-p", bin] });
    const marker = join(home, "ran-from-home");
    writeFileSync(
      join(bin, "aide-write-spec"),
      `#!/usr/bin/env bash\ntouch "${marker}"\n${printLine({ ok: true })}\n`,
      { mode: 0o755 },
    );
    // Other files set the override for their own runs and bun keeps one
    // process across files: clear it here, or this test measures theirs.
    const oldHome = process.env.HOME;
    const oldBin = process.env.AIDE_WRITE_SPEC_BIN;
    delete process.env.AIDE_WRITE_SPEC_BIN;
    process.env.HOME = home;
    try {
      const res = await runAideWriteSpec("81-x", "4-status.md", "# x\n");
      expect(res.ok).toBe(true);
      expect(existsSync(marker)).toBe(true);
    } finally {
      process.env.HOME = oldHome;
      if (oldBin !== undefined) process.env.AIDE_WRITE_SPEC_BIN = oldBin;
    }
  });

  test("returns ok and the derived stateJson on a successful run", async () => {
    const dir = own("aide-run-write-spec-");
    const bin = stubBin(
      dir,
      `cat > /dev/null\n${printLine({
        ok: true, exitCode: 0, terminalReason: "written",
        stateJson: JSON.stringify({ completedPhases: ["create"] }),
      })}`,
    );
    process.env.AIDE_WRITE_SPEC_BIN = bin;
    const result = await runAideWriteSpec("42-x", "4-status.md", "content\n");
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stateJson!)).toEqual({ completedPhases: ["create"] });
  });

  test("passes the content through on stdin", async () => {
    const dir = own("aide-run-write-spec-stdin-");
    const captured = join(dir, "captured");
    const bin = stubBin(
      dir,
      `cat > ${captured}\n${printLine({ ok: true, exitCode: 0, terminalReason: "written" })}`,
    );
    process.env.AIDE_WRITE_SPEC_BIN = bin;
    await runAideWriteSpec("42-x", "4-status.md", "the real content\n");
    expect(Bun.file(captured).text()).resolves.toBe("the real content\n");
  });

  test("returns ok:false when the script refuses", async () => {
    const dir = own("aide-run-write-spec-refuse-");
    const bin = stubBin(
      dir,
      `cat > /dev/null\n${printLine({
        ok: false, exitCode: 2, terminalReason: "refused", error: "spec file not found",
      })}\nexit 2`,
    );
    process.env.AIDE_WRITE_SPEC_BIN = bin;
    const result = await runAideWriteSpec("42-x", "4-status.md", "content\n");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("spec file not found");
  });

  test("returns ok:false, never throws, when the binary cannot be found at all", async () => {
    process.env.AIDE_WRITE_SPEC_BIN = "/no/such/binary/aide-write-spec";
    const result = await runAideWriteSpec("42-x", "4-status.md", "content\n");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("returns ok:false when the output is not a JSON line", async () => {
    const dir = own("aide-run-write-spec-garbage-");
    const bin = stubBin(dir, `cat > /dev/null\nprintf 'not json\\n'`);
    process.env.AIDE_WRITE_SPEC_BIN = bin;
    const result = await runAideWriteSpec("42-x", "4-status.md", "content\n");
    expect(result.ok).toBe(false);
  });
});
