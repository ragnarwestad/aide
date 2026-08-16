// What a queued job looks like to a page, and how its state is put into
// words. Both the list and the single-job page need this, and neither
// owns it.

import { esc } from "./html.ts";

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
  branchUrl?: string;
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
