// The dashboard installs the same way on the machine it is run on
// (`install.sh`, `make install-local`) as on another one over ssh
// (`make install-serve`): one recipe, with only the way it reaches the
// host swapped. And both check the host's prerequisites before they
// change anything there.
//
// Asserted against `make -n`, the real recipe expansion, like
// `install-serve-paths.test.ts`.
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

  // The server serves about.html and the per-project pages but never
  // writes them; without this a fresh install links to a 404.
  test("it writes the generated pages into the site the server serves", () => {
    expect(recipe).toContain(
      'run src/main.ts generate --root "$HOME/.aide/dashboard/projects" --out "$HOME/.aide/dashboard/site"',
    );
  });

  test("it keeps install-serve's steps: the service's own checkout, and the wait before bootstrap", () => {
    expect(recipe).toContain("git -C .aide/dashboard/checkouts/aide/code pull");
    expect(recipe).toContain("is still loaded after 10s");
    expect(recipe).toContain("launchctl bootstrap gui/$(id -u) Library/LaunchAgents/com.aide-dashboard.serve.plist");
  });
});

// HTTPS through Tailscale is an add-on the user sets up by hand
// (docs/hosting.md); an install never changes a machine's tailnet.
describe("neither install touches Tailscale", () => {
  test.each([["install-serve", ["MINI=example-host"]], ["install-local", []]])("%s", (target, vars) => {
    expect(dryRun(target, ...vars).toLowerCase()).not.toContain("tailscale");
  });
});

describe("install-serve gives a fresh host a projects root", () => {
  test("with no ROOT, the directory of links is made and the aide checkout linked into it", () => {
    const recipe = dryRun("install-serve", "MINI=example-host");

    expect(recipe).toContain('--root "$home/.aide/dashboard/projects"');
    expect(recipe).toContain('ln -s "$HOME/.aide/dashboard/checkouts/aide/code" .aide/dashboard/projects/aide');
  });

  test("a ROOT that is set is passed as it is, and nothing is linked", () => {
    const recipe = dryRun("install-serve", "MINI=example-host", "ROOT=/srv/projects");

    expect(recipe).toContain('--root "/srv/projects"');
    expect(recipe).not.toContain("ln -s");
  });

  test("the server binds localhost unless told otherwise", () => {
    expect(dryRun("install-serve", "MINI=example-host")).toContain('--bind "127.0.0.1"');
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

  // launchctl is a function handed down to the script, answering with the
  // exit code asked for: a test cannot log a user in or out.
  function check(home: string, launchctlExit = 0): { code: number; err: string } {
    const res = Bun.spawnSync(["bash", CHECK, BUN], {
      cwd: home,
      env: {
        HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin",
        "BASH_FUNC_launchctl%%": `() { return ${launchctlExit}; }`,
      },
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

  test("a user who has never logged in on the screen is refused, and told to", () => {
    const home = join(scratch, "no-login");
    mkdirSync(home);
    const { code, err } = check(home, 1);

    expect(code).toBe(1);
    expect(err).toContain("missing: a login session for");
    expect(err).toContain("on this machine's screen once");
  });

  test("a user with no git identity is warned, not refused", () => {
    const home = join(scratch, "no-git-identity");
    mkdirSync(home);
    const { err } = check(home);

    expect(err).toContain("warning: git has no user.email");
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

describe("install.sh on a machine with no launchd", () => {
  test("it installs nothing and points to serve.sh", () => {
    const empty = mkdtempSync(join(tmpdir(), "aide-no-launchd-"));
    try {
      const res = Bun.spawnSync(["/bin/bash", join(ROOT, "install.sh")], { env: { PATH: empty, HOME: empty } });
      expect(res.exitCode).toBe(1);
      expect(new TextDecoder().decode(res.stderr)).toContain("dashboard/serve.sh");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
