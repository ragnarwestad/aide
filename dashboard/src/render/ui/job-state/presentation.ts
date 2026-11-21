import { landingStepIndex } from "../../../format/gerund.ts";
import type { QueueRowView } from "./types.ts";
import { inFlight, writing, automaticProviderWait } from "../../../queue/job-rules/activity.ts";
import { heldBackResolvesOnItsOwn } from "../../../messages/jobs/holds.ts";

type Facts = Pick<QueueRowView, "state"> & Partial<Pick<QueueRowView,
  "stopReason" | "usageLimitWait" | "landing" | "stepIndex" | "queuePosition" | "waitingPhases" | "errorReason" | "error" | "mergeActivity"
>> & { steps?: readonly string[]; results?: readonly { terminalReason?: string }[] };
type State = QueueRowView["state"] | "needs-action" | "testing" | "merging";
export interface JobPresentation {
  state: State;
  queued: boolean;
  variant: "idle" | "running" | "done" | "waiting" | "refused";
  waiting?: QueueRowView["queuePosition"];
}
const variants = { queued: "idle", running: "running", done: "done", waiting: "waiting", failed: "refused", cancelled: "waiting", "needs-action": "waiting", testing: "running", merging: "running" } as const;

/** Presentation only: a place in the queue does not imply automatic progress. */
export function jobPresentation(row: Facts, step?: string, position?: QueueRowView["queuePosition"]): JobPresentation {
  const current = row.steps?.[row.stepIndex ?? 0];
  const displayed = step ?? (row.landing ? row.steps?.[landingStepIndex(row.state, row.stepIndex ?? 0)] : current);
  const candidate = position ?? (step ? row.waitingPhases?.[step] : undefined) ?? row.queuePosition;
  const waiting = !displayed || (candidate?.operation ?? current) === displayed ? candidate : undefined;
  const relevant = !displayed || displayed === current || !!waiting;
  const retry = automaticProviderWait(row);
  const active = inFlight(row) || retry;
  const terminal = row.results?.at(-1)?.terminalReason;
  let state: State = row.landing ? "running" : row.state;
  if (relevant && (active || row.state === "done" || row.state === "failed")) {
    if ((row.errorReason === "held-back" && !heldBackResolvesOnItsOwn(row)) ||
        (!row.landing && (row.state === "done" || row.state === "failed") && ["acceptance-criteria-unticked", "approach-choice"].includes(terminal ?? ""))) {
      state = "needs-action";
    } else if (retry) {
      // A usage-limit wait goes on by itself once the limit resets: Waiting, not a place in the queue.
      state = "waiting";
    } else if (current === "deploy" && row.state === "running") {
      // A deploy held back behind a landing is running: it has begun, and Cancel stops it.
      state = "running";
    } else if ((active || row.state === "done") && (waiting || heldBackResolvesOnItsOwn(row) || (row.state === "queued" && !row.landing))) {
      state = "queued";
    } else if (row.steps?.[0] === "land" && writing(row)) {
      state = row.mergeActivity ?? "running";
    }
  }
  return { state, queued: state === "queued", variant: variants[state], ...(state === "queued" && waiting ? { waiting } : {}) };
}
