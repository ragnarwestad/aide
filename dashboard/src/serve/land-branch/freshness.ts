// Everything about a spec that only git can answer, asked once per
// spec over the same checkout.

import { resolveWorkflowState } from "../../git/workflow-history.ts";
import type { QueueTarget } from "../../render.ts";
import type { LandContext } from "./types.ts";

/** Everything about a spec that only git can answer, asked once per
 *  spec over the same checkout.
 *
 *  Spec 154: which steps it has HAD. The runner commits every step it
 *  finishes, with the outcome in the subject, and that commit exists
 *  whether or not the model reached the instruction that writes
 *  `4-status.md` — which is what makes it the record and the file the
 *  claim. The file is still read (`fileSteps`), for one purpose: a
 *  row whose file and history disagree says so.
 *
 *  Spec 97: whether the plan is still about the problem the
 *  description states. A description committed after the last
 *  finished analyze means the plan on disk answers an older question,
 *  so the two phases that produced it stop counting as done and the
 *  row pre-ticks `analyze` again.
 *
 *  Applied here rather than inside `targets()` for two reasons: that
 *  scan is cached for five seconds and must stay a pure function of
 *  what is on disk, and it is handed to the queue as a SYNCHRONOUS
 *  resolver — making it async to ask git would thread `await` through
 *  the enqueue path for a signal enqueueing has no use for.
 *
 *  A stale description takes back `analyze` only.
 *  `implement` is deliberately untouched: nothing here blocks running
 *  a spec whose description change turns out to be cosmetic.
 *
 *  A spec with no `dir` — a create job's spec, which is the folder the
 *  job is making — has no history to read and keeps the empty
 *  done-set it arrived with. */
export function withFreshness(ctx: LandContext, list: QueueTarget[]): QueueTarget[] {
  return list.map((t) => {
    if (!t.dir) return t;
    // Spec 302: the one canonical `{done, stopped, fileDisagrees,
    // fileSteps}` — the `create` special case included — resolved from
    // the same two peeks this used to assemble by hand (spec 208: peeks,
    // never the async methods — a render reads memory and disk and
    // nothing else; `refreshSpecCaches` is what keeps these fed, on a
    // schedule of its own). `null` when nothing has ever been asked
    // about this spec: not "no step has run" — that is a real answer
    // with a real, empty history — and the row draws "checking…" rather
    // than a false negative, which is the class of bug spec 178's own
    // plan review flagged.
    const resolved = resolveWorkflowState(
      ctx.workflowHistory, ctx.branchFileSteps, t.dir, t.specFolder, t.reopenedAfter, t.fileSteps,
    );
    if (!resolved) return { ...t, freshnessUnknown: true };
    const createdAtPeek = ctx.specCreatedAt.peekCreatedAt(t.dir, t.specFolder);
    const withHistory: QueueTarget = {
      ...t,
      // Not `...resolved`: `resolved.fileSteps` is the prose half alone
      // (spec 362, `resolveWorkflowState`'s own `answer.proseSteps`),
      // and nothing downstream ever reads `QueueTarget.fileSteps` again
      // once resolved — only `fileDisagrees` reaches the row. Spreading
      // it would overwrite `t.fileSteps`'s own `FileStepsAnswer` with a
      // bare array, which is not what that field is typed to hold.
      done: resolved.done,
      stopped: resolved.stopped,
      fileDisagrees: resolved.fileDisagrees,
      historyDone: resolved.historyDone,
      // What the "Started" column holds (spec 199). Null when git
      // could not answer — a shallow clone, a folder moved without
      // `git mv` — and then the cell shows a dash rather than a
      // job's own time, which is the field this replaces.
      createdAt: createdAtPeek.createdAt ?? undefined,
      // Spec 317: "checking…" versus a real "cannot date" — the same
      // distinction the Created cell draws for an archived row, kept
      // for a live one too rather than losing `checkedAt` the moment
      // it reaches `QueueTarget`.
      createdAtChecking: createdAtPeek.checkedAt === null,
    };
    if (!ctx.freshness.peekStale(t.dir, t.specFolder, t.reopenedAfter).stale) return withHistory;
    return {
      ...withHistory,
      analyzeStale: true,
      done: resolved.done.filter((s) => s !== "analyze"),
    };
  });
}
