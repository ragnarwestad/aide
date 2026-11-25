// One attempt at a landing, inside the landing's own worktree: merge the
// branch onto base, run the tests on the result, squash it when asked.
// `mergeBranchIntoDefault` (`merge.ts`) makes it twice at most and pushes
// what it leaves behind.

import type { BoardMessage } from "../../messages/types.ts";
import { gitErrorDetail } from "../../format/git-error.ts";
import { type GitRunner } from "../process/index.ts";
import { finalizeCreateOnAttempt, type CreateFinalizer } from "../create-finalizer.ts";
import type { MergeHooks } from "../merge-hooks.ts";
import { refuse, type RepoMergeResult } from "./result.ts";
import { GIT_LOCKED, LANDING_RETRIES, type Wait } from "./retry.ts";
import { squashOnto } from "./squash.ts";
import type { LandingGate } from "./merge.ts";

type GateVerdict = Awaited<ReturnType<LandingGate>>;

/** Everything one `mergeBranchIntoDefault()` call works with, and the
 *  state its attempts share. Lives exactly as long as that one call. */
export interface Landing {
  run: GitRunner;
  root: string;
  branch: string;
  base: string;
  wait: Wait;
  gate?: LandingGate | undefined;
  finalizeCreate?: CreateFinalizer | undefined;
  hooks?: MergeHooks | undefined;
  /** The landing's worktree; empty until one is made. */
  work: string;
  /** `refs/remotes/origin/<branch>`, never a local `<branch>`. */
  ref: string;
  // A resulting tree already gated once for THIS
  // landing is never gated again. Scoped to the lifetime of this one
  // `mergeBranchIntoDefault()` call — never module- or server-lifetime
  // — so no verdict outlives the landing it was reached for.
  gateVerdicts: Map<string, GateVerdict>;
  // Set on the attempt that actually pushes — never on one whose push
  // was rejected and dropped, so a retry's own rename (recomputed
  // against the base that moved) is the one that survives.
  assignedSpecFolder?: string | undefined;
  repaired: boolean;
  repairRebuilds: number;
  conflictRepairs: number;
  // The branch's tip as the last attempt fetched it, kept for step 8.
  sourceTip: string;
}

async function resetToBase(l: Landing): Promise<void> {
  await l.run(l.work, ["reset", "-q", "--hard", `origin/${l.base}`]);
}

/** A repair changed the branch: drop this attempt's merge and fetch what
 *  the next one merges. */
async function refetchAndReset(l: Landing): Promise<void> {
  await l.run(l.work, ["fetch", "--quiet", "origin", l.base, l.branch]);
  await resetToBase(l);
}

/** Whether the caller's conflict repair resolved `files` on the branch. */
async function repairedConflict(l: Landing, files: string[]): Promise<boolean> {
  const repair = l.hooks?.repairConflict;
  if (!files.length || !l.gate || !repair || l.conflictRepairs >= LANDING_RETRIES.conflictRepairs) return false;
  l.conflictRepairs++;
  if (!(await repair({ work: l.work, branch: l.branch, base: l.base, files }))) return false;
  l.repaired = true;
  await refetchAndReset(l);
  return true;
}

type MergeOutcome = "merged" | "repaired" | { conflicted: string[]; lastStderr: string };

/** Merges the branch onto base: a fast-forward, a real merge as the
 *  fallback, and an abort on conflict. */
async function mergeRef(l: Landing): Promise<MergeOutcome> {
  const { run, work, ref } = l;
  // A merge that lost a lock race is retried like the pull is — it
  // used to be reported as a conflict, which it is not.
  let lastStderr = "";
  let conflicted: string[] = [];
  for (let n = 0; n <= LANDING_RETRIES.lockRetries; n++) {
    if (n > 0) await l.wait(LANDING_RETRIES.lockWaitMs);
    const ff = await run(work, ["merge", "-q", "--ff-only", ref]);
    if (ff.code === 0) return "merged";
    const real = await run(work, [...((await l.hooks?.mergeArgs?.(work)) ?? []), "merge", "-q", "--no-edit", ref]);
    if (real.code === 0) return "merged";
    // The files in conflict, read before the abort clears them.
    const unmerged = await run(work, ["diff", "--name-only", "--diff-filter=U"]);
    conflicted = unmerged.code === 0 ? unmerged.stdout.split("\n").filter(Boolean) : [];
    if (await repairedConflict(l, conflicted)) return "repaired";
    await run(work, ["merge", "--abort"]);
    // git names a conflict on stdout and a lock it lost on stderr.
    lastStderr = `${real.stdout ?? ""}\n${real.stderr ?? ""}`.trim();
    if (!GIT_LOCKED.test(lastStderr)) break;
  }
  return { conflicted, lastStderr };
}

