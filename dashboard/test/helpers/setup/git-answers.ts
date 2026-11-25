// Canned `fakeGit` answers for a merge into master that goes through.
//
// `MERGE_GOES_THROUGH` is a clean checkout on master (`CLEAN_MASTER`:
// `symbolic-ref`, `status --porcelain`, `worktree`) whose upstream is
// origin/master, and whose pull, fetch, switch, fast-forward merge and
// push all succeed. Spread it into a `fakeGit` table and name after it
// only what a test changes:
//
//   fakeGit({ ...MERGE_GOES_THROUGH, push: { code: 1 } })
//
// A key named again keeps its place in the table, so `fakeGit`'s
// first-matching-prefix rule still reads `merge -q --ff-only origin/`
// before `merge -q --ff-only`; a key the table does not have is added
// after all of these.
import { CLEAN_MASTER } from "../fake-git.ts";

export const MERGE_GOES_THROUGH = {
  ...CLEAN_MASTER,
  "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
  pull: { code: 0 },
  "merge -q --ff-only origin/": { code: 0 },
  "merge -q --ff-only": { code: 0 },
  push: { code: 0 },
  switch: { code: 0 },
  fetch: { code: 0 },
};

/** The answers a spec file save asks for, every one a success: the
 *  checkout at `root` on main at `headSha`, something staged after the
 *  write, the pull's fetch and fast-forward, `fileSha` as the commit that
 *  last touched the file, and the commit and push. A test spreads it and
 *  names after it only what it changes. */
export const saveGoesThrough = (root: string, headSha: string, fileSha: string) => ({
  "rev-parse --show-toplevel": { code: 0, stdout: `${root}\n` },
  // Something IS staged after the write: the ordinary case is a real edit.
  "diff --cached --quiet HEAD": { code: 1 },
  "diff --quiet HEAD": { code: 0 },
  "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
  "rev-parse HEAD": { code: 0, stdout: `${headSha}\n` },
  fetch: { code: 0 },
  "merge-base --is-ancestor": { code: 0 },
  "merge -q --ff-only origin/": { code: 0 },
  "merge -q --ff-only": { code: 0 },
  "log -1 --format=": { code: 0, stdout: `${fileSha}\t2026-08-21T09:14:00+02:00\n` },
  add: { code: 0 },
  commit: { code: 0 },
  push: { code: 0 },
  "reset --hard": { code: 0 },
});
