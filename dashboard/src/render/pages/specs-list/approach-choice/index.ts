// The approaches a ticked spec's analysis found, under the waiting line on
// its row: one radio button per real alternative, the recommended one
// picked, each linked to its lead on the Solution tab, and Save and
// Cancel. Save posts the pick to the approach route; Cancel puts the
// recommended one back (`specs-client/approach-choice/`).

import { labelledRadio, saveCancelActions } from "../../../ui/components";
import { esc } from "../../../ui/html.ts";
import { t, type Language } from "../../../../i18n";
import { specTabPath } from "../../spec-page";
import type { QueueRowView } from "../../../ui/job-state";
import type { SpecGroup } from "../data-model";

/** Where an approach's lead is on the spec page's Solution tab. */
export const approachHref = (project: string, folder: string, letter: string): string =>
  `${specTabPath(project, folder, "solution")}#approach-${letter.toLowerCase()}`;

/** The form's id, which its radios name with `form=` too, so a pick is
 *  remembered per spec across a redraw. */
export const approachFormId = (g: Pick<SpecGroup, "project" | "specFolder">): string =>
  `approach-${g.project}-${g.specFolder}`;

/** A step of the spec is running or landing: the one state the choice
 *  waits out. A job merely queued — the one held for this very choice —
 *  is not it. */
export const stepRunsOrLands = (g: SpecGroup, steps?: string[]): boolean =>
  g.phases.some(
    (p) => (!steps || steps.includes(p.step)) && p.attempts.some((a) => a.state === "running" || !!a.landing),
  );

/** The lead job is the one the runner holds for this choice. */
const heldForChoice = (lead: QueueRowView | undefined): boolean => {
  const error = lead?.error;
  return (
    lead?.state === "queued" &&
    lead.errorReason === "held-back" &&
    typeof error === "object" &&
    error !== null &&
    !Array.isArray(error) &&
    (error as { key?: unknown }).key === "runner.approachChoice"
  );
};

/** Whether the row carries the waiting line: a choice is pending, no
 *  Analyze or Implement runs or lands, and either a job is held for the
 *  choice or no Implement has completed since — an Implement that has run
 *  without a choice ended the question. */
export function approachChoiceShown(g: SpecGroup): boolean {
  if (!g.approachChoice?.length || stepRunsOrLands(g, ["analyze", "implement"])) return false;
  const implementDone = g.phases.find((p) => p.step === "implement")?.history.historyDone === true;
  return heldForChoice(g.lead) || !implementDone;
}

export interface ApproachItem {
  letter: string;
  title: string;
  href: string;
  checked: boolean;
  recommended: boolean;
}

/** One item per real alternative, in the plan's order, the recommended
 *  one picked. */
export function approachItems(g: SpecGroup): ApproachItem[] {
  return (g.approachChoice ?? []).map((a) => ({
    letter: a.letter,
    title: a.title,
    href: approachHref(g.project, g.specFolder, a.letter),
    checked: a.mark === "recommended",
    recommended: a.mark === "recommended",
  }));
}

/** The form under the waiting line. While a step runs or lands, the
 *  radios are drawn disabled and there is nothing to save. */
export function approachPanel(g: SpecGroup, lang: Language): string {
  const id = approachFormId(g);
  const locked = stepRunsOrLands(g);
  const items = approachItems(g)
    .map(
      (item) =>
        `<li>` +
        labelledRadio({
          label: `${item.letter}: ${item.title}`,
          name: "approach",
          value: item.letter,
          checked: item.checked,
          disabled: locked,
          form: id,
          href: item.href,
        }) +
        (item.recommended ? ` <span class="muted">${esc(t(lang, "list.approachRecommended"))}</span>` : "") +
        `</li>`,
    )
    .join("");
  return (
    `<form class="actionform approachform" id="${esc(id)}" method="post" ` +
    `action="/api/queue/specs/${esc(g.project)}/${esc(g.specFolder)}/approach">` +
    `<ul class="approachlist">${items}</ul>` +
    (locked ? "" : saveCancelActions(id)) +
    `</form>`
  );
}
