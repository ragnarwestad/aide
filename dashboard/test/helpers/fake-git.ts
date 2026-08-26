// A git that runs no git. Both the read path (branch-status) and the
// write path (branch-merge) ask their questions of the LOGIC — which
// refs are consulted, in what order, and what an unresolvable answer
// degrades to — so a harness kept in two copies would be a harness that
// one day disagrees with itself about what git said.

import type { GitRunner } from "../../src/git/branch-status.ts";

export interface GitCall {
  dir: string;
  args: string[];
}

/** A runner that answers from a table of `argv` prefixes and records
 *  everything it was asked. The first matching prefix wins, so a table
 *  can put a specific case above a general one. */
export function fakeGit(answers: Record<string, { code: number; stdout?: string; stderr?: string }>) {
  const calls: GitCall[] = [];
  const run: GitRunner = async (dir, args) => {
    calls.push({ dir, args });
    for (const [prefix, answer] of Object.entries(answers)) {
      if (args.join(" ").startsWith(prefix)) {
        // `stderr` only where a table says so: the one code path that
        // reads it (branch-merge's index.lock retry) must behave for an
        // absent field exactly as it did before the field existed.
        return { code: answer.code, stdout: answer.stdout ?? "", stderr: answer.stderr };
      }
    }
    return { code: 1, stdout: "" };
  };
  return { run, calls };
}

/** What a clean checkout on its default branch answers before anything
 *  is merged into it: origin/HEAD resolves, the tree is clean, and
 *  every plumbing call succeeds. */
export const CLEAN_MASTER = {
  "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/master\n" },
  "status --porcelain": { code: 0, stdout: "" },
};
