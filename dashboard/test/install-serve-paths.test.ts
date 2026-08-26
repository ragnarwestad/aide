// The dashboard's source used to BE a git repo root; since spec 85 it is
// a subdirectory of the aide repo. `install-serve` used one variable for
// two things that were identical back then and are not anymore: the repo
// to clone/pull, and the directory bun runs in. Get that wrong and
// nothing fails loudly — the launchd job on the serving host just keeps
// running yesterday's code from a path that no longer receives commits.
//
// Since spec 223 that repo is the MACHINERY's checkout, not a person's:
// a landing merges and installs in `~/aide-dashboard-checkouts/aide/code`
// (spec 205) and then restarts the launchd job, so the job has to be
// executing from that same directory or it reloads the old code.
//
// Asserted against `make -n`, the real recipe expansion, rather than the
// Makefile's text: what matters is the command that would run.
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DEFAULT_DASHBOARD_CHECKOUT_ROOT, dashboardCheckoutRoot } from "../src/git/dashboard-checkout.ts";

const ROOT = join(import.meta.dir, "..");

// Expand a recipe from a COPY of the Makefile, in a directory with no
// `.env.deploy` — the shipped defaults are what these criteria are
// about, and a developer whose own machine keeps its checkout somewhere
// else must not fail this test.
function dryRun(...args: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-mk-paths-"));
  try {
    const mk = join(dir, "Makefile");
    copyFileSync(join(ROOT, "Makefile"), mk);
    const res = Bun.spawnSync(["make", "-f", mk, "-n", ...args], { cwd: dir });
    return new TextDecoder().decode(res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("install-serve deploys from the machinery's checkout, not a person's", () => {
  const recipe = dryRun("install-serve", "MINI=example-host");

  test("clone-or-pull targets the repo root, one level above the source", () => {
    expect(recipe).toContain("git -C aide-dashboard-checkouts/aide/code pull");
    expect(recipe).toContain("git clone -q");
    expect(recipe).toContain("aide-dashboard-checkouts/aide/code;");
  });

  test("bun install runs in the dashboard subdirectory of that checkout", () => {
    expect(recipe).toContain("cd aide-dashboard-checkouts/aide/code/dashboard &&");
  });

  test("the rendered plist points at the nested source", () => {
    expect(recipe).toContain(
      '--script "$home/aide-dashboard-checkouts/aide/code/dashboard/src/serve.ts"',
    );
    expect(recipe).toContain(
      '--working-directory "$home/aide-dashboard-checkouts/aide/code/dashboard"',
    );
  });

  // The single guard that catches a half-finished edit: any path still
  // spelled the old way. Deliberately narrow — `aide-dashboard` on its
  // own is still legitimate as the launchd label, the state directory
  // and the log path, none of which are source paths.
  test("no path is left pointing at a standalone aide-dashboard checkout", () => {
    expect(recipe).not.toContain("develop/aide-dashboard");
  });

  // Spec 223's own regression: the service must not read from a
  // directory a person edits. `develop/` is where every such checkout on
  // these machines lives, and nothing in this recipe has a reason to
  // name one.
  test("no path names a person's own checkout", () => {
    expect(recipe).not.toContain("develop/");
  });

  // The seventh hand-paired pair (.claude/rules/development.md): the
  // Makefile spells the machinery checkout's path as a bash literal
  // relative to the serving host's $HOME, and `dashboard-checkout.ts`
  // spells the same path in TypeScript. Nothing but this test makes them
  // agree.
  test("the Makefile's checkout path is the one dashboard-checkout.ts resolves", () => {
    const fromCode = relative(homedir(), dashboardCheckoutRoot(DEFAULT_DASHBOARD_CHECKOUT_ROOT, "aide"));
    expect(fromCode).toBe("aide-dashboard-checkouts/aide/code");
    expect(recipe).toContain(`git -C ${fromCode} pull`);
    expect(recipe).toContain(`--working-directory "$home/${fromCode}/dashboard"`);
  });
});

// The laptop path: one machine, no second host. Spec 223 repointed what
// the SERVICE runs from, and this target must not have come along —
// `serve-local` runs the checkout it is invoked in, which is the whole
// point of it.
describe("serve-local still runs from the checkout it is invoked in", () => {
  const recipe = dryRun("serve-local");

  test("it serves straight from this checkout", () => {
    expect(recipe).toContain("bun run src/serve.ts serve --site out --port 8788");
  });

  test("no second host, no clone, no launchd", () => {
    expect(recipe).not.toContain("ssh ");
    expect(recipe).not.toContain("git clone");
    expect(recipe).not.toContain("git -C ");
    expect(recipe).not.toContain("render-plist.ts");
    expect(recipe).not.toContain("launchctl");
    expect(recipe).not.toContain("aide-dashboard-checkouts");
  });
});
