// The status badge: a state's word, its colour, and its icon.

import { esc } from "../html.ts";
import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { stateIconName } from "./state-icon.ts";

/** The six the design sheet defines. Every job state maps onto one of
 *  them (`job-state.ts`, `BADGE_VARIANT`) — a seventh would be a state
 *  the page has no word for. */
export type BadgeVariant = "idle" | "running" | "waiting" | "ready" | "refused" | "done";

/** The word, its colour, and the name of its icon (2026-09-25). A dot
 *  marked the four LIVE variants apart until 2026-09-07; the icon that
 *  replaced it says which state, not only whether it is live, and the
 *  stylesheet draws it from its name (status-badge.css), so the markup
 *  still holds nothing but the word. */
export function badge(variant: BadgeVariant, label: string, title?: string): string {
  const icon = stateIconName(label);
  return (
    `<span class="badge b-${variant}"${title ? ` title="${esc(title)}"` : ""}${icon ? ` data-icon="${icon}"` : ""}>` +
    `${esc(capitalizeFirst(label))}</span>`
  );
}
