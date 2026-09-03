// State labels, durations, the state chip, and "is this job still
// going".

import { badge, type BadgeVariant } from "../components.ts";
import type { QueueRowView } from "./types.ts";

// A stopped job is NOT a failed one, and the two must never render as
// the same string: with tight caps a cap-stop is a common, healthy
// outcome, and a reader who cannot tell them apart ignores both.
export function stateLabel(r: QueueRowView): string {
  if (r.state === "stopped") {
    if (r.stopReason === "timeout") return `stopped — ${Math.round(r.timeoutSec / 60)} min`;
    if (r.stopReason === "provider-limit") return "stopped — provider limit";
    if (r.stopReason === "job-cap") return "stopped — job cap";
    if (r.stopReason === "not-implemented-yet") return "stopped — not implemented yet";
    if (r.stopReason === "acceptance-criteria-unticked") return "stopped — acceptance criteria unticked";
    return "stopped — budget";
  }
  return r.state;
}

/** How long, in words (spec 199). "45s", "4m12s", "1h04m" — the unit
 *  above the one being read is always there, so two figures beside each
 *  other compare without anyone counting digits.
 *
 *  Seconds are dropped past the hour on purpose: a step that ran for
 *  two hours is not a figure anybody reads to the second, and the
 *  column it sits in is the narrowest on the page.
 *
 *  HAND-PAIRED with `formatElapsed` in `src/queue-client/elapsed.ts`,
 *  which rewrites a running phase's mark once a second and cannot
 *  import this one — it runs in the browser, bundled from a separate
 *  entry point, not in the same process as this file. The two are
 *  pinned by `test/queue-client/live-redraw.test.ts`, "the page words a
 *  duration exactly as the server does". Change one and
 *  change the other, or a phase changes its wording the first time the
 *  clock ticks over the figure the server drew. */
export function durationLabel(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const pad = (n: number): string => String(n).padStart(2, "0");
  if (secs < 3600) return `${Math.floor(secs / 60)}m${pad(secs % 60)}s`;
  return `${Math.floor(secs / 3600)}h${pad(Math.floor((secs % 3600) / 60))}m`;
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
  done: "done",
  stopped: "waiting",
  failed: "refused",
  cancelled: "idle",
  interrupted: "refused",
};

export function stateChip(r: QueueRowView): string {
  return badge(BADGE_VARIANT[r.state], stateLabel(r), r.state === "stopped" ? r.error : undefined);
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
export const IN_FLIGHT: QueueRowView["state"][] = ["queued", "running"];

export const inFlight = (r: QueueRowView): boolean => IN_FLIGHT.includes(r.state) || !!r.landing;

/** The step a job is on, or — once it has stopped — the last one it
 *  reached. */
export function currentStep(r: QueueRowView): string {
  return r.steps[r.stepIndex] ?? r.steps[r.steps.length - 1] ?? "–";
}
