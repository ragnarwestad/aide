// What a job's row on Jobs offers, in one place: the one button the row
// shows, and what lies in its card menu. The page draws from it and the
// server refuses anything it does not offer, so the two cannot disagree.
// A spec's own row and a group's card decide theirs elsewhere; this is the
// row of a scheduled job, a deploy and a Merge.

import { automaticProviderWait, canCancelDeploy, inFlight } from "./activity.ts";

export type JobAction = "cancel" | "start" | "remove";

export interface JobActions {
  /** The row's one button. */
  button?: JobAction;
  /** What the card's menu holds. */
  menu: JobAction[];
}

export interface JobActionRow {
  state: string;
  steps: readonly string[];
  stepIndex: number;
  landing?: boolean;
  landPushStarted?: boolean;
  errorReason?: string;
  stopReason?: string;
  usageLimitWait?: { until: string };
  deploy?: { restartedAt?: string };
  removedAt?: string;
  /** A Merge's branch is no longer on origin: Start has nothing to merge. */
  branchGone?: boolean;
}

const NONE: JobActions = { menu: [] };

export function jobActions(row: JobActionRow): JobActions {
  if (row.removedAt) return NONE;
  const step = row.steps[row.stepIndex] ?? row.steps.at(-1);
  if (step === "schedule") {
    if (inFlight(row) || automaticProviderWait(row)) return { button: "cancel", menu: [] };
    if (row.state === "cancelled") return { button: "start", menu: ["remove"] };
    return row.state === "failed" ? { button: "remove", menu: [] } : NONE;
  }
  if (step === "deploy") {
    if (inFlight(row)) return canCancelDeploy(row) ? { button: "cancel", menu: [] } : NONE;
    return row.state === "failed" || row.state === "cancelled" ? { button: "remove", menu: [] } : NONE;
  }
  if (step === "land") {
    if (inFlight(row)) return row.landPushStarted ? NONE : { button: "cancel", menu: [] };
    if (row.state !== "failed" && row.state !== "cancelled") return NONE;
    return row.branchGone ? { button: "remove", menu: [] } : { button: "start", menu: ["remove"] };
  }
  return NONE;
}

/** Whether `action` is on the row at all, as its button or in its menu. */
export function offers(row: JobActionRow, action: JobAction): boolean {
  const { button, menu } = jobActions(row);
  return button === action || menu.includes(action);
}
