// What a page that follows its job tells the page script, and which parts of
// it the script may swap. A job page and a spec's Steps tab draw the marker
// while their job is in flight and nothing otherwise: a page whose job is
// not in flight asks the server for nothing at all.

import { inFlight } from "../../ui/job-state";
import type { QueueRowView } from "../../ui/job-state/types.ts";
import { phaseKey } from "../specs-list/phase-messages/keys.ts";
import { resolveOpenStep } from "./steps-table.ts";

/** The marker, while `job` is queued, running or landing.
 *
 *  - `data-tab` is the tab drawn.
 *  - `data-running` is the index the running step has among the results
 *    (`runningIndex`), while one runs.
 *  - `data-phases` is the job's phase keys, only on the Steps tab with the
 *    running row open: the page script names them on the event stream, and
 *    nothing else on a page grows. On Overview, or with a row shut or a
 *    finished row open, the page hears only the job moving. */
export function followMarker(
  job: QueueRowView,
  o: { tab: string; step?: string; runningIndex?: number },
): string {
  if (!inFlight(job)) return "";
  const open = o.tab === "steps" && o.runningIndex !== undefined && resolveOpenStep(o.step, o.runningIndex) === String(o.runningIndex);
  const attrs =
    ` data-tab="${o.tab}"` +
    (o.runningIndex !== undefined ? ` data-running="${o.runningIndex}"` : "") +
    (open ? ` data-phases="${job.steps.map((s) => phaseKey(job.project, job.specFolder, s)).join(",")}"` : "");
  return `<span hidden data-follow${attrs}></span>`;
}

/** A part the page script swaps by itself, and that draws no box of its own
 *  (`display: contents`). A `<span>` where the part sits in a line. */
export const followPart = (name: "head" | "panel", html: string, tag: "div" | "span" = "div"): string =>
  `<${tag} data-follow-part="${name}">${html}</${tag}>`;
