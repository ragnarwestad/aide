// Shared test data for "the dashboard works in checkouts of its own
// (spec 205)", split across checkout-write-safety.test.ts,
// checkout-freshness.test.ts and checkout-listing.test.ts (split out of
// checkout-and-render-safety.test.ts by theme). `git`, `realProject` and
// `recording` used to be closures inside one shared `describe` block;
// `checkoutSafetyHelpers` rebuilds that closure so each test file's own
// `ownDirs` tracker still catches everything `realProject` makes.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner, type GitRunner } from "../../src/git/branch-status.ts";
import { statusSaying } from "../helpers/queue-server.ts";

export function checkoutSafetyHelpers(ownDirs: string[]) {
  function git(cwd: string, ...args: string[]): string {
    const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
    return out.stdout.toString();
  }

  /** A projects root holding ONE real project — a bare origin, and a
   *  clone of it standing in for the checkout a person edits. The
   *  harness's own fixture is a plain directory, and this suite needs a
   *  repository with a remote to clone from. */
  function realProject(): { projectsRoot: string; person: string; owned: string; site: string } {
    const where = mkdtempSync(join(tmpdir(), "aide-205-"));
    ownDirs.push(where);
    const seed = join(where, "seed");
    mkdirSync(join(seed, ".aide"), { recursive: true });
    writeFileSync(join(seed, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(seed, "specs", "81-queue-and-runner"), { recursive: true });
    writeFileSync(join(seed, "specs", "81-queue-and-runner", "1-description.md"), "# Queue - Description\n\nAs it was.\n");
    writeFileSync(join(seed, "specs", "81-queue-and-runner", "4-status.md"), statusSaying(["create"]));
    git(seed, "init", "-q", "-b", "main");
    git(seed, "config", "user.name", "Test");
    git(seed, "config", "user.email", "test@example.com");
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", "first");
    const origin = join(where, "aide.git");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", seed, origin] });
    const projectsRoot = join(where, "root");
    mkdirSync(projectsRoot, { recursive: true });
    const person = join(projectsRoot, "aide");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, person] });
    git(person, "config", "user.name", "Test");
    git(person, "config", "user.email", "test@example.com");
    const site = join(where, "site");
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, "projects.html"), "<p>overview</p>");
    return { projectsRoot, person, owned: join(where, "owned"), site };
  }

  /** The real runner, wrapped so a test can say which directories the
   *  server ran git in. */
  function recording(): { run: GitRunner; calls: { dir: string; args: string[] }[] } {
    const real = createGitRunner();
    const calls: { dir: string; args: string[] }[] = [];
    return {
      calls,
      run: async (dir, args) => {
        calls.push({ dir, args });
        return real(dir, args);
      },
    };
  }

  return { git, realProject, recording };
}
