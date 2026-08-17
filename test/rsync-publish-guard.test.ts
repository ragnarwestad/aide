// Spec 03, criterion 3. The publish script used to fall back to one
// operator's hostname when AIDE_DASH_HOST was unset, so a misconfigured
// run rsynced somewhere nobody asked for — with --delete. Off loudly is
// the only safe direction here.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "deploy", "rsync-publish.sh");

/**
 * Runs the script with AIDE_DASH_HOST removed. `ssh` and `rsync` are
 * shadowed by stubs that record being called: the point is not only
 * that the script fails, but that it fails BEFORE touching a host.
 */
async function runWithoutHost(): Promise<{ code: number; stderr: string; called: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "aide-rsync-guard-"));
  try {
    const bin = join(dir, "bin");
    const log = join(dir, "called.log");
    mkdirSync(bin);
    for (const name of ["ssh", "rsync"]) {
      const stub = join(bin, name);
      writeFileSync(stub, `#!/bin/sh\necho ${name} >> '${log}'\nexit 0\n`, { mode: 0o755 });
    }
    const { AIDE_DASH_HOST: _drop, ...env } = process.env;
    const proc = Bun.spawn({
      cmd: ["/bin/bash", SCRIPT],
      env: { ...env, PATH: `${bin}:${process.env.PATH}` },
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    const called = Bun.file(log).size > 0 ? (await Bun.file(log).text()).trim().split("\n") : [];
    return { code, stderr, called };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("publishing without a target host", () => {
  test("fails, says which variable is missing, and reaches no host", async () => {
    const { code, stderr, called } = await runWithoutHost();
    expect(code).not.toBe(0);
    expect(stderr).toContain("AIDE_DASH_HOST");
    expect(called).toEqual([]);
  });
});
