// How a landing settles on its job: the failure it records, the landed
// state it writes, and what a landing that threw leaves behind.

import { join } from "node:path";
import type { Job } from "../../../queue/queue.ts";
import { formatSentence, type Sentence } from "../../../messages/format.ts";
import { STATUS_FILE } from "../../../project/spec-names.ts";
import { specFileText } from "../../../project/discover";
import { isJobStop } from "../../../step-endings.ts";
import type { LandContext, Landing } from "../types.ts";
import { clearsLandingError, firstLandingError, keepsItsStopReason } from "../stopped-reason.ts";
import { takeLandingCancel } from "../cancel-landing.ts";
import { retryArchiveLanding } from "../retry";
import type { LandingRun } from "./run.ts";

interface LandingErrorRecord {
  landingError: Sentence | Sentence[];
  landingErrorStep: Job["landingErrorStep"];
  landingErrorDetail: string | undefined;
}

/** The permanent record of this landing's failure, kept beside whatever
 *  record the job already carries (`stopped-reason.ts`). */
function landingErrorRecord(
  ctx: LandContext,
  job: Job,
  what: Landing,
  msg: Sentence | Sentence[],
  detail: string | undefined,
): LandingErrorRecord {
  return {
    landingError: firstLandingError(ctx.queue.get(job.id)?.landingError, msg, what.step),
    landingErrorStep: ctx.queue.get(job.id)?.landingError ? ctx.queue.get(job.id)?.landingErrorStep : what.step,
    landingErrorDetail: ctx.queue.get(job.id)?.landingErrorDetail ?? detail,
  };
}

/** The runner may already have queued this job's next step, or held it
 *  for a reason of its own, in the gap between this step's own
 *  completion and this landing settling (job-states.md, "Done to
 *  failed"). `error`/`errorReason`/`stopReason` say what the row is
 *  waiting for RIGHT NOW, and a job that has moved on is waiting for
 *  something else — only `landingError`, the permanent record of this
 *  attempt, survives onto it. */
function keepRecordOnly(ctx: LandContext, job: Job, ok: boolean, record: LandingErrorRecord): void {
  if (!ok) ctx.queue.update(job.id, { landingError: record.landingError, landingErrorStep: record.landingErrorStep, landingErrorDetail: record.landingErrorDetail });
}

/** Whatever the success path would have written is NOT written: a
 *  create job keeps its provisional key, because the job is still the
 *  only handle on a branch that has not landed, and renaming it to a
 *  folder the page cannot see would hide the work rather than report
 *  it. The branch stays on the row either way.
 *
 *  `errorReason` is STORED rather than carried in a redirect, and that
 *  is the whole difference between this and the Merge button's
 *  redirect: nobody's browser is attached to a landing, so the row has
 *  to be able to read the reason on any later request (`specs-list.ts`,
 *  `resolveForm`).
 *  A red suite is the one failure here that is not a fault: the step
 *  ran, the merge was built, and the project's own tests said the
 *  result is not green. That stops the job rather than failing it, the
 *  same way a cap-stop does: nothing was pushed. */
export function recordLandingFailure(run: LandingRun): void {
  const { ctx, job, what, tally } = run;
  const { landingTerminalReason } = tally;
  const held = isJobStop(landingTerminalReason);
  // One message per row: the first failure is the row's sentence,
  // and any further one — a second root that could not merge —
  // goes behind it as detail, in the catalog's source language,
  // rather than joined onto the sentence with a semicolon.
  const [first, ...rest] = tally.failures as [Sentence, ...Sentence[]];
  const detail = [...rest.map((f) => formatSentence("en", f) ?? ""), ...tally.failureDetails].filter(Boolean);
  const record = landingErrorRecord(ctx, job, what, first, detail.length ? detail.join("\n") : undefined);
  const patch = {
    error: first,
    errorDetail: detail.length ? detail.join("\n") : undefined,
    errorReason: tally.reason,
    ...record,
    ...(held ? { stopReason: landingTerminalReason } : {}),
  };
  const cancelled = takeLandingCancel(job.id);
  if (!cancelled && landingTerminalReason && retryArchiveLanding(ctx.queue, job.id, what.step, landingTerminalReason, [formatSentence("en", first), ...detail].filter(Boolean).join("\n"))) return;
  const result = cancelled ? ctx.queue.transition(job.id, "landing-cancelled", { finishedAt: new Date().toISOString() }) : ctx.queue.transition(job.id, held ? "landing-held" : "landing-failed", patch);
  keepRecordOnly(ctx, job, result.ok, record);
}