async function gateVerdict(l: Landing, gate: LandingGate): Promise<GateVerdict> {
  // An identical resulting tree reuses the
  // verdict already reached for it within this same call, rather
  // than running the suite again.
  const treeRes = await l.run(l.work, ["rev-parse", "HEAD^{tree}"]);
  const tree = treeRes.code === 0 ? treeRes.stdout.trim() : "";
  const cached = tree ? l.gateVerdicts.get(tree) : undefined;
  // The gate tests the MERGED tree, and that tree is in the
  // landing's own worktree now — never the shared checkout,
  // which no longer holds the merge at all.
  const verdict = cached ?? (await gate(l.work));
  if (tree && !cached) l.gateVerdicts.set(tree, verdict);
  return verdict;
}

/** The tests on the merged tree: null when it may go on, "rebuild" when a
 *  repair changed the branch, or the refusal when they are red. */
async function gateMerged(l: Landing, preMergeHead: string): Promise<RepoMergeResult | "rebuild" | null> {
  const { gate, root, branch, base } = l;
  if (!gate) return null;
  // An empty diff against the pre-merge tip means
  // this merge added nothing to `root` — there is nothing the
  // suite could fail for that this merge caused, so it never runs.
  const changed = await l.run(l.work, ["diff", "--quiet", preMergeHead, "HEAD"]);
  if (changed.code === 0 && l.conflictRepairs <= 0) return null;
  const verdict = await gateVerdict(l, gate);
  if (verdict.repaired && l.repairRebuilds < 2) {
    l.repairRebuilds++;
    l.repaired = true;
    await refetchAndReset(l);
    return "rebuild";
  }
  if (verdict.ok) return null;
  await resetToBase(l);
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
    reason: verdict.terminalReason ?? "tests-red",
  };
}

/** A code root lands as one commit: the tested tree, on the base. */
async function squashIfAsked(l: Landing, preMergeHead: string): Promise<RepoMergeResult | null> {
  const message = l.hooks?.squashMessage;
  if (!message || !preMergeHead) return null;
  const failed = await squashOnto(l.run, l.work, preMergeHead, message);
  if (!failed) return null;
  await resetToBase(l);
  return refuse(l.root, l.branch, { key: "landing.squashFailed", values: { base: l.base } }, gitErrorDetail(failed) || undefined);
}

/** One attempt: merge, finalize a create, gate, squash. Null when it is
 *  ready to push, or when `l.repaired` asks for another attempt. */
export async function mergeAndGate(l: Landing): Promise<RepoMergeResult | null> {
  const { run, work, root, branch, base, hooks } = l;
  // The tip BEFORE this attempt's own merge, so a
  // branch that adds nothing to THIS repo can be told apart from one
  // that does.
  const preMergeHead = l.gate || hooks?.squashMessage ? (await run(work, ["rev-parse", "HEAD"])).stdout.trim() : "";
  await run(work, ["fetch", "--quiet", "origin", base, branch]);
  if (hooks?.squashMessage) l.sourceTip = (await run(work, ["rev-parse", l.ref])).stdout.trim();
  const merged = await mergeRef(l);
  if (merged === "repaired") return null;
  if (merged !== "merged") {
    const why: BoardMessage = merged.conflicted.length
      ? { key: "landing.mergeConflictIn", values: { base, files: merged.conflicted } }
      : { key: "landing.mergeConflict", values: { base } };
    return { ...refuse(root, branch, why, gitErrorDetail(merged.lastStderr) || undefined), reason: "conflict" };
  }
  // A create job's folder is renumbered here, before the gate, on
  // every attempt (create-finalizer.ts says why).
  if (l.finalizeCreate) {
    const finalized = await finalizeCreateOnAttempt(run, l.finalizeCreate, { work, root, branch, base });
    if ("refused" in finalized) return finalized.refused;
    l.assignedSpecFolder = finalized.specFolder;
  }
  hooks?.progress?.("tests");
  // The tests run HERE, once per attempt, on what main is about to
  // become — not in every step that touched the branch, and never
  // after the push. Red: the local merge is dropped and origin never
  // sees it; the branch is untouched, so implement can be run again
  // on it.
  const gated = await gateMerged(l, preMergeHead);
  if (gated) return gated === "rebuild" ? null : gated;
  const squashFailed = await squashIfAsked(l, preMergeHead);
  if (squashFailed) return squashFailed;
  hooks?.progress?.("push");
  return null;
}
