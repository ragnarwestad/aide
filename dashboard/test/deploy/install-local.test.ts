// The dashboard installs the same way on the machine it is run on
// (`install.sh`, `make install-local`) as on another one over ssh
// (`make install-serve`): one recipe, with only the way it reaches the
// host swapped. And both check the host's prerequisites before they
// change anything there.
//
// Asserted against `make -n`, the real recipe expansion, like
// `tailscale-serve.test.ts`.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const CHECK = join(ROOT, "deploy", "check-prerequisites.sh");
const BUN = ".local/share/mise/shims/bun";

// A COPY of the Makefile, in a directory with no `.env.deploy`.
function dryRun(...args: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-mk-local-"));
  try {
    const mk = join(dir, "Makefile");
    copyFileSync(join(ROOT, "Makefile"), mk);
    const res = Bun.spawnSync(["make", "-f", mk, "-n", ...args], { cwd: dir });
    return new TextDecoder().decode(res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("install-local is install-serve on this machine", () => {
  const recipe = dryRun("install-local");

  test("nothing goes over ssh", () => {
    expect(recipe).not.toContain("ssh ");
    expect(recipe).not.toContain("scp ");
  });

  test("the plist lands in this machine's LaunchAgents", () => {
    expect(recipe).toContain('cp "$plist" "$HOME/Library/LaunchAgents/com.aide-dashboard.serve.plist"');
  });

  test("it keeps install-serve's steps: the service's own checkout, and the wait before bootstrap", () => {
    expect(recipe).toContain("git -C .aide/dashboard/checkouts/aide/code pull");
    expect(recipe).toContain("is still loaded after 10s");
    expect(recipe).toContain("launchctl bootstrap gui/$(id -u) Library/LaunchAgents/com.aide-dashboard.serve.plist");
  });
});

describe("both installs check the host before changing it", () => {
  test.each([
    ["install-serve", ["MINI=example-host"], "ssh example-host 'bash -s -- "],
    ["install-local", [], "cd && /bin/sh -c 'bash -s -- "],
  ])("%s runs the check on the host, first", (target, vars, prefix) => {
    const recipe = dryRun(target, ...vars);
    const check = recipe.indexOf(`${prefix}${BUN}' < "`);

    expect(check).toBeGreaterThan(-1);
    expect(recipe.indexOf("git clone -q")).toBeGreaterThan(check);
  });
});

describe("check-prerequisites.sh", () => {
  const scratch = mkdtempSync(join(tmpdir(), "aide-prereq-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function check(home: string): { code: number; err: string } {
    const res = Bun.spawnSync(["bash", CHECK, BUN], {
      cwd: home,
      env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    return { code: res.exitCode, err: new TextDecoder().decode(res.stderr) };
  }

  test("a host without Aide is refused, and told to install it first", () => {
    const home = join(scratch, "bare");
    mkdirSync(home);
    const { code, err } = check(home);

    expect(code).toBe(1);
    expect(err).toContain("missing: Aide (~/.local/bin/aide-run-spec)");
    expect(err).toContain("./install-all.sh");
  });

  test("a host with Aide and its bun passes", () => {
    const home = join(scratch, "ready");
    for (const file of [".local/bin/aide-run-spec", BUN]) {
      const path = join(home, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "#!/bin/sh\n");
      chmodSync(path, 0o755);
    }
    const { code, err } = check(home);

    expect(err).not.toContain("missing:");
    expect(code).toBe(0);
  });
});