/** Landed. The branch is on the default branch now, so the job stops
 *  advertising one: a compare page for a merged branch shows nothing,
 *  and the row would otherwise name a branch it can no longer derive
 *  (`specBranch` reads the RENAMED folder).
 *  ...except what was deliberately left open, which still has a branch
 *  and still wants naming: the row is where a reader learns the code is
 *  waiting on a review rather than already on the default branch. */
export async function recordLanded(run: LandingRun): Promise<void> {
  const { ctx, job, what, plan, tally } = run;
  const stillOpen = plan.repos.filter((repo) => plan.leaveOpen(repo.root));
  // And the review it is waiting on is named on THIS job, whichever
  // job opened it. `implement` pushed the code and called `gh`;
  // `archive` is the row a reader is looking at when the spec goes
  // quiet, and a link they have to go hunting for on an older row is
  // a link that is not there.
  const review = stillOpen.length ? ctx.queue.pullRequestFor(job.project, job.specFolder) : {};
  const keepsItsReason = keepsItsStopReason(ctx.queue.get(job.id));
  // This step's own landing resolves this step's own failure
  // (`stopped-reason.ts`).
  const cleared = clearsLandingError(ctx.queue.get(job.id), what.step);
  ctx.queue.update(job.id, {
    ...what.landed,
    ...cleared,
    branchUrl: stillOpen.length ? (stillOpen[0]!.url ?? job.branchUrl) : undefined,
    branchUrls: stillOpen,
    prUrl: review.prUrl,
    branchDeleteError: tally.deleteErrors.length ? tally.deleteErrors : undefined,
    ...(keepsItsReason ? {} : { error: undefined, errorReason: undefined }),
  });
  // The page caches its scan for five seconds. Without this the very
  // request that follows a landing would still not show the spec —
  // nor, for an archive, that it has left the list.
  ctx.invalidateScan();
  await refreshLandedSpec(ctx, job, what);
  await runOnLanded(job, what);
}

/** After the scan is invalidated, so anything this reads sees the
 *  landing rather than the five-second-old picture of the world before
 *  it.
 *
 *  `specFolder` is read from the landing, not the job: a create step's
 *  job still carries its provisional key here, and is only renamed once
 *  every repo is through the loop. Without this substitution the warm
 *  silently no-ops for every create landing — no directory exists yet
 *  under the provisional key. */
async function refreshLandedSpec(ctx: LandContext, job: Job, what: Landing): Promise<void> {
  const landedFolder = what.landed?.specFolder ?? job.specFolder;
  const landedRoot = ctx.machinerySpecsRoot(job.project);
  const landedDir = landedRoot
    ? [join(landedRoot, "archive", landedFolder), join(landedRoot, landedFolder)].find(
        (candidate) => specFileText(candidate, STATUS_FILE) !== null,
      )
    : undefined;
  // The landing moved the spec's history and its files: every cached
  // answer is due for a fresh read, under whichever of the two paths
  // the folder is read from now — before the warm, so the landed spec
  // is read again here rather than on the schedule's next pass.
  for (const dir of landedRoot ? [join(landedRoot, "archive", landedFolder), join(landedRoot, landedFolder)] : []) {
    ctx.forgetSpec(dir, landedFolder);
  }
  if (landedDir) await ctx.warmSpec({ dir: landedDir, specFolder: landedFolder });
}

async function runOnLanded(job: Job, what: Landing): Promise<void> {
  if (!what.onLanded) return;
  try {
    await what.onLanded();
  } catch (err) {
    console.error(
      `queue: landing ${job.project}/${job.specFolder} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** A landing that threw. Never rethrown: the `landing` flag holds this
 *  job's own next step, and the runner clears it when the landing's
 *  promise settles — which it must do, however this went. */
export function recordLandingThrew(ctx: LandContext, job: Job, what: Landing, err: unknown): void {
  if (what.cancelled?.()) return;
  if (takeLandingCancel(job.id)) {
    ctx.queue.transition(job.id, "landing-cancelled", { finishedAt: new Date().toISOString() });
    return;
  }
  const rawMsg = err instanceof Error ? err.message : String(err);
  const note = what.failedNote(rawMsg);
  const record = landingErrorRecord(ctx, job, what, note, rawMsg);
  const patch = {
    error: note,
    // Raw exception text — `note` itself carries
    // none, so a reader who needs the exact words has it on hover.
    errorDetail: rawMsg,
    // A thrown landing is not a conflict — the merge never got far
    // enough to be one, and offering Resolve for it would send a
    // whole run at a problem it cannot fix.
    errorReason: undefined,
    ...record,
  };
  const result = ctx.queue.transition(job.id, "landing-failed", patch);
  // Same reasoning as the ordinary failure: a job that has moved on
  // keeps only the permanent record.
  keepRecordOnly(ctx, job, result.ok, record);
}
