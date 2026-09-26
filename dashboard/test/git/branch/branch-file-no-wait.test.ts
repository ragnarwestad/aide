// A page reads a spec's open branch without waiting on origin: it reads
// what the branch was at its last fetch and fetches again behind it. A
// spec page opened from a notification waited six to nine seconds on
// those fetches.

import { describe, expect, test } from "bun:test";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { readStatusFromFetchedBranch } from "../../../src/git/branch-file.ts";

const REL_PATH = "aide/specs/541-x/4-status.md";

/** A runner whose fetches hang until `release()`, and which answers the
 *  local ref as there or not. */
function held(refKnown: boolean, fetchCode = 0) {
  let release = (): void => {};
  const gate = new Promise<void>((r) => (release = r));
  const fetches: string[] = [];
  const run: GitRunner = async (_dir, args) => {
    const line = args.join(" ");
    if (line.startsWith("rev-parse --verify")) return { code: refKnown ? 0 : 1, stdout: "" };
    if (line.startsWith("fetch")) {
      fetches.push(line);
      await gate;
      return { code: fetchCode, stdout: "" };
    }
    if (line.startsWith("log -1")) return { code: 0, stdout: "abc123\n" };
    if (line.startsWith("show")) return { code: 0, stdout: "# Status\n" };
    return { code: 1, stdout: "" };
  };
  return { run, release, fetches };
}

describe("readStatusFromFetchedBranch", () => {
  test("answers from the last fetch while a new one is still out", async () => {
    const g = held(true);
    const read = await readStatusFromFetchedBranch(g.run, "/r1", "aide/541-x", REL_PATH);
    expect(read).toEqual({ text: "# Status\n", sha: "abc123" });
    expect(g.fetches).toHaveLength(1);
    g.release();
  });

  test("two reads while a fetch is out start one fetch between them", async () => {
    const g = held(true);
    await readStatusFromFetchedBranch(g.run, "/r2", "aide/541-x", REL_PATH);
    await readStatusFromFetchedBranch(g.run, "/r2", "aide/541-x", "aide/specs/archive/541-x/4-status.md");
    expect(g.fetches).toHaveLength(1);
    g.release();
  });

  test("a branch never fetched here waits for the fetch, and reads nothing when it fails", async () => {
    const g = held(false, 1);
    const reading = readStatusFromFetchedBranch(g.run, "/r3", "aide/541-x", REL_PATH);
    g.release();
    expect(await reading).toBeNull();
  });
});
