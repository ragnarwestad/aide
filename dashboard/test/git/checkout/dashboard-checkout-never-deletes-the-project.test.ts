// The one line in this codebase that removed a project's files is gone.
// On 2026-09-21 woodstack's checkout was deleted and could not be cloned
// back: every row for the project lost its spec folder and showed a bare
// title with the wrong state.
//
// The delete assumed "nothing here is anyone's work — it is a clone, and
// what it was a clone of is still on origin". On a host whose projects
// root is the dashboard's own directory of links that is false:
// `cloneDestination` (`project-admin/add-project.ts`) clones into
// `checkouts/<project>/code` and links the projects root to it, so the
// person's checkout and the dashboard's are one directory. Deleting it
// took the `origin` url with it.
//
// The rule now: the dashboard clones only into a directory that is not
// there. Anything else is reported and left alone — a checkout git
// cannot answer for is a thing to look at, not a thing to repair on the
// board's own initiative.
//
// Real git, like the rest of this directory: what is under test is a
// checkout, a remote and a refusal.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardCheckoutRoot, ensureDashboardCheckout } from "../../../src/git/dashboard-checkout.ts";
import { createGitRunner } from "../../../src/git/branch-status.ts";

const run = createGitRunner();
const dirs: string[] = [];
const tmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

/** A bare origin with one commit, and a clone of it. */
function repoWithClone(where: string, name: string): { origin: string; clone: string } {
  const seed = join(where, `${name}-seed`);
  mkdirSync(seed, { recursive: true });
  writeFileSync(join(seed, "README.md"), `# ${name}\n`);
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.name", "Test");
  git(seed, "config", "user.email", "test@example.com");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  const origin = join(where, `${name}.git`);
  Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", seed, origin] });
  const clone = join(where, name);
  Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, clone] });
  return { origin, clone };
}

/** The layout this bug lived in: the clone IS the dashboard's checkout,
 *  and the projects root holds a link to it. `personDir` is that link. */
function linkedLayout(where: string, project: string): { base: string; personDir: string; code: string } {
  const base = join(where, "owned");
  const code = dashboardCheckoutRoot(base, project);
  const { clone } = repoWithClone(where, project);
  mkdirSync(join(base, project), { recursive: true });
  Bun.spawnSync({ cmd: ["mv", clone, code] });
  const projects = join(base, "projects");
  mkdirSync(projects, { recursive: true });
  const personDir = join(projects, project);
  symlinkSync(code, personDir);
  return { base, personDir, code };
}

/** What an interrupted clone leaves: a `.git` with no `HEAD`, which
 *  `existsSync` reads as done and git reads as no repository — the same
 *  answer a `rev-parse` that timed out under load gives. */
function unanswerable(dir: string): void {
  rmSync(join(dir, ".git", "HEAD"), { force: true });
}

describe("ensureDashboardCheckout clones only into a directory that is not there", () => {
  test("a checkout that IS the person's own is refused, and its files stay", async () => {
    const where = tmp("aide-nodelete-");
    const { base, personDir, code } = linkedLayout(where, "woodstack");
    unanswerable(code);

    const result = await ensureDashboardCheckout(run, { base, project: "woodstack", personDir, mayClone: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(code);
    // The whole point of the spec: the files are still there.
    expect(readFileSync(join(code, "README.md"), "utf-8")).toBe("# woodstack\n");
    // And the message does not send a reader off to delete the project.
    expect(result.error).not.toContain("remove it by hand");
  });

  test("a half-made checkout of the dashboard's own is reported, not replaced", async () => {
    const where = tmp("aide-nodelete-");
    const { clone } = repoWithClone(where, "aide");
    const base = join(where, "owned");
    const code = dashboardCheckoutRoot(base, "aide");
    mkdirSync(join(code, ".git", "objects"), { recursive: true });
    writeFileSync(join(code, "left-behind.txt"), "from the killed clone\n");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone, mayClone: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(code);
    expect(result.cloned).toBe(false);
    expect(existsSync(join(code, "left-behind.txt"))).toBe(true);
  });

  test("a checkout whose origin cannot be read is left where it is", async () => {
    const where = tmp("aide-nodelete-");
    const { clone } = repoWithClone(where, "aide");
    const base = join(where, "owned");
    git(clone, "remote", "remove", "origin");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone, mayClone: true });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no origin remote");
    // Nothing was made on the way to finding that out.
    expect(existsSync(dashboardCheckoutRoot(base, "aide"))).toBe(false);
  });

  // A clone belongs to a press. Every tick, boot and page render asks
  // without `mayClone`, and a checkout that is missing is reported to
  // them rather than made: Add makes a project's checkout, saving a
  // specs root makes the clone of the repository it names, and nothing
  // else clones at all.
  test("a tick is told the checkout is missing, and clones nothing", async () => {
    const where = tmp("aide-nodelete-");
    const { clone } = repoWithClone(where, "aide");
    const base = join(where, "owned");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(result.ok).toBe(false);
    expect(result.cloned).toBe(false);
    expect(result.error).toContain("added");
    expect(existsSync(dashboardCheckoutRoot(base, "aide"))).toBe(false);
  });

  test("the press that adds a project does clone it", async () => {
    const where = tmp("aide-nodelete-");
    const { clone } = repoWithClone(where, "aide");
    const base = join(where, "owned");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone, mayClone: true });

    expect(result.ok).toBe(true);
    expect(result.cloned).toBe(true);
    expect(readFileSync(join(result.checkout!.code, "README.md"), "utf-8")).toBe("# aide\n");
    expect(readdirSync(join(base, "aide"))).toEqual(["code"]);
  });
});
