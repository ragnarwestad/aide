// What a queued job looks like to a page, and how its state is put into
// words. Both the list and the single-job page need this, and neither
// owns it.

import { badge, stepLabel, stepLabels, type BadgeVariant } from "./components.ts";

/** One repo a spec pushed a branch to, as a page sees it: a NAME and a
 *  link, never the path git will be run in. The server re-derives every
 *  root itself when the Merge button posts back. */
export interface BranchView {
  /** The repo's directory basename — `aide`, `aide-specs`. */
  label: string;
  url: string;
  /** Whether THAT repo's branch has landed on THAT repo's default
   *  branch. One flag per repo: a spec whose project branch merged and
   *  whose specs branch did not is the case this exists for. */
  merged: boolean;
  /** Where this branch can be TRIED, when the project's host builds a
   *  preview per branch (`.aide/project.yaml`'s `deployment.preview`).
   *  Set only on the repo that IS the project's own code — a repo
   *  holding a plan has nothing to try. */
  previewUrl?: string;
}

export interface QueueRowView {
  id: string;
  project: string;
  specFolder: string;
  /** What a `create` job is making, in words. A create job's
   *  `specFolder` is a provisional key until the spec lands, and a row
   *  labelled `new-abc123de` tells the reader nothing about what is
   *  running. Absent on every other job, whose spec has a real name. */
  createTitle?: string;
  steps: string[];
  stepIndex: number;
  state:
    | "queued" | "running" | "awaiting-approval" | "done"
    | "stopped" | "failed" | "cancelled" | "interrupted";
  spentUsd: number;
  timeoutSec: number;
  createdAt: string;
  startedAt?: string;
  stopReason?: "budget" | "timeout";
  /** Every repo this job pushed to, one entry each — a list even when it
   *  holds one, because `paceup` and `atlasaurus` (specs inside the
   *  project repo, one branch per job) are the NORMAL shape and must
   *  render through the same code as a two-repo job, not a fork of it.
   *  Derived live from git at render time, never stored on the job: the
   *  answer changes long after the job stops running. */
  branchUrls?: BranchView[];
  error?: string;
  /** What this job ran on. Shown next to the cost, because a figure
   *  without its model cannot be compared with the next one. */
  model?: string;
  /** One entry per step the job has FINISHED, in the order they ran.
   *  A job is not one step: `steps[stepIndex]` names only the last one
   *  it reached, and placing a two-step job by that alone left the
   *  first step's line speaking for an older attempt (measured on spec
   *  90, 2026-08-17: a finished analysis read as failed). */
  results?: StepResultView[];
}

/** The little of a step's result the LIST needs. The job page's
 *  `JobStepResultView` carries more and stays assignable to this — one
 *  shape, seen at two altitudes. `step` is optional because a result
 *  written by an older runner has no step name; such an entry matches no
 *  phase rather than the wrong one. */
export interface StepResultView {
  step?: string;
  ok: boolean;
  costUsd: number;
}

// A stopped job is NOT a failed one, and the two must never render as
// the same string: with tight caps a cap-stop is a common, healthy
// outcome, and a reader who cannot tell them apart ignores both.
export function stateLabel(r: QueueRowView): string {
  if (r.state === "awaiting-approval") return "waiting for approval";
  if (r.state === "stopped") {
    return r.stopReason === "timeout"
      ? `stopped — ${Math.round(r.timeoutSec / 60)} min`
      : "stopped — budget";
  }
  return r.state;
}

// A wall of identical grey rows hides the one thing you came to see.
// Colour carries the state; the label still says it in words, so the
// colour is never the only signal.
//
// Ten states, six badge variants. Five of them had an example on the
// design sheet; the other four are decided here and asserted by name in
// `test/design-system.test.ts`, because a mapping nobody drew is a
// mapping nobody checked:
//
//   stopped     — a cap-stop is a common, healthy outcome (see
//                 `stateLabel` above), so it takes the same amber as
//                 waiting: notice, not alarm.
//   failed      — a real failure, so danger.
//   interrupted — grouped with failed, as it always was.
//   cancelled   — a deliberate ending someone chose, not a failure.
export const BADGE_VARIANT: Record<QueueRowView["state"], BadgeVariant> = {
  queued: "idle",
  running: "running",
  "awaiting-approval": "waiting",
  done: "done",
  stopped: "waiting",
  failed: "refused",
  cancelled: "idle",
  interrupted: "refused",
};

