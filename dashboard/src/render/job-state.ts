// What a queued job looks like to a page, and how its state is put into
// words. Both the list and the single-job page need this, and neither
// owns it.

import { esc } from "./html.ts";

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
}

export interface QueueRowView {
  id: string;
  project: string;
  specFolder: string;
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
export function stateChip(r: QueueRowView): string {
  return `<span class="state s-${esc(r.state)}">${esc(stateLabel(r))}</span>`;
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
export function unmergedBadge(b: BranchView): string {
  if (b.merged) return "";
  return ` <span class="chip unmerged">not merged</span>`;
}
