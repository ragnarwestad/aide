// The one test file here that starts a real process, and it has to:
// what it checks is the spawn itself, which every other suite injects
// past. `branch-status.test.ts` says in its own first line that it
// spawns nothing, and that stays true — this is the wrapper underneath
// the thing it fakes.
//
// "ENOENT ... posix_spawn 'git'" arrived on a page that had been
// working (2026-08-23). The branch check walks every project's specs
// root, two projects on this host have never had one, and `cwd` on a
// missing directory fails inside the spawn. The error names the
// command, so it reads as a machine with no git rather than a path
// with no directory — and it was thrown, not returned, so it took the
// page with it.
import { describe, expect, test } from "bun:test";
import { createGitRunner } from "../src/git/branch-status.ts";

describe("a directory that is not there is an answer, not a crash", () => {
  test("git somewhere that does not exist returns a failure naming the path", async () => {
    const res = await createGitRunner()("/no/such/directory/anywhere", ["rev-parse", "HEAD"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("/no/such/directory/anywhere");
  });

  test("a directory that does exist still answers normally", async () => {
    const res = await createGitRunner()(process.cwd(), ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(res.code).toBe(0);
    expect(res.stdout.trim().length).toBeGreaterThan(0);
  });
});

// A clone is not a question. Four seconds is right for "is this branch
// merged"; the specs repository took 4.3 s to clone on 2026-08-23 and
// was killed at 4.0, leaving a `.git` with `objects` and no `HEAD`.
// Every run then refused: the checkout it needed was a directory that
// was not a repository.
describe("one call can ask for longer than the default", () => {
  // 1 ms is shorter than a process takes to start, so the default kills
  // every call this runner makes — which is what makes the second
  // assertion mean something.
  const impatient = createGitRunner(1);

  test("the runner's own figure kills a call that does not name one", async () => {
    const res = await impatient(process.cwd(), ["log", "-1", "--format=%H"]);
    expect(res.stdout.trim()).toBe("");
  });

  test("a call that names its own is not held to it", async () => {
    const res = await impatient(process.cwd(), ["log", "-1", "--format=%H"], 30_000);
    expect(res.code).toBe(0);
    expect(res.stdout.trim().length).toBeGreaterThan(0);
  });
});
