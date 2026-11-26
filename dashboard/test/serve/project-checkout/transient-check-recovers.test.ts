// A checkout check that git did not finish leaves a warning, said at the
// top of the page once the checkout has gone unanswered long enough, and
// the next check that succeeds takes it away — with no job
// queued and no restart, because under load the very same checkout
// answers again a moment later.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupProjectResolution } from "../../../src/serve/setup/project-resolution.ts";
import { createServerState } from "../../../src/serve/state.ts";
import { checkoutFaults, checkoutsToRecheck, clearCheckoutFaults } from "../../../src/render/ui/checkout-faults.ts";
import { UNANSWERED_FOR_MS } from "../../../src/render/ui/faults/unanswered.ts";
import { dashboardCheckoutRoot, ensureDashboardCheckout } from "../../../src/git/dashboard-checkout/index.ts";
import { createGitRunner, type GitRunner } from "../../../src/git/process/index.ts";
import type { ScheduleStore } from "../../../src/queue/schedule-store.ts";

const real = createGitRunner();
const dirs: string[] = [];
afterEach(() => {
  clearCheckoutFaults();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
}

/** A project with an origin, the person's clone under a projects root,
 *  and the dashboard's own checkout already made. */
async function project(where: string) {
  const seed = join(where, "seed");
  mkdirSync(seed, { recursive: true });
  await Bun.write(join(seed, "README.md"), "# aide\n");
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.name", "Test");
  git(seed, "config", "user.email", "test@example.com");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  const origin = join(where, "aide.git");
  git(where, "clone", "-q", "--bare", seed, origin);
  const projects = join(where, "projects");
  mkdirSync(projects, { recursive: true });
  git(projects, "clone", "-q", origin, "aide");
  const base = join(where, "owned");
  const made = await ensureDashboardCheckout(real, { base, project: "aide", personDir: join(projects, "aide"), mayClone: true });
  expect(made.ok).toBe(true);
  return { projects, base, code: dashboardCheckoutRoot(base, "aide") };
}

test("a later check that succeeds clears the warning a timed-out one left (AC-3)", async () => {
  const where = mkdtempSync(join(tmpdir(), "aide-transient-check-"));
  dirs.push(where);
  const { projects, base, code } = await project(where);
  let loaded = true;
  const gitRun: GitRunner = async (dir, args, timeoutMs, env) => {
    if (loaded && dir === code && args.join(" ") === "rev-parse --show-toplevel") {
      return { code: 143, stdout: "", stderr: "", unfinished: "timed-out" };
    }
    return real(dir, args, timeoutMs, env);
  };
  const state = createServerState();
  const resolution = setupProjectResolution(
    { dashboardCheckoutRoot: base, queueProjectRoot: projects, gitRun },
    new Set(["aide"]),
    state,
    {} as ScheduleStore,
  );

  const later = () => Date.now() + UNANSWERED_FOR_MS;

  await resolution.ensureCheckout("aide", { fresh: true });
  expect(checkoutsToRecheck()).toEqual(["aide"]);
  expect(checkoutFaults(later())).toEqual([expect.objectContaining({ project: "aide", recheck: true })]);

  loaded = false;
  await resolution.ensureCheckout("aide");
  expect(checkoutsToRecheck()).toEqual([]);
  expect(checkoutFaults(later())).toEqual([]);
});
