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
import { createGitRunner } from "../src/branch-status.ts";

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
