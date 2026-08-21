// Spec 150: the Update button's pull.
//
// The dashboard lists specs by reading the spec folders straight off the
// serving host's working copy, which `aide-pull-specs` pulls from cron
// every two minutes. A description edited and pushed from another
// machine is therefore invisible for up to two minutes, and nothing on
// the page said which version it was showing — the user had to be told
// "wait a couple of minutes" before re-running a cancelled job, which is
// not a process. The button closes that gap and lets a reader SEE that
// the dashboard has the change before pressing Run.
//
// It has to be as safe unattended as the cron is, so it asks the same
// four questions `core/scripts/aide-pull-specs:41-104` asks, in
// TypeScript, over one repo instead of a list: is this a git working
// tree, is there anything uncommitted, is it on its own default branch,
// and is the pull a fast-forward. A repo failing any of them is left
// exactly as it was, with the reason on the page.
//
// One deliberate difference from the script. There, a divergence and an
// unreachable remote are both "pull failed" — a fine answer for a cron
// mail, and no answer at all for a person who just pressed a button. So
// the fast-forward is CHECKED, against a ref the fetch has just moved,
// before anything is merged.

import type { GitRunner } from "./branch-status.ts";

export interface SpecsPullResult {
  ok: boolean;
  /** One sentence for the reader: why nothing was pulled, or what the
   *  pull did. Both ride back on the redirect, so both are prose. */
  note: string;
  /** Whether the checkout actually moved. "Already up to date" is a
   *  success and is not the same news. */
  moved: boolean;
}

const refuse = (note: string): SpecsPullResult => ({ ok: false, note, moved: false });

const short = (sha: string | null): string => (sha ?? "").slice(0, 7) || "unknown";

/** Fast-forward the working tree `dir` sits in, or say why not.
 *
 *  `dir` is the SPEC folder the reader was looking at, not the repo:
 *  the first thing asked is where the top of the work tree is, and
 *  everything after that runs there. `git merge` refuses to run from a
 *  subdirectory, and the pull is about the whole repo in any case.
 *
 *  `resolveBase` is passed in rather than re-derived, for the reason
 *  `mergeBranchIntoDefault` gives: `BranchStatusChecker.defaultBranch()`
 *  is public precisely so one resolver answers "which branch is the
 *  default" for every caller. */
export async function pullFastForward(
  run: GitRunner,
  dir: string,
  resolveBase: (root: string) => Promise<string | null>,
): Promise<SpecsPullResult> {
  try {
    const top = await run(dir, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) return refuse(`${dir} is not a git working tree — nothing was pulled`);
    const root = top.stdout.trim();

    // Uncommitted work of ANY kind, tracked files only: an untracked
    // file is no obstacle to a fast-forward, and a specs root collects
    // those (editor scratch, exports) between commits.
    const dirty = await run(root, ["diff", "--quiet", "HEAD"]);
    if (dirty.code !== 0) {
      return refuse(`the specs checkout has uncommitted changes — nothing was pulled`);
    }

    const base = await resolveBase(root);
    if (!base) return refuse(`the specs checkout has no default branch on origin — nothing was pulled`);
    const current = await run(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const on = current.stdout.trim();
    if (current.code !== 0 || on !== base) {
      // A checkout parked on a spec branch is left alone: pulling it
      // would fetch a branch whose upstream may be gone.
      return refuse(`the specs checkout is on ${on || "an unknown branch"}, not ${base} — nothing was pulled`);
    }

    const fetched = await run(root, ["fetch", "--quiet", "origin", base]);
    if (fetched.code !== 0) return refuse(`origin could not be reached — nothing was pulled`);

    // Before the merge, so a divergence is its own answer rather than
    // whatever git says when the merge refuses.
    const ref = `refs/remotes/origin/${base}`;
    const ancestor = await run(root, ["merge-base", "--is-ancestor", "HEAD", ref]);
    if (ancestor.code !== 0) {
      return refuse(
        `the specs checkout has commits origin does not, so it cannot fast-forward — ` +
          `nothing was pulled, merge it by hand`,
      );
    }

    const before = await run(root, ["rev-parse", "HEAD"]);
    const merged = await run(root, ["merge", "-q", "--ff-only", ref]);
    if (merged.code !== 0) return refuse(`the pull failed — nothing was pulled`);
    const after = await run(root, ["rev-parse", "HEAD"]);

    const from = before.code === 0 ? before.stdout.trim() : null;
    const to = after.code === 0 ? after.stdout.trim() : null;
    if (from && to && from === to) {
      return { ok: true, moved: false, note: "the specs checkout was already up to date" };
    }
    return { ok: true, moved: true, note: `pulled the specs checkout: ${short(from)} → ${short(to)}` };
  } catch (err) {
    // The reader pressed a button. A git that cannot be spawned at all
    // is an answer on the page, never a 500.
    return refuse(`git could not be run: ${err instanceof Error ? err.message : String(err)}`);
  }
}
