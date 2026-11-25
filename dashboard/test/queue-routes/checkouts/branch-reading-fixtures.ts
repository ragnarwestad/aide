// A git for the queue-routes harness that answers the reads of a spec's
// open `aide/<folder>` branch as if origin had one, and hands every other
// call to the real git.
import { join } from "node:path";
import { createGitRunner, type GitRunner } from "../../../src/git/process/index.ts";

/** Whether the branch is open, and what it holds: `branchText` is its
 *  `4-status.md`, `archivedText` the same file once `archive` has moved
 *  the folder on the branch, `stateText` its `4-status.json`. */
export interface BranchReadingOpts {
  open: boolean;
  branchText?: string;
  archivedText?: string;
  stateText?: string;
}

/** Real git for everything (workflow history), except the branch-read
 *  calls `resolveOpenBranchTarget`/`readStatusFromBranch` make — there
 *  is no real `origin` remote in the queue-routes harness, so those
 *  calls are simulated, scoped to `folder`'s own branch and path.
 *
 *  `rev-parse --show-toplevel` is intercepted too, the same way
 *  `branchAwareGitRunner` (`spec-checks-fixtures.ts`) already does:
 *  real git resolves macOS's `/tmp` → `/private/tmp` symlink, which
 *  makes its answer a different STRING than the literal `dir` this
 *  fixture was handed even though both name the same directory — and
 *  `relative(root, ...)` then builds a `../../..` path instead of a
 *  clean relative one. Slicing the known suffix off `d` keeps `root`
 *  in the same string family `dir` already is. */
export const branchReadingGit = (folder: string, opts: BranchReadingOpts): GitRunner => {
  const real = createGitRunner();
  const branch = `aide/${folder}`;
  const relPath = `aide/specs/${folder}/4-status.md`;
  // Where `archive` moves the folder ON THE BRANCH once it has run
  // there — the active path above then names nothing at all, and git
  // answers a `log` for it with no sha, exactly as modelled below.
  const archivedRelPath = `aide/specs/archive/${folder}/4-status.md`;
  // The branch's own sibling state file — read alongside
  // `relPath`, at the same active-folder path `4-status.md` sits at.
  const jsonRelPath = `aide/specs/${folder}/4-status.json`;
  const ref = `refs/remotes/origin/${branch}`;
  const specFolderSuffix = join("aide", "specs", folder);
  return async (dir, args, timeoutMs, env) => {
    const line = args.join(" ");
    if (line === "rev-parse --show-toplevel" && dir.endsWith(specFolderSuffix)) {
      return { code: 0, stdout: `${dir.slice(0, dir.length - specFolderSuffix.length - 1)}\n` };
    }
    if (line === "ls-remote --heads origin refs/heads/aide/*") {
      return {
        code: 0,
        stdout: opts.open ? `deadbeef0000000000000000000000000000000\trefs/heads/${branch}\n` : "",
      };
    }
    if (line === `fetch --quiet origin ${branch}`) return { code: 0, stdout: "" };
    if (line === `log -1 --format=%H ${ref} -- ${relPath}`) {
      return { code: 0, stdout: opts.archivedText === undefined ? "cafebabe000000000000000000000000000000\n" : "" };
    }
    if (line === `show ${ref}:${relPath}`) return { code: 0, stdout: opts.branchText ?? "" };
    if (line === `log -1 --format=%H ${ref} -- ${archivedRelPath}`) {
      return { code: 0, stdout: opts.archivedText === undefined ? "" : "cafebabe000000000000000000000000000000\n" };
    }
    if (line === `show ${ref}:${archivedRelPath}`) return { code: 0, stdout: opts.archivedText ?? "" };
    if (opts.stateText !== undefined) {
      if (line === `log -1 --format=%H ${ref} -- ${jsonRelPath}`) {
        return { code: 0, stdout: "cafef00d000000000000000000000000000000\n" };
      }
      if (line === `show ${ref}:${jsonRelPath}`) return { code: 0, stdout: opts.stateText };
    }
    return real(dir, args, timeoutMs, env);
  };
};
