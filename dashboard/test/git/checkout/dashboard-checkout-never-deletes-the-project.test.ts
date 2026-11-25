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

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dashboardCheckoutRoot, ensureDashboardCheckout } from "../../../src/git/dashboard-checkout.ts";
import { createGitRunner, type GitRunner } from "../../../src/git/process/index.ts";
import { configValue } from "../../../src/project/discover";
import { checkoutTemps, git, repoWithClone } from "./checkout-fixtures.ts";

const run = createGitRunner();
const tmp = checkoutTemps();

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
 *  `existsSync` reads as done and git reads as no repository. */
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

// A `rev-parse` the runner's timer cut off is no answer at all. Under load
// on the serving host both attempts were killed, and the board said the
// project's own checkout was "not a copy" — of a checkout that answered
// every git command a moment later. A check that did not finish is said
// as such, and nothing is decided from it.

const TOPLEVEL = "rev-parse --show-toplevel";

/** The real runner, except that the `rev-parse --show-toplevel` calls
 *  `stall` picks — by directory and by how many times that directory has
 *  been asked — come back as a call the runner's timer stopped. Every
 *  call is recorded. */
function stalling(stall: (dir: string, attempt: number) => boolean) {
  const calls: { dir: string; args: string[] }[] = [];
  const asked = new Map<string, number>();
  let on = true;
  const runner: GitRunner = async (dir, args, timeoutMs, env) => {
    calls.push({ dir, args });
    if (args.join(" ") === TOPLEVEL) {
      const n = asked.get(dir) ?? 0;
      asked.set(dir, n + 1);
      if (on && stall(dir, n)) return { code: 143, stdout: "", stderr: "", unfinished: "timed-out" as const };
    }
    return run(dir, args, timeoutMs, env);
  };
  return { run: runner, calls, release: () => { on = false; } };
}

/** A working dashboard checkout of its own, made by the press that adds
 *  the project, beside the person's clone. */
async function separateLayout(where: string, project: string) {
  const { clone } = repoWithClone(where, project);
  const base = join(where, "owned");
  const made = await ensureDashboardCheckout(run, { base, project, personDir: clone, mayClone: true });
  expect(made.ok).toBe(true);
  return { base, personDir: clone, code: dashboardCheckoutRoot(base, project) };
}

const INVALID_WORDS = ["not a copy", "remove it by hand", "not a checkout git can answer for", "in no git repository"];

describe("a check git did not finish is not known, not broken", () => {
  test("two timed-out attempts on the project's own checkout say not known (AC-1)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code } = linkedLayout(where, "woodstack");
    const git = stalling((dir) => dir === code);

    const result = await ensureDashboardCheckout(git.run, { base, project: "woodstack", personDir });

    expect(result.ok).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.error).toContain(code);
    for (const words of INVALID_WORDS) expect(result.error).not.toContain(words);
  });

  test("two timed-out attempts on a separate checkout say not known (AC-1)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code } = await separateLayout(where, "aide");
    const git = stalling((dir) => dir === code);

    const result = await ensureDashboardCheckout(git.run, { base, project: "aide", personDir });

    expect(result.inconclusive).toBe(true);
    for (const words of INVALID_WORDS) expect(result.error).not.toContain(words);
  });

  test("one timed-out attempt and one finished no is still not known (AC-1)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code } = linkedLayout(where, "woodstack");
    unanswerable(code);
    const git = stalling((dir, attempt) => dir === code && attempt === 0);

    const result = await ensureDashboardCheckout(git.run, { base, project: "woodstack", personDir });

    expect(result.ok).toBe(false);
    expect(result.inconclusive).toBe(true);
  });

  test("the detail names the check, the directory and how it ended (AC-2)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code } = linkedLayout(where, "woodstack");
    const git = stalling((dir) => dir === code);

    const result = await ensureDashboardCheckout(git.run, { base, project: "woodstack", personDir });

    expect(result.detail).toContain("git rev-parse --show-toplevel");
    expect(result.detail).toContain(code);
    expect(result.detail).toContain("did not answer in time");
  });

  test("a check git finished keeps git's exit code and its own words (AC-2)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code } = await separateLayout(where, "aide");
    unanswerable(code);

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir });

    expect(result.detail).toContain("git rev-parse --show-toplevel");
    expect(result.detail).toContain("exit 128");
    expect(result.detail).toContain("not a git repository");
  });

  test("git saying no on the project's own checkout keeps its refusal, unmarked (AC-5)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code } = linkedLayout(where, "woodstack");
    unanswerable(code);

    const result = await ensureDashboardCheckout(run, { base, project: "woodstack", personDir });

    expect(result.ok).toBe(false);
    expect(result.inconclusive).toBeUndefined();
    expect(result.error).toContain("not a copy");
    expect(result.error).toContain("git rev-parse --show-toplevel");
  });

  test("git saying no on a separate checkout keeps its refusal, unmarked (AC-5)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code } = await separateLayout(where, "aide");
    unanswerable(code);

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir });

    expect(result.ok).toBe(false);
    expect(result.inconclusive).toBeUndefined();
    expect(result.error).toContain("remove it by hand");
    expect(result.error).toContain("git rev-parse --show-toplevel");
  });

  test("a press under load asks git nothing but the check, and every file stays (AC-6)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code } = await separateLayout(where, "aide");
    const before = readdirSync(code).sort();
    const git = stalling((dir) => dir === code);

    const result = await ensureDashboardCheckout(git.run, { base, project: "aide", personDir, mayClone: true });

    expect(result.inconclusive).toBe(true);
    expect(git.calls.map((c) => c.args.join(" "))).toEqual([TOPLEVEL, TOPLEVEL]);
    expect(readdirSync(code).sort()).toEqual(before);
    expect(readFileSync(join(code, "README.md"), "utf-8")).toBe("# aide\n");
  });
});

describe("a specs-root question git did not finish", () => {
  /** Specs inside the project's own repository: one clone, and the
   *  dashboard's config names the specs folder inside it. */
  async function specsInsideLayout(where: string) {
    const { clone } = repoWithClone(where, "aide");
    const personSpecs = join(clone, "specs");
    mkdirSync(join(personSpecs, "archive"), { recursive: true });
    mkdirSync(join(clone, ".aide"), { recursive: true });
    writeFileSync(join(clone, ".aide", "config"), `AIDE_SPECS_PATH=${personSpecs}\n`);
    const base = join(where, "owned");
    const made = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone, mayClone: true });
    expect(made.ok).toBe(true);
    const code = dashboardCheckoutRoot(base, "aide");
    return { base, personDir: clone, personSpecs, code, specsPath: configValue(code, "AIDE_SPECS_PATH") };
  }

  test("for the specs root is not known, not \"in no git repository\" (AC-1)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, personSpecs } = await specsInsideLayout(where);
    const git = stalling((dir) => dir === personSpecs);

    const result = await ensureDashboardCheckout(git.run, { base, project: "aide", personDir });

    expect(result.ok).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.error).not.toContain("in no git repository");
  });

  test("for the person's checkout under a press clones no second specs repository (AC-1, AC-6)", async () => {
    const where = tmp("aide-unfinished-");
    const { base, personDir, code, specsPath } = await specsInsideLayout(where);
    const git = stalling((dir) => dir === personDir);

    const result = await ensureDashboardCheckout(git.run, { base, project: "aide", personDir, mayClone: true });

    expect(result.ok).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(git.calls.some((c) => c.args.includes("clone"))).toBe(false);
    expect(existsSync(join(base, "aide", "specs"))).toBe(false);
    expect(configValue(code, "AIDE_SPECS_PATH")).toBe(specsPath);
  });
});
