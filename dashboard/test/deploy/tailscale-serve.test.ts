// Spec 172: the dashboard is reached over HTTPS, and `tailscale serve` is
// part of the deploy rather than something someone ran once by hand.
//
// Two things have to hold, and neither shows up as a failure on the
// machine that runs `make install-serve` — only as a dashboard nobody can
// reach. The proxy has to be configured at all, and it can only ever
// reach a server bound to `127.0.0.1`: pointed at the host's own tailnet
// address, tailscaled hangs for 75 seconds and answers 502 (measured
// 2026-08-21, spec 172's description). So a `BIND` that is anything else
// must stop the deploy, not produce a proxy rule that cannot work.
//
// Asserted against `make -n`, the real recipe expansion, like
// `install-serve-paths.test.ts`. That technique is why the guard is a
// Makefile-level `ifeq` and not a shell `if`: `make -n` expands variables
// but never runs a shell, so a shell conditional would put BOTH branches
// in the dry-run text no matter what `BIND` is.
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_SERVER_PORTS } from "../../src/serve/test-servers/lifecycle.ts";

const ROOT = join(import.meta.dir, "..", "..");

// A COPY of the Makefile, in a directory with no `.env.deploy` — the
// shipped defaults are what these criteria are about, and an operator
// whose own file sets BIND must not change the answer.
function dryRunInstallServe(vars: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-mk-tailscale-"));
  try {
    const mk = join(dir, "Makefile");
    copyFileSync(join(ROOT, "Makefile"), mk);
    const res = Bun.spawnSync(
      [
        "make", "-f", mk, "-n", "install-serve", "MINI=example-host",
        ...Object.entries(vars).map(([name, value]) => `${name}=${value}`),
      ],
      { cwd: dir },
    );
    return new TextDecoder().decode(res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("install-serve puts TLS in front of the dashboard", () => {
  test("BIND=127.0.0.1 configures the proxy at the default port", () => {
    const recipe = dryRunInstallServe({ BIND: "127.0.0.1" });

    expect(recipe).toContain("tailscale serve --bg --https 443 http://127.0.0.1:8788");
  });

  test("TS_PORT moves the proxy off 443", () => {
    const recipe = dryRunInstallServe({ BIND: "127.0.0.1", TS_PORT: "8443" });

    expect(recipe).toContain("--https 8443 http://127.0.0.1:8788");
    expect(recipe).not.toContain("--https 443 ");
  });

  test("a host with no tailscale still gets the ordinary deploy", () => {
    const recipe = dryRunInstallServe({ BIND: "127.0.0.1" });

    // Absence is informational, never fatal: the probe decides, and the
    // step that runs when it finds nothing is an echo, not an exit.
    //
    // The probe is `test -x <path>`, NOT `command -v` (2026-08-22).
    // `ssh host 'cmd'` runs a non-interactive shell, which on macOS
    // reads none of the login files that put /usr/local/bin on PATH —
    // so the lookup answered "no" on the host this was written for, the
    // deploy reported the plain install, and no TLS was set up at all.
    expect(recipe).toContain("test -x /usr/local/bin/tailscale");
    expect(recipe).not.toContain("command -v tailscale");
    expect(recipe).toContain("no tailscale at /usr/local/bin/tailscale on example-host");
  });

  // A host that keeps the binary elsewhere says so rather than being
  // told it has none.
  test("the path is a variable, and the probe and the call use the same one", () => {
    const recipe = dryRunInstallServe({ BIND: "127.0.0.1", TAILSCALE: "/opt/homebrew/bin/tailscale" });

    expect(recipe).toContain("test -x /opt/homebrew/bin/tailscale");
    expect(recipe).toContain("/opt/homebrew/bin/tailscale serve --bg");
    expect(recipe).not.toContain("/usr/local/bin/tailscale");
  });
});

describe("install-serve puts the test boards behind the proxy too", () => {
  // A test board started from the dashboard takes a port from the pool,
  // and one that no proxy rule covers answers on the host alone.
  test("every port in the test-server pool gets its own rule", () => {
    const recipe = dryRunInstallServe({ BIND: "127.0.0.1" });

    expect(recipe).toContain(`for p in ${TEST_SERVER_PORTS.join(" ")}; do`);
    expect(recipe).toContain("tailscale serve --bg --https $p http://127.0.0.1:$p");
  });
});

describe("install-serve gives a fresh host a projects root", () => {
  test("with no ROOT, the directory of links is made and the aide checkout linked into it", () => {
    const recipe = dryRunInstallServe({ BIND: "127.0.0.1" });

    expect(recipe).toContain('--root "$home/.aide/dashboard/projects"');
    expect(recipe).toContain(
      'ln -s "$HOME/.aide/dashboard/checkouts/aide/code" .aide/dashboard/projects/aide',
    );
  });

  test("a ROOT that is set is passed as it is, and nothing is linked", () => {
    const recipe = dryRunInstallServe({ BIND: "127.0.0.1", ROOT: "/srv/projects" });

    expect(recipe).toContain('--root "/srv/projects"');
    expect(recipe).not.toContain("ln -s");
  });
});

describe("install-serve refuses a BIND the proxy cannot reach", () => {
  // A fresh install has no .env.deploy, so the default is what it gets:
  // it must be the one value the proxy can reach.
  test("the shipped default is 127.0.0.1, and is proxied", () => {
    const recipe = dryRunInstallServe();

    expect(recipe).toContain('--bind "127.0.0.1"');
    expect(recipe).toContain("tailscale serve --bg --https 443 http://127.0.0.1:8788");
  });

  test("BIND set empty is refused, not proxied", () => {
    const recipe = dryRunInstallServe({ BIND: "" });

    expect(recipe).toContain("BIND is ''");
    expect(recipe).not.toContain("tailscale serve --bg");
  });

  test("the old tailnet-address style of BIND is refused too", () => {
    const recipe = dryRunInstallServe({ BIND: "100.64.0.1" });

    expect(recipe).toContain("BIND is '100.64.0.1'");
    expect(recipe).not.toContain("tailscale serve --bg");
  });

  test("the refusal says what to set, and where", () => {
    const recipe = dryRunInstallServe({ BIND: "0.0.0.0" });

    expect(recipe).toContain("BIND=127.0.0.1");
    expect(recipe).toContain(".env.deploy");
  });
});
