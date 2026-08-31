// Spec 291: reading and writing a spec file on a branch WITHOUT ever
// checking it out — the mechanism the Overview page's Checks section
// needs so it can show and tick an active spec's real, already-committed
// progress before that work reaches `main` (see 2-analysis.md's own
// "The mechanism REQ-4 needs").
//
// Two suites, per plan review's Feasibility finding: a fake `GitRunner`
// proves the argument SHAPE, and a real-repo suite (this codebase's own
// `dashboard-checkout-clone-and-reuse.test.ts` pattern) proves real git
// actually accepts the sequence — a fake accepts any argv regardless of
// whether the real spawn call could execute it.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { createGitRunner } from "../../src/git/branch-status.ts";
import { readStatusFromBranch, writeStatusToBranch } from "../../src/git/branch-file.ts";

const BRANCH = "aide/291-example-spec";
const REL_PATH = "aide/291-example-spec/4-status.md";

describe("readStatusFromBranch (fake GitRunner)", () => {
  const fake = (answers: Record<string, { code: number; stdout?: string }>): GitRunner => {
    return async (_dir, args) => {
      const line = args.join(" ");
      for (const [prefix, answer] of Object.entries(answers)) {
        if (line.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
      }
      return { code: 1, stdout: "" };
    };
  };

  test("returns the branch's own text and the commit that last touched it", async () => {
    const run = fake({
      "fetch --quiet origin": { code: 0 },
      "log -1 --format=%H refs/remotes/origin/": { code: 0, stdout: "deadbeef1234\n" },
      "show refs/remotes/origin/": { code: 0, stdout: "# Status\n\nreal branch content\n" },
    });
    const result = await readStatusFromBranch(run, "/root", BRANCH, REL_PATH);
    expect(result).toEqual({ text: "# Status\n\nreal branch content\n", sha: "deadbeef1234" });
  });

  test("a branch origin does not have any more is null", async () => {
    const run = fake({ "fetch --quiet origin": { code: 128 } });
    expect(await readStatusFromBranch(run, "/root", BRANCH, REL_PATH)).toBeNull();
  });

  test("a path with no history on that branch is null", async () => {
    const run = fake({
      "fetch --quiet origin": { code: 0 },
      "log -1 --format=%H refs/remotes/origin/": { code: 0, stdout: "" },
    });
    expect(await readStatusFromBranch(run, "/root", BRANCH, REL_PATH)).toBeNull();
  });
});

describe("writeStatusToBranch (fake GitRunner)", () => {
  const recording = (answers: Record<string, { code: number; stdout?: string }>) => {
    const calls: { args: string[]; env?: Record<string, string> }[] = [];
    const run: GitRunner = async (_dir, args, _timeoutMs, env) => {
      calls.push({ args, env });
      const line = args.join(" ");
      for (const [prefix, answer] of Object.entries(answers)) {
        if (line.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
      }
      return { code: 1, stdout: "" };
    };
    return { run, calls };
  };

  const HAPPY_PATH = {
    "fetch --quiet origin": { code: 0 },
    "rev-parse tip1234567^{tree}": { code: 0, stdout: "tiptree1234\n" },
    "rev-parse refs/remotes/origin/": { code: 0, stdout: "tip1234567\n" },
    "log -1 --format=%H refs/remotes/origin/": { code: 0, stdout: "based0n1234\n" },
    "hash-object -w": { code: 0, stdout: "newblob1234\n" },
    "read-tree": { code: 0 },
    "update-index": { code: 0 },
    "write-tree": { code: 0, stdout: "newtree1234\n" },
    "commit-tree": { code: 0, stdout: "newcommit1234\n" },
    push: { code: 0 },
  };

  test("the happy path pushes a new commit onto the branch, non-force", async () => {
    const { run, calls } = recording(HAPPY_PATH);
    const result = await writeStatusToBranch(
      run,
      "/root",
      BRANCH,
      REL_PATH,
      "new content\n",
      "based0n1234",
      "tick a row",
    );
    expect(result.ok).toBe(true);
    const push = calls.find((c) => c.args[0] === "push");
    expect(push?.args).toContain(`newcommit1234:refs/heads/${BRANCH}`);
    expect(push?.args).not.toContain("--force");
    expect(push?.args).not.toContain("-f");
    const commitTree = calls.find((c) => c.args[0] === "commit-tree");
    expect(commitTree?.args).toContain("-p");
    expect(commitTree?.args).toContain("tip1234567");
  });

  test("GIT_INDEX_FILE is scoped to the plumbing calls that need it, via the widened env parameter", async () => {
    const { run, calls } = recording(HAPPY_PATH);
    await writeStatusToBranch(run, "/root", BRANCH, REL_PATH, "new content\n", "based0n1234", "tick a row");
    const readTree = calls.find((c) => c.args[0] === "read-tree");
    const updateIndex = calls.find((c) => c.args[0] === "update-index");
    const writeTree = calls.find((c) => c.args[0] === "write-tree");
    expect(readTree?.env?.GIT_INDEX_FILE).toBeTruthy();
    expect(updateIndex?.env?.GIT_INDEX_FILE).toBe(readTree?.env?.GIT_INDEX_FILE);
    expect(writeTree?.env?.GIT_INDEX_FILE).toBe(readTree?.env?.GIT_INDEX_FILE);
    const fetch = calls.find((c) => c.args[0] === "fetch");
    expect(fetch?.env).toBeUndefined();
  });

  test("refuses without writing anything when the row-level guard fails (baseSha stale)", async () => {
    const { run, calls } = recording(HAPPY_PATH);
    const result = await writeStatusToBranch(
      run,
      "/root",
      BRANCH,
      REL_PATH,
      "new content\n",
      "some-other-sha",
      "tick a row",
    );
    expect(result.ok).toBe(false);
    expect(result.note).toContain("changed since you opened it");
    expect(calls.some((c) => c.args[0] === "hash-object")).toBe(false);
    expect(calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  test("refuses when the push is rejected (a headless run raced this write)", async () => {
    const { run } = recording({ ...HAPPY_PATH, push: { code: 1 } });
    const result = await writeStatusToBranch(
      run,
      "/root",
      BRANCH,
      REL_PATH,
      "new content\n",
      "based0n1234",
      "tick a row",
    );
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/changed|reload|try again/i);
  });

  test("refuses when the branch is no longer on origin", async () => {
    const { run } = recording({ "fetch --quiet origin": { code: 0 }, "rev-parse refs/remotes/origin/": { code: 128 } });
    const result = await writeStatusToBranch(
      run,
      "/root",
      BRANCH,
      REL_PATH,
      "new content\n",
      "based0n1234",
      "tick a row",
    );
    expect(result.ok).toBe(false);
  });
});

describe("branch-file real-repo suite (real git, no fakes)", () => {
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

  function makeRepo(where: string): { origin: string; clone: string } {
    const seed = join(where, "seed");
    Bun.spawnSync({ cmd: ["mkdir", "-p", seed] });
    git(seed, "init", "-q", "-b", "main");
    git(seed, "config", "user.name", "Test");
    git(seed, "config", "user.email", "test@example.com");
    writeFileSync(join(seed, "README.md"), "# seed\n");
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", "first");
    const origin = join(where, "origin.git");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", seed, origin] });
    const clone = join(where, "clone");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, clone] });
    git(clone, "config", "user.name", "Test");
    git(clone, "config", "user.email", "test@example.com");
    return { origin, clone };
  }

  /** A commit pushed straight to `origin`'s `branch` — standing in for
   *  a headless run's own commit — never checked out or fetched into
   *  `clone`. The first call creates the branch (off `main`); a second
   *  call for the same branch commits on top of whatever is already
   *  there, so it can stand in for a RACE (a second commit landing
   *  after the page's own read). */
  function pushBranch(origin: string, _seedFrom: string, branch: string, relPath: string, text: string): void {
    const work = join(origin, "..", `${branch.replace(/\//g, "-")}-work-${Math.random().toString(36).slice(2)}`);
    Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, work] });
    const remoteHas = Bun.spawnSync({
      cmd: ["git", "-C", work, "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`],
    });
    if (remoteHas.exitCode === 0) {
      git(work, "fetch", "-q", "origin", branch);
      git(work, "checkout", "-qb", branch, "FETCH_HEAD");
    } else {
      git(work, "checkout", "-qb", branch);
    }
    Bun.spawnSync({ cmd: ["mkdir", "-p", join(work, relPath.replace(/\/[^/]+$/, ""))] });
    writeFileSync(join(work, relPath), text);
    git(work, "config", "user.name", "Test");
    git(work, "config", "user.email", "test@example.com");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "seed branch content");
    git(work, "push", "-q", "origin", branch);
    rmSync(work, { recursive: true, force: true });
  }

  test("reads a branch's real content off origin, without checking it out", async () => {
    const where = tmp("aide-branch-file-");
    const { origin, clone } = makeRepo(where);
    const branch = "aide/291-example";
    const relPath = "aide/291-example/4-status.md";
    pushBranch(origin, where, branch, relPath, "# Status\n\nreal content\n");
    const run = createGitRunner();

    const result = await readStatusFromBranch(run, clone, branch, relPath);

    expect(result?.text).toBe("# Status\n\nreal content\n");
    expect(result?.sha).toMatch(/^[0-9a-f]{40}$/);
    // Never checked out: the clone's own HEAD is still main, untouched.
    expect(git(clone, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
  });

  test("writes a new commit straight onto the branch, leaving the clone's HEAD and index untouched", async () => {
    const where = tmp("aide-branch-file-");
    const { origin, clone } = makeRepo(where);
    const branch = "aide/291-example";
    const relPath = "aide/291-example/4-status.md";
    pushBranch(origin, where, branch, relPath, "# Status\n\nbefore\n");
    const run = createGitRunner();

    const before = await readStatusFromBranch(run, clone, branch, relPath);
    const cloneHeadBefore = git(clone, "rev-parse", "HEAD").trim();

    const result = await writeStatusToBranch(
      run,
      clone,
      branch,
      relPath,
      "# Status\n\nafter\n",
      before!.sha,
      "tick a row",
    );

    expect(result.ok).toBe(true);
    expect(git(clone, "rev-parse", "HEAD").trim()).toBe(cloneHeadBefore);
    expect(git(clone, "diff", "--quiet", "HEAD").length).toBe(0); // clean, exit 0

    const after = await readStatusFromBranch(run, clone, branch, relPath);
    expect(after?.text).toBe("# Status\n\nafter\n");
    expect(after?.sha).not.toBe(before!.sha);
  });

  test("refuses a write when another commit already landed on the branch (a headless run raced it)", async () => {
    const where = tmp("aide-branch-file-");
    const { origin, clone } = makeRepo(where);
    const branch = "aide/291-example";
    const relPath = "aide/291-example/4-status.md";
    pushBranch(origin, where, branch, relPath, "# Status\n\nbefore\n");
    const run = createGitRunner();

    const before = await readStatusFromBranch(run, clone, branch, relPath);
    // The race: a headless run's own commit lands on origin between the
    // page's render and this Save press.
    pushBranch(origin, where, branch, relPath, "# Status\n\nheadless run got there first\n");

    const result = await writeStatusToBranch(
      run,
      clone,
      branch,
      relPath,
      "# Status\n\nafter\n",
      before!.sha,
      "tick a row",
    );

    expect(result.ok).toBe(false);
  });
});