export function stateChip(r: QueueRowView): string {
  return badge(BADGE_VARIANT[r.state], stateLabel(r));
}

/** A spec that exists and has never been run. It is this page's own
 *  pseudo-state, so it has no `QueueRowView` to hand `stateChip` — but
 *  it must render through the same component, or the one row with no
 *  job would be the one row with hand-written markup. */
export const notStartedChip = (): string => badge("idle", "not started");

/** Which states mean "still going". The list page's "Active" filter is
 *  built from this rather than the other way round: a state added to one
 *  and forgotten in the other is exactly the drift neither page can
 *  afford, and the single-job page needs the same test without importing
 *  the list's filter vocabulary. */
export const IN_FLIGHT: QueueRowView["state"][] = ["queued", "running", "awaiting-approval"];

export const inFlight = (r: QueueRowView): boolean => IN_FLIGHT.includes(r.state);

/** The step a job is on, or — once it has stopped — the last one it
 *  reached. */
export function currentStep(r: QueueRowView): string {
  return r.steps[r.stepIndex] ?? r.steps[r.steps.length - 1] ?? "–";
}

/** What this job is doing, in words: the step and the state together,
 *  e.g. `review-plan running`. Both pages ask this one function, for the
 *  same reason `stateLabel` exists — a spec's state and a phase's state
 *  are the same question at two altitudes and must never be worded
 *  differently. A job waiting for approval is the one exception: the
 *  state already says everything, and naming the step it stopped after
 *  reads as though that step were still going. */
export function activityLabel(r: QueueRowView): string {
  return r.state === "awaiting-approval"
    ? stateLabel(r)
    : `${stepLabel(currentStep(r))} ${stateLabel(r)}`;
}

// A branch link says where the work IS, never whether it landed, so a
// finished job reads as a delivered one. The caveat sits beside the link
// on both pages, and disappears the moment the branch is an ancestor of
// the default branch — which is the whole point of asking git live.
// Anything unproven keeps the caveat: uncertainty must not read as done.
//
// Per REPO, not per job: one badge over two repos cannot say that the
// project's branch landed and the specs repo's did not, and that is
// exactly the state that went unnoticed three times on 2026-08-17.
//
// It used to say "not merged" whatever the job was doing — a fact about
// the BRANCH, read as a verdict on the spec. Beside a step that was
// still writing to that branch it said nothing about the one thing that
// decided whether merging made sense, so the badge is handed the job's
// activity and says that instead; "ready to merge" is what is left once
// there is no activity to report.
export function unmergedBadge(b: BranchView, activity?: string): string {
  if (b.merged) return "";
  if (activity) return ` ${badge("running", activity)}`;
  return ` ${badge("ready", "ready to merge")}`;
}

/** The badge's second argument, worked out from the job that owns the
 *  branch — written once so the two pages cannot drift on when a job
 *  counts as busy any more than on what to call it. */
export const branchActivity = (r: QueueRowView): string | undefined =>
  inFlight(r) ? activityLabel(r) : undefined;

/** The one line a reader should be able to stop at: what is going on,
 *  and what the next click is. Everything else on the row answers a
 *  narrower question — the pips say what has run, the chip says the
 *  state, the badges say what is unmerged — and a reader had to
 *  assemble the answer from all of them.
 *
 *  Built from `activityLabel`/`currentStep` rather than from new
 *  literals, for the same reason those exist: the same job must not be
 *  worded one way in the chip and another way here. It says nothing the
 *  row does not already contain — it says it in one place, as a
 *  sentence.
 *
 *  `openBranch` is the spec's, not the job's: whether anything this spec
 *  pushed is still sitting unmerged. A finished job with nothing left
 *  out must not be told to merge something. */
export function nextActionHint(r: QueueRowView | undefined, openBranch = false): string {
  if (!r) return "never run — tick a phase and press Run";
  if (r.state === "awaiting-approval") return "waiting for your approval to carry on";
  if (r.state === "queued" || r.state === "running") {
    const rest = r.steps.slice(r.stepIndex + 1);
    return rest.length
      ? `${activityLabel(r)} — ${stepLabels(rest).join(", ")} to follow`
      : activityLabel(r);
  }
  if (r.state === "done") {
    return openBranch ? "done — the branch is waiting to be merged" : "done — nothing waiting on you";
  }
  // failed, stopped, cancelled, interrupted: the chip beside this line
  // already says which of the four it was, and the row's own error text
  // says why. What is missing is what to do about it.
  return `press Run to try ${stepLabel(currentStep(r))} again`;
}
