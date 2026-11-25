// The dashboard's first WRITE path. Until now it only ever
// asked git a question (`branch-status.ts`); this merges a spec's branch
// into a repo's default branch and pushes the result.
//
// The shape is `aide-run-spec`'s, run the other way round. That script
// brings a REUSED spec branch up to date with the default branch —
// ff-only first, a real merge as the fallback, `merge --abort` and a
// named refusal on conflict (`update_branch_to_base` in
// `core/scripts/aide-run-spec`) — and
// has done so on every headless job. Merging the spec branch INTO the
// default branch is the same three decisions in the other direction, so
// it is the same three decisions here rather than a second opinion.
//
// Two properties are the point, not tidiness:
//
//   * NO half-merged tree is ever left behind. A conflict aborts and
//     refuses by name, so the next thing to touch that checkout — a
//     queued `aide-run-spec` run, or a person — finds it clean.
//   * ONE repo, ONE result. Several repos cannot be merged atomically,
//     and a single collective "ok" over two repos is exactly the blind
//     spot this whole spec exists to remove.

import { prepareMergeWorktree, WORKTREE_TIMEOUT_MS } from "./worktree.ts";
import type { Sentence } from "../../messages/types.ts";
import { LS_REMOTE_NO_MATCH, lsRemoteBranch } from "../branch-status.ts";
import { type GitRunner } from "../process/index.ts";
import type { CreateFinalizer } from "../create-finalizer.ts";
import type { MergeHooks } from "../merge-hooks.ts";
import { pushRefusal, refuse, type RepoMergeResult } from "./result.ts";
import { LANDING_RETRIES, pushWithRetry, sleep, type Wait } from "./retry.ts";
import { withCheckoutLock } from "../checkout-lock/index.ts";
import { mergeAndGate, type Landing } from "./attempt.ts";

/** Where a landing does its merging: a worktree of the repo it is
 *  landing into, named for the branch so two landings in one repo never
 *  share one. Beside the checkout rather than inside it — a directory
 *  under the repo would show up as untracked in the very tree being
 *  merged. */
