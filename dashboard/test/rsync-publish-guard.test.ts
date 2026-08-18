// Spec 03, criterion 3. The publish script used to fall back to one
// operator's hostname when AIDE_DASH_HOST was unset, so a misconfigured
// run rsynced somewhere nobody asked for — with --delete. Off loudly is
// the only safe direction here.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * Runs the script against a throwaway checkout: the script `cd`s to its
 * own parent, so a copy in `<tmp>/deploy/` publishes `<tmp>/out/`. `ssh`
 * and `rsync` are shadowed the same way — a guard that only fails is
 * half the contract, the other half is that it lets a real site through.
 */
async function runWithOut(
  files: string[],
): Promise<{ code: number; stderr: string; called: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "aide-rsync-out-"));
  try {
    const bin = join(dir, "bin");
    const log = join(dir, "called.log");
    mkdirSync(bin);
    mkdirSync(join(dir, "deploy"));
    mkdirSync(join(dir, "out"));
    writeFileSync(join(dir, "deploy", "rsync-publish.sh"), readFileSync(SCRIPT, "utf-8"), { mode: 0o755 });
    for (const f of files) writeFileSync(join(dir, "out", f), "<p>x</p>");
    for (const name of ["ssh", "rsync"]) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> '${log}'\nexit 0\n`, { mode: 0o755 });
    }
    const proc = Bun.spawn({
      cmd: ["/bin/bash", join(dir, "deploy", "rsync-publish.sh")],
      env: { ...process.env, AIDE_DASH_HOST: "stub-host", PATH: `${bin}:${process.env.PATH}` },
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

// Spec 100: the sentinel the guard looks for has to be a file the
// generator actually writes. The overview moved to `projects.html` when
// `/` became the spec list — a guard still watching for `index.html`
// would refuse every publish from then on, and say "run make generate"
// to someone who just had.
describe("publishing an out/ that make generate produced", () => {
  test("a generated site is published, not refused", async () => {
    const { code, stderr, called } = await runWithOut(["projects.html", "about.html", "aide.html"]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(called).toContain("rsync");
  });

  test("an empty out/ is still refused before --delete can reach the host", async () => {
    const { code, stderr, called } = await runWithOut([]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("make generate");
    expect(called).toEqual([]);
  });
});
