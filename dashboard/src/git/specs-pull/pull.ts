// The Update button's pull: the four questions asked of the specs
// checkout before it is fast-forwarded, and the fast-forward itself.

import type { GitRunner } from "../process/index.ts";
import { getErrorMessage } from "../../messages/shared/written.ts";
import { sleep, type Wait } from "../branch-merge/retry.ts";
import { REQUEST_LOCK_WAIT_MS, withCheckoutLock } from "../checkout-lock/index.ts";


/** The remedy every refusal below shares, once the specific fact has
 *  been said: none of these is a press on the board —
 *  the fix is in the shared specs checkout itself. */
export const IN_THE_CHECKOUT = "in the checkout on the serving host";

export interface SpecsPullResult {
  ok: boolean;
  /** One sentence for the reader: why nothing was pulled, or what the
   *  pull did. Both ride back on the redirect, so both are prose. */
  note: string;
  /** On a refusal that has a fix: the problem and the fix apart, for a
   *  caller that shows them as two lines. `note` holds both in one. */
  problem?: string;
  solution?: string;
  /** Whether the checkout actually moved. "Already up to date" is a
   *  success and is not the same news. */
  moved: boolean;
}

const refuse = (said: string | ReturnType<typeof getErrorMessage>): SpecsPullResult =>
  typeof said === "string"
    ? { ok: false, note: said, moved: false }
    : { ok: false, note: said.text, problem: said.problem, solution: said.solution, moved: false };

const short = (sha: string | null): string => (sha ?? "").slice(0, 7) || "unknown";

/** The top of the working tree `dir` sits in, or the refusal for a `dir`
 *  that is in none. */
export async function topOf(run: GitRunner, dir: string): Promise<string | SpecsPullResult> {
  const top = await run(dir, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) {
    return refuse(
      getErrorMessage({
        what: `${dir} is not a git working tree — nothing was pulled.`,
        resolve: `Check the project's specs root is a git checkout, ${IN_THE_CHECKOUT}.`,
      }),
    );
  }
  return top.stdout.trim();
}

/** The refusal for a checkout whose lock another process held for the
 *  whole wait: a run in its own section of the same checkout, as a rule,
 *  which has ended by the next press. */
export const lockHeld = (lock: string, nothing: string) =>
  getErrorMessage({
    what: `another process held the specs checkout's lock at ${lock} — nothing was ${nothing}.`,
    resolve: `Try again; if it keeps happening, check that no aide-run-spec process is stuck using it ${IN_THE_CHECKOUT}.`,
  });

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
  wait: Wait = sleep,
): Promise<SpecsPullResult> {
  try {
    const root = await topOf(run, dir);
    if (typeof root !== "string") return root;
    // Under the checkout's lock, which a run takes for its own pull.
    const pulled = await withCheckoutLock(root, () => pullInCheckout(run, root, resolveBase), {
      waitMs: REQUEST_LOCK_WAIT_MS,
      wait,
    });
    return pulled.locked ? pulled.value : refuse(lockHeld(pulled.lock, "pulled"));
  } catch (err) {
    // The reader pressed a button. A git that cannot be spawned at all
    // is an answer on the page, never a 500.
    return refuse(`git could not be run: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The pull itself, at the top of the work tree `root`, with the
 *  checkout's lock already held. Save calls this, never
 *  `pullFastForward`: taking the lock it holds would wait out its own. */
export async function pullInCheckout(
  run: GitRunner,
  root: string,
  resolveBase: (root: string) => Promise<string | null>,
): Promise<SpecsPullResult> {
  const base = await cleanOnDefault(run, root, resolveBase);
  if (typeof base !== "string") return base;
  return fastForwardTo(run, root, base);
}

/** The default branch `root` is clean and on, or the refusal for a
 *  checkout that is dirty, has no default branch, or is on another. */
async function cleanOnDefault(
  run: GitRunner,
  root: string,
  resolveBase: (root: string) => Promise<string | null>,
): Promise<string | SpecsPullResult> {
  // Uncommitted work of ANY kind, tracked files only: an untracked
  // file is no obstacle to a fast-forward, and a specs root collects
  // those (editor scratch, exports) between commits.
  const dirty = await run(root, ["diff", "--quiet", "HEAD"]);
  if (dirty.code !== 0) {
    return refuse(
      getErrorMessage({
        what: "the specs checkout has uncommitted changes — nothing was pulled.",
        resolve: `Commit or discard them ${IN_THE_CHECKOUT}, then try again.`,
      }),
    );
  }

  const base = await resolveBase(root);
  if (!base) {
    return refuse(
      getErrorMessage({
        what: "the specs checkout has no default branch on origin — nothing was pulled.",
        resolve: `Check the specs repo's default branch on origin, from the checkout ${IN_THE_CHECKOUT}.`,
      }),
    );
  }
  const current = await run(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const on = current.stdout.trim();
  if (current.code !== 0 || on !== base) {
    // A checkout parked on a spec branch is left alone: pulling it
    // would fetch a branch whose upstream may be gone.
    return refuse(
      getErrorMessage({
        what: `the specs checkout is on ${on || "an unknown branch"}, not ${base} — nothing was pulled.`,
        resolve: `Switch it to ${base} ${IN_THE_CHECKOUT}, then try again.`,
      }),
    );
  }
  return base;
}

/** Fetch `base` and fast-forward `root` to it, or say why not. */
async function fastForwardTo(run: GitRunner, root: string, base: string): Promise<SpecsPullResult> {
  const fetched = await run(root, ["fetch", "--quiet", "origin", base]);
  if (fetched.code !== 0) {
    return refuse(
      getErrorMessage({
        what: "origin could not be reached — nothing was pulled.",
        resolve: "Check the network from the serving host, then try again.",
      }),
    );
  }

  // Before the merge, so a divergence is its own answer rather than
  // whatever git says when the merge refuses.
  const ref = `refs/remotes/origin/${base}`;
  const ancestor = await run(root, ["merge-base", "--is-ancestor", "HEAD", ref]);
  if (ancestor.code !== 0) {
    return refuse(
      getErrorMessage({
        what: "the specs checkout has commits origin does not, so it cannot fast-forward — nothing was pulled.",
        resolve: `Merge it by hand, ${IN_THE_CHECKOUT}.`,
      }),
    );
  }

  const before = await run(root, ["rev-parse", "HEAD"]);
  const merged = await run(root, ["merge", "-q", "--ff-only", ref]);
  if (merged.code !== 0) {
    return refuse(
      getErrorMessage({
        what: "the pull failed — nothing was pulled.",
        resolve: `Try again; if it keeps failing, check it ${IN_THE_CHECKOUT}.`,
      }),
    );
  }
  const after = await run(root, ["rev-parse", "HEAD"]);

  const from = before.code === 0 ? before.stdout.trim() : null;
  const to = after.code === 0 ? after.stdout.trim() : null;
  if (from && to && from === to) {
    return { ok: true, moved: false, note: "the specs checkout was already up to date" };
  }
  return { ok: true, moved: true, note: `pulled the specs checkout: ${short(from)} → ${short(to)}` };
}