export function mergeWorktreePath(root: string, branch: string): string {
  return `${root}.landing.${branch.replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

export type LandingGate = (root: string) => Promise<{
  ok: boolean;
  repaired?: boolean;
  terminalReason?: "tests-red" | "timeout";
  error?: Sentence;
  detail?: string;
}>;

export async function mergeBranchIntoDefault(
  run: GitRunner,
  root: string,
  branch: string,
  base: string,
  wait: Wait = sleep,
  gate?: LandingGate,
  finalizeCreate?: CreateFinalizer,
  hooks?: MergeHooks,
): Promise<RepoMergeResult> {
  // `work` lives on this object so the `finally` can clear it whichever
  // way this returns: a refusal leaves a worktree behind exactly as
  // readily as a success, and one left on disk blocks the next landing
  // of the same branch — `worktree add` refuses a path that already exists.
  const l: Landing = {
    run, root, branch, base, wait, gate, finalizeCreate, hooks,
    work: "",
    // 4-5. `refs/remotes/origin/<branch>`, never a local `<branch>`.
    //      This host is not the machine `aide-run-spec` ran on, so a
    //      local ref of that name may be absent, or left over from an
    //      older run of the same spec. The remote-tracking ref is the
    //      one `isMerged()` already trusts, and step 3 made it current.
    ref: `refs/remotes/origin/${branch}`,
    gateVerdicts: new Map(),
    repaired: false,
    repairRebuilds: 0,
    conflictRepairs: 0,
    sourceTip: "",
  };
  try {
    return await landInWorktree(l);
  } catch (err) {
    return refuse(
      root,
      base,
      { key: "landing.gitCouldNotRun" },
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    // Whichever way this returned. `--force` because the tree may hold
    // a half-finished merge or the gate's own leftovers, and `prune`
    // because a directory removed by anything else still leaves git's
    // own administrative record of it behind — and that record is
    // enough to make the next `worktree add` at the same path refuse.
    if (l.work) {
      await run(root, ["worktree", "remove", "--force", l.work], WORKTREE_TIMEOUT_MS);
      await run(root, ["worktree", "prune"]);
    }
  }
}

async function landInWorktree(l: Landing): Promise<RepoMergeResult> {
  const { run, root, branch } = l;
  // The state of the working tree is not asked about at all.
  // It was, and refused: whoever got to the checkout first left
  // it dirty and the other side backed off. A run now
  // works in a worktree of its own and only ever fast-forwards
  // this one, and an unrelated uncommitted file then stopped merges
  // for no reason anybody could act on. The three commands below
  // write only what differs between the commits, so a file that has
  // nothing to do with the merge is untouched, and one that DOES
  // collide raises git's own error rather than a guess made in
  // advance. Every move of the shared checkout below runs under the
  // runner's own checkout lock (`checkout-lock/`), so a run is never
  // in its own section of that checkout at the same moment.

  // 1. Is there anything to merge at all? Since step 6 deletes the
  //    branch, this button will be pressed on a branch that is
  //    already gone — a second click, or someone who removed it by
  //    hand. Merging an unresolvable ref failed and was reported as a
  //    "conflict", which is a different problem with a different
  //    remedy. Asked of origin directly, and only git's own "no
  //    matching refs" counts: any other nonzero code is a transport
  //    failure and must fall through to the sequence below.
  const onOrigin = await run(root, lsRemoteBranch(branch));
  if (onOrigin.code === LS_REMOTE_NO_MATCH) {
    return {
      ...refuse(root, branch, { key: "landing.nothingLeftToMerge" }),
      reason: "gone",
    };
  }
  const prepared = await withCheckoutLock(root, () => prepareWorktree(l), { wait: l.wait });
  if (!prepared.locked) {
    return refuse(root, branch, { key: "landing.checkoutLockTimedOut", values: { lock: prepared.lock } });
  }
  if (prepared.value) return prepared.value;
  const unpublished = await publish(l);
  if (unpublished) return unpublished;
  await catchUpCheckout(l);
  l.hooks?.progress?.("delete");
  const leftOnOrigin = await deleteOriginBranch(l);
  if (leftOnOrigin) return leftOnOrigin;
  await deleteLocalBranch(l);
  return { root, ok: true, ...(l.assignedSpecFolder ? { assignedSpecFolder: l.assignedSpecFolder } : {}) };
}

/** Whether the shared checkout's own base holds commits of its own that
 *  origin does not. */
async function baseHoldsOwnCommits(run: GitRunner, root: string, base: string): Promise<boolean> {
  const ahead = await run(root, ["rev-list", "--count", `origin/${base}..${base}`]);
  if (ahead.code !== 0 || Number(ahead.stdout.trim()) <= 0) return false;
  const own = await run(root, [
    "rev-list", `origin/${base}..${base}`, "--no-merges", "--not", "--remotes=origin",
  ]);
  return own.code === 0 && own.stdout.trim() !== "";
}

// 2. Best effort, exactly as `isMerged()` does it: whatever the
//    checkout already knows beats no answer at all.
// 3. The merge does NOT stand in the shared checkout any more. It
//    used to `git switch` there and hold it for the whole landing —
//    the fetch, the merge, and the project's own suite on the
//    result, five and a half minutes for this repo. That directory
//    is the one a starting run reads before it cuts its own
//    worktree, so the scheduler had to hold every job for the
//    project until the landing finished (the `runner.ts`
//    pause). The work happens in a throwaway worktree at
//    `origin/<base>` instead, and the shared checkout is only
//    fast-forwarded at the end, once, in well under a second.
//
//    `--detach` is what makes it possible: git refuses to check the
//    same branch out twice, and the shared checkout is already on
//    base. A detached worktree needs no local branch at all.
//
//    A worktree that cannot be made is a refusal, never a quiet
//    fall back to the shared checkout — falling back would put the
//    hazard right back without anybody being told.
async function prepareWorktree(l: Landing): Promise<RepoMergeResult | null> {
  const { run, root, branch, base } = l;
  await run(root, ["fetch", "-q", "origin", base]);

  //    Before anything is merged: does the shared checkout's own base
  //    hold commits origin does not? The landing works from
  //    `origin/<base>` and would push right past them, and the
  //    fast-forward at the end would then fail silently — somebody's
  //    unpushed work, still on disk, no longer on the branch anybody
  //    reads. It refused loudly before this moved into a worktree,
  //    and it still does. Merge commits do not count: those are a
  //    landing's own, left by one that pushed and died.
  if (await baseHoldsOwnCommits(run, root, base)) {
    return refuse(root, branch, { key: "landing.cannotFastForward", values: { base } });
  }

  l.work = mergeWorktreePath(root, branch);
  await prepareMergeWorktree(run, root, l.work);
  const added = await run(root, ["worktree", "add", "--detach", "-q", l.work, `origin/${base}`], WORKTREE_TIMEOUT_MS);
  if (added.code !== 0) {
    await run(root, ["worktree", "prune"]);
    return refuse(
      root,
      branch,
      { key: "landing.cannotSwitch", values: { base } },
      (added.stderr ?? "").trim() || undefined,
    );
  }
  return null;
}

// 4-5, and the gate, as one attempt (`mergeAndGate`): merge the branch
//      onto base, run the tests on the result, push. Made twice at most —
//      the second time onto a base that moved on origin while the first
//      attempt's tests ran, after the first attempt's merge is dropped.
//      The tests run on exactly what main is about to become, so a moved
//      base means they run again — unless it reproduces a tree already
//      gated once.
// 6. `isMerged()` only trusts what reached origin, so a merge this
//    action does not push would show as "not merged" on the very
//    page that triggered it. A push origin cannot be reached for is
//    REPORTED and never rolled back — `aide-run-spec`'s own
//    precedent is that a push problem is not a reason to undo
//    committed work; step 3's leftover check drops it on the next
//    landing, once origin is back. A push refused because base is
//    ahead is base having moved: the local merge is dropped and made
//    again, once. A push origin turned down for a reason of its own
//    is refused in origin's words.
async function publish(l: Landing): Promise<RepoMergeResult | null> {
  const { run, root, branch, base, work } = l;
  for (let attempt = 0; ; attempt++) {
    const failed = await mergeAndGate(l);
    if (failed) return failed;
    if (l.repaired) { l.repaired = false; attempt--; continue; }
    // Create holds this lock from its pull to its push. Keep testing
    // outside it, and rebuild if Create moved the base in the meantime.
    const published = await withCheckoutLock(root, () =>
      pushWithRetry(run, work, base, l.wait, attempt === 0), { wait: l.wait });
    if (!published.locked) {
      return refuse(root, branch, { key: "landing.checkoutLockTimedOut", values: { lock: published.lock } });
    }
    const pushResult = published.value;
    if (pushResult.ok) return null;
    if (!pushResult.moved) return pushRefusal(root, branch, base, pushResult);
    await run(work, ["fetch", "--quiet", "origin", base]);
    await run(work, ["reset", "-q", "--hard", `origin/${base}`]);
    if (attempt >= LANDING_RETRIES.baseMovedRebuilds) {
      return refuse(
        root,
        branch,
        { key: "landing.baseMovedTwice", values: { base } },
        pushResult.error,
      );
    }
  }
}

// 6b. The shared checkout catches up, and this is the only moment
//     it moves at all. It is already standing on base — no run ever
//     switches it, and nothing else here does now either — so a
//     fast-forward to what was just pushed is the whole update, and
//     it takes no longer than reading a ref. `installAfterMerge`
//     runs in this directory straight after and needs the merged
//     code here; a checkout left behind would install the old one.
//
//     Not fatal on failure. The merge is on origin, which is what
//     "landed" means; a checkout that could not fast-forward is a
//     local state the next landing's own pull settles.
async function catchUpCheckout(l: Landing): Promise<void> {
  const { run, root, base } = l;
  await l.hooks?.beforeCheckoutMoves?.(l.assignedSpecFolder ? { assignedSpecFolder: l.assignedSpecFolder } : {});
  const caughtUp = await withCheckoutLock(root, async () => {
    await run(root, ["fetch", "-q", "origin", base]);
    //     A gate's own record left dirty here — `test-run.json`, never
    //     committed — blocks a fast-forward with "local changes would
    //     be overwritten" (356's landing, 2026-09-03). It is a record,
    //     not work: discarded rather than allowed to strand the
    //     checkout. Nothing else is touched.
    await run(root, ["checkout", "-q", "--", ":(top,glob)**/test-run.json"]);
    return run(root, ["merge", "-q", "--ff-only", `origin/${base}`]);
  }, { wait: l.wait });
  const behind = caughtUp.locked
    ? caughtUp.value.code !== 0 && (caughtUp.value.stderr ?? "").trim().slice(-200)
    : `the wait for its lock at ${caughtUp.lock} ran out`;
  if (behind !== false) {
    console.error(`landing: ${root} could not fast-forward to origin/${base} after the merge reached origin — ${behind}`);
  }
}

// 7. A merged branch left on origin is what made the
//    dependency guard refuse a fully-merged spec three times
//    (2026-08-18): that guard asks origin directly, and a branch
//    still there reads as "not merged yet". AFTER the push, never
//    before — the base has to be on origin before the only other
//    copy of those commits is removed. Never fatal: the merge
//    already happened, so this follows `installError`'s precedent
//    and is reported beside a success rather than turning it into
//    a failure.
async function deleteOriginBranch(l: Landing): Promise<RepoMergeResult | null> {
  const { root, branch } = l;
  const deleted = await l.run(root, ["push", "-q", "origin", "--delete", branch]);
  if (deleted.code === 0) return null;
  // The stderr tail is never part of the sentence
  // — it rides in `detail` instead, for whoever needs the exact
  // words; the board itself shows the fixed BRANCH_LEFT_BEHIND
  // sentence, never this text directly (`row-marks.ts`).
  const detail = (deleted.stderr ?? "").trim().slice(-200) || "unknown reason";
  return {
    root,
    ok: true,
    // The ROOT is folded in where this is composed for the row
    // (`landBranch`), which is the one place that knows
    // whether several repos are being reported at once.
    branchDeleteError: { key: "landing.branchDeleteFailed", values: { branch } },
    detail,
    ...(l.assignedSpecFolder ? { assignedSpecFolder: l.assignedSpecFolder } : {}),
  };
}

// 8. And this checkout's own copy. The ref outlives the
//    worktree that made it — `aide-run-spec` throws the worktree
//    directory away at the end of a run, the branch it created stays
//    in the shared refs — and nothing removed it until now: 260 had
//    piled up by 2026-08-23, one of which stopped a spec from
//    starting when it was reopened. Only reached once the ORIGIN
//    delete has also succeeded, so the two copies go together or not
//    at all. `-d` rather than `-D`: the safe form always succeeds
//    here, because step 4-5 has just merged the branch into the
//    HEAD this runs against, and asking for it says the delete only
//    ever follows a merge that landed. Best effort and unreported,
//    like the fetch at step 2 — this host may not even have the ref,
//    and a cleanup must never turn a landed merge into a failure.
//    A squashed branch is never an ancestor of base, so `-d` would
//    refuse it: there the copy goes only when it is exactly the tip
//    that landed, and a newer local commit keeps it.
async function deleteLocalBranch(l: Landing): Promise<void> {
  const { run, root, branch } = l;
  if (!l.sourceTip) {
    await run(root, ["branch", "-d", branch]);
    return;
  }
  const local = await run(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (local.code === 0 && local.stdout.trim() === l.sourceTip) await run(root, ["branch", "-D", branch]);
}
