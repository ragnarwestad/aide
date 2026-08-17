// The dashboard's source used to BE a git repo root; since spec 85 it is
// a subdirectory of the aide repo. `install-serve` used one variable for
// two things that were identical back then and are not anymore: the repo
// to clone/pull, and the directory bun runs in. Get that wrong and
// nothing fails loudly — the launchd job on the serving host just keeps
// running yesterday's code from a path that no longer receives commits.
//
// Asserted against `make -n`, the real recipe expansion, rather than the
// Makefile's text: what matters is the command that would run.
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// Expand the recipe from a COPY of the Makefile, in a directory with no
// `.env.deploy` — the shipped defaults are what these criteria are
// about, and a developer whose own machine keeps its checkout somewhere
// else must not fail this test.
function dryRunInstallServe(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-mk-paths-"));
  try {
    const mk = join(dir, "Makefile");
    copyFileSync(join(ROOT, "Makefile"), mk);
    const res = Bun.spawnSync(["make", "-f", mk, "-n", "install-serve", "MINI=example-host"], {
      cwd: dir,
    });
    return new TextDecoder().decode(res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("install-serve deploys from the aide checkout, not a standalone one", () => {
  const recipe = dryRunInstallServe();

  test("clone-or-pull targets the repo root, one level above the source", () => {
    expect(recipe).toContain("git -C develop/aide pull");
    expect(recipe).toContain("git clone -q");
    expect(recipe).toContain("develop/aide;");
  });

  test("bun install runs in the dashboard subdirectory of that checkout", () => {
    expect(recipe).toContain("cd develop/aide/dashboard &&");
  });

  test("the rendered plist points at the nested source", () => {
    expect(recipe).toContain('--script "$home/develop/aide/dashboard/src/serve.ts"');
    expect(recipe).toContain('--working-directory "$home/develop/aide/dashboard"');
  });

  // The single guard that catches a half-finished edit: any path still
  // spelled the old way. Deliberately narrow — `aide-dashboard` on its
  // own is still legitimate as the launchd label, the state directory
  // and the log path, none of which are source paths.
  test("no path is left pointing at a standalone aide-dashboard checkout", () => {
    expect(recipe).not.toContain("develop/aide-dashboard");
  });
});
