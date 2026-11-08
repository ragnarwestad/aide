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
import type { BoardMessage, Sentence } from "../../i18n/message.ts";
import { gitErrorDetail } from "../../format/git-error.ts";
import { LS_REMOTE_NO_MATCH, lsRemoteBranch, type GitRunner } from "../branch-status.ts";
import { finalizeCreateOnAttempt, type CreateFinalizer } from "../create-finalizer.ts";
import type { MergeHooks } from "../merge-hooks.ts";
import { pushRefusal, refuse, type RepoMergeResult } from "./result.ts";
import { GIT_LOCKED, LOCK_RETRIES, LOCK_WAIT_MS, pushWithRetry, sleep, type Wait } from "./retry.ts";

/** Where a landing does its merging: a worktree of the repo it is
 *  landing into, named for the branch so two landings in one repo never
 *  share one. Beside the checkout rather than inside it — a directory
 *  under the repo would show up as untracked in the very tree being
 *  merged. */
export function mergeWorktreePath(root: string, branch: string): string {
  return `${root}.landing.${branch.replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

export type LandingGate = (root: string) => Promise<{ ok: boolean; error?: Sentence; detail?: string }>;

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
  // Declared out here so the `finally` can clear it whichever way this
  // returns: a refusal leaves a worktree behind exactly as readily as a
  // success, and one left on disk blocks the next landing of the same
  // branch — `worktree add` refuses a path that already exists.
  let work = "";
  try {
    // The state of the working tree is not asked about at all.
    // It was, and refused: whoever got to the checkout first left
    // it dirty and the other side backed off. A run now
    // works in a worktree of its own and only ever fast-forwards
    // this one, and an unrelated uncommitted file then stopped merges
    // for no reason anybody could act on. The three commands below
    // write only what differs between the commits, so a file that has
    // nothing to do with the merge is untouched, and one that DOES
    // collide raises git's own error rather than a guess made in
    // advance. What the two sides can still collide over is
    // `index.lock`, and there the run is the side that yields: its pull
    // is a courtesy, recorded as `pullError` and never fatal, while a
    // merge that loses the race is a named refusal the reader sees.

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
    await run(root, ["fetch", "-q", "origin", base]);

    //    Before anything is merged: does the shared checkout's own base
    //    hold commits origin does not? The landing works from
    //    `origin/<base>` and would push right past them, and the
    //    fast-forward at the end would then fail silently — somebody's
    //    unpushed work, still on disk, no longer on the branch anybody
    //    reads. It refused loudly before this moved into a worktree,
    //    and it still does. Merge commits do not count: those are a
    //    landing's own, left by one that pushed and died.
    const ahead = await run(root, ["rev-list", "--count", `origin/${base}..${base}`]);
    if (ahead.code === 0 && Number(ahead.stdout.trim()) > 0) {
      const own = await run(root, [
        "rev-list", `origin/${base}..${base}`, "--no-merges", "--not", "--remotes=origin",
      ]);
      if (own.code === 0 && own.stdout.trim() !== "") {
        return refuse(root, branch, { key: "landing.cannotFastForward", values: { base } });
      }
    }

    work = mergeWorktreePath(root, branch);
    await prepareMergeWorktree(run, root, work);
    const added = await run(root, ["worktree", "add", "--detach", "-q", work, `origin/${base}`], WORKTREE_TIMEOUT_MS);
    if (added.code !== 0) {
      await run(root, ["worktree", "prune"]);
      return refuse(
        root,
        branch,
        { key: "landing.cannotSwitch", values: { base } },
        (added.stderr ?? "").trim() || undefined,
      );
    }

    // 4-5. `refs/remotes/origin/<branch>`, never a local `<branch>`.
    //      This host is not the machine `aide-run-spec` ran on, so a
    //      local ref of that name may be absent, or left over from an
    //      older run of the same spec. The remote-tracking ref is the
    //      one `isMerged()` already trusts, and step 3 made it current.
    const ref = `refs/remotes/origin/${branch}`;
    // 4-5, and the gate, as one attempt: merge the branch onto base, run
    //      the tests on the result, push. Made twice at most — the second
    //      time onto a base that moved on origin while the first attempt's
    //      tests ran, after the first attempt's merge is dropped. The
    //      tests run on exactly what main is about to become, so a moved
    //      base means they run again — unless it reproduces a tree already
    //      gated once (below).
    // A resulting tree already gated once for THIS
    // landing is never gated again. Scoped to the lifetime of this one
    // `mergeBranchIntoDefault()` call — never module- or server-lifetime
    // — so no verdict outlives the landing it was reached for.
    const gateVerdicts = new Map<string, { ok: boolean; error?: Sentence; detail?: string }>();
    // Set on the attempt that actually pushes — never on one whose push
    // was rejected and dropped, so a retry's own rename (recomputed
    // against the base that moved) is the one that survives.
    let assignedSpecFolder: string | undefined;
    const mergeAndGate = async (): Promise<RepoMergeResult | null> => {
      // The tip BEFORE this attempt's own merge, so a
      // branch that adds nothing to THIS repo can be told apart from one
      // that does.
      const preMergeHead = gate ? (await run(work, ["rev-parse", "HEAD"])).stdout.trim() : "";
      await run(work, ["fetch", "--quiet", "origin", base, branch]);
      // A merge that lost a lock race is retried like the pull is — it
      // used to be reported as a conflict, which it is not.
      let merged = false;
      let lastStderr = "";
      let conflicted: string[] = [];
      for (let n = 0; !merged && n <= LOCK_RETRIES; n++) {
        if (n > 0) await wait(LOCK_WAIT_MS);
        const ff = await run(work, ["merge", "-q", "--ff-only", ref]);
        if (ff.code === 0) {
          merged = true;
          break;
        }
        const real = await run(work, [...((await hooks?.mergeArgs?.(work)) ?? []), "merge", "-q", "--no-edit", ref]);
        if (real.code === 0) {
          merged = true;
          break;
        }
        // The files in conflict, read before the abort clears them.
        const unmerged = await run(work, ["diff", "--name-only", "--diff-filter=U"]);
        conflicted = unmerged.code === 0 ? unmerged.stdout.split("\n").filter(Boolean) : [];
        await run(work, ["merge", "--abort"]);
        // git names a conflict on stdout and a lock it lost on stderr.
        lastStderr = `${real.stdout ?? ""}\n${real.stderr ?? ""}`.trim();
        if (!GIT_LOCKED.test(lastStderr)) break;
      }
      if (!merged) {
        const why: BoardMessage = conflicted.length
          ? { key: "landing.mergeConflictIn", values: { base, files: conflicted } }
          : { key: "landing.mergeConflict", values: { base } };
        return { ...refuse(root, branch, why, gitErrorDetail(lastStderr) || undefined), reason: "conflict" };
      }
      // A create job's folder is renumbered here, before the gate, on
      // every attempt (create-finalizer.ts says why).
      if (finalizeCreate) {
        const finalized = await finalizeCreateOnAttempt(run, finalizeCreate, { work, root, branch, base });
        if ("refused" in finalized) return finalized.refused;
        assignedSpecFolder = finalized.specFolder;
      }
      // The tests run HERE, once per attempt, on what main is about to
      // become — not in every step that touched the branch, and never
      // after the push. Red: the local merge is dropped and origin never
      // sees it; the branch is untouched, so implement can be run again
      // on it.
      if (gate) {
        // An empty diff against the pre-merge tip means
        // this merge added nothing to `root` — there is nothing the
        // suite could fail for that this merge caused, so it never runs.
        const changed = await run(work, ["diff", "--quiet", preMergeHead, "HEAD"]);
        if (changed.code !== 0) {
          // An identical resulting tree reuses the
          // verdict already reached for it within this same call, rather
          // than running the suite again.
          const treeRes = await run(work, ["rev-parse", "HEAD^{tree}"]);
          const tree = treeRes.code === 0 ? treeRes.stdout.trim() : "";
          const cached = tree ? gateVerdicts.get(tree) : undefined;
          // The gate tests the MERGED tree, and that tree is in the
          // landing's own worktree now — never the shared checkout,
          // which no longer holds the merge at all.
          const verdict = cached ?? (await gate(work));
          if (tree && !cached) gateVerdicts.set(tree, verdict);
          if (!verdict.ok) {
            await run(work, ["reset", "-q", "--hard", `origin/${base}`]);
            // No `(branch in root)` tail, unlike every refusal around it:
            // those name a checkout because that is where a person has to
            // go and do something by hand. Here the move is a step on the
            // row — run implement again — and the path is one more thing
            // to read past. It rides in `detail` with the test output.
            return {
              root,
              ok: false,
              error: verdict.error ?? { key: "landing.testsRedOnMergeFallback", values: { base } },
              ...(verdict.detail ? { detail: `${verdict.detail}\n${branch} in ${root}` } : { detail: `${branch} in ${root}` }),
              reason: "tests-red",
            };
          }
        }
      }
      return null;
    };
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
    for (let attempt = 0; ; attempt++) {
      const failed = await mergeAndGate();
      if (failed) return failed;
      const pushResult = await pushWithRetry(run, work, base, wait);
      if (pushResult.ok) break;
      if (!pushResult.moved) return pushRefusal(root, branch, base, pushResult);
      await run(work, ["fetch", "--quiet", "origin", base]);
      await run(work, ["reset", "-q", "--hard", `origin/${base}`]);
      if (attempt >= 1) {
        return refuse(
          root,
          branch,
          { key: "landing.baseMovedTwice", values: { base } },
          pushResult.error,
        );
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
    await hooks?.beforeCheckoutMoves?.(assignedSpecFolder ? { assignedSpecFolder } : {});
    await run(root, ["fetch", "-q", "origin", base]);
    //     A gate's own record left dirty here — `test-run.json`, never
    //     committed — blocks a fast-forward with "local changes would
    //     be overwritten" (356's landing, 2026-09-03). It is a record,
    //     not work: discarded rather than allowed to strand the
    //     checkout. Nothing else is touched.
    await run(root, ["checkout", "-q", "--", ":(top,glob)**/test-run.json"]);
    //     Retried on a lost `index.lock` race, and only that: a run
    //     starting in this same second fetches here too. Losing it
    //     would leave the checkout behind, and `installAfterMerge` then
    //     installs the code from before the merge — the one failure
    //     this step exists to prevent.
    let caughtUp = await run(root, ["merge", "-q", "--ff-only", `origin/${base}`]);
    for (let n = 0; caughtUp.code !== 0 && GIT_LOCKED.test(caughtUp.stderr ?? "") && n < LOCK_RETRIES; n++) {
      await wait(LOCK_WAIT_MS);
      caughtUp = await run(root, ["merge", "-q", "--ff-only", `origin/${base}`]);
    }
    if (caughtUp.code !== 0) {
      console.error(
        `landing: ${root} could not fast-forward to origin/${base} after the merge reached origin — ` +
          `${(caughtUp.stderr ?? "").trim().slice(-200)}`,
      );
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
    const deleted = await run(root, ["push", "-q", "origin", "--delete", branch]);
    if (deleted.code !== 0) {
      // The stderr tail is never part of the sentence
      // — it rides in `detail` instead, for whoever needs the exact
      // words; the board itself shows the fixed BRANCH_LEFT_BEHIND
      // sentence, never this text directly (`row-marks.ts`).
      const detail = (deleted.stderr ?? "").trim().slice(-200) || "unknown reason";
      // Names the branch; the ROOT is added where this is composed for
      // the row (`landBranch`), which is the one place that
      // knows whether several repos are being reported at once.
      return {
        root,
        ok: true,
        // The ROOT is folded in where this is composed for the row
        // (`landBranch`), which is the one place that knows
        // whether several repos are being reported at once.
        branchDeleteError: { key: "landing.branchDeleteFailed", values: { branch } },
        detail,
        ...(assignedSpecFolder ? { assignedSpecFolder } : {}),
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
    await run(root, ["branch", "-d", branch]);
    return { root, ok: true, ...(assignedSpecFolder ? { assignedSpecFolder } : {}) };
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
    if (work) {
      await run(root, ["worktree", "remove", "--force", work], WORKTREE_TIMEOUT_MS);
      await run(root, ["worktree", "prune"]);
    }
  }
}
