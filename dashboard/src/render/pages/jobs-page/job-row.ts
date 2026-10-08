// A wiki or scheduled job's row on the Jobs tab, in the Specs list's own
// shape: a title line, a state line and a gap, in the same columns. It has no
// spec folder, phases or target for the list's row builder to read, so it is
// drawn here from the job alone and with the classes the list already has.
// The `spechead` class and the `spec-<project>/<folder>` id make the page
// script treat it as a spec's row: it redraws it by that id and writes a
// refused Stop under it.

import { t, type Language } from "../../../i18n";
import { ACCEPTANCE_CRITERIA_UNTICKED } from "../../../queue/steps.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../project/parse-status";
import { isWikiBuild } from "../../../queue/steps.ts";
import { askButton, confirmDialog, stepLabel } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { currentStep, durationLabel, inFlight, specStateChip, type QueueRowView } from "../../ui/job-state";
import { landingStep } from "../../ui/job-state/resting.ts";
import { costCell } from "../specs-list/cell-helpers.ts";
import { LIST_COLUMNS } from "../specs-list/row-shared.ts";
import { jobControl, jobHome, jobTitle } from "./rows.ts";

export interface JobRowOptions {
  /** A spec's own title, by project and folder. */
  titleOf: (project: string, specFolder: string) => string | undefined;
  lang: Language;
  now: number;
}

/** Stop or Cancel with the question it asks first. The dialog's OK posts the
 *  cancel route as the list's Cancel does, and the rows are redrawn in place. */
function control(row: QueueRowView, kind: "stop" | "cancel", lang: Language): string {
  const id = `jobask-${row.id}`;
  const step = stepLabel(row.landing ? landingStep(row) : currentStep(row), lang);
  const stop = kind === "stop";
  return (
    askButton({ label: t(lang, stop ? "jobs.stop" : "list.cancel"), dialogId: id, variant: "primary" }) +
    confirmDialog(lang, {
      id,
      title: t(lang, stop ? "jobs.stopConfirmTitle" : "list.cancelConfirmTitle", { step }),
      sentence: t(lang, "jobs.confirmBody"),
      ok: { variant: "primary", pending: t(lang, stop ? "jobs.stopping" : "list.cancelling") },
      post: { action: `/api/queue/${row.id}/cancel`, hook: "actionform" },
    })
  );
}

/** The job's own time: counting from its start while it goes, its span once
 *  it has ended, a dash before it has started. */
function timeCell(row: QueueRowView, now: number): string {
  if (!row.startedAt) return "–";
  const start = Date.parse(row.startedAt);
  if (inFlight(row)) {
    return `<span class="muted small" data-elapsed="${esc(row.startedAt)}">${durationLabel(Math.max(0, now - start))}</span>`;
  }
  const end = Date.parse(row.finishedAt ?? row.results?.at(-1)?.at ?? "");
  return Number.isNaN(end) ? "–" : `<span class="muted small">${durationLabel(Math.max(0, end - start))}</span>`;
}

/** The word of the link to the place the job belongs. */
function homeWord(row: QueueRowView, lang: Language): string {
  if (isWikiBuild(row)) return t(lang, "jobs.linkWiki");
  if (row.steps.length === 1 && row.steps[0] === "schedule" && row.specFolder.startsWith("schedule-")) {
    return t(lang, "shell.tabSchedule");
  }
  return jobHome(row) === "/specs" ? t(lang, "shell.tabSpecs") : t(lang, "jobs.linkSpec");
}

export function jobRow(row: QueueRowView, o: JobRowOptions): string {
  const { lang } = o;
  const heldBack =
    row.state === "done" && row.results?.at(-1)?.terminalReason === ACCEPTANCE_CRITERIA_UNTICKED
      ? { archiveHeldBack: ACCEPTANCE_CRITERIA_UNTICKED_NOTE }
      : {};
  const kind = jobControl(row);
  return (
    `<tr class="spechead" id="spec-${esc(row.project)}/${esc(row.specFolder)}">` +
    `<td class="foldcell" rowspan="2" data-col="fold"></td>` +
    `<td colspan="${LIST_COLUMNS - 1}"><div class="spec-name"><span class="label"><span class="specpart">` +
    `<span class="specname">${esc(jobTitle(row, lang, o.titleOf))}</span></span></span></div>` +
    `<div class="spec-title"><a data-goto href="/jobs/${esc(row.id)}?tab=steps">${t(lang, "job.tabLog")}</a> · ` +
    `<a data-goto href="${esc(jobHome(row))}">${esc(homeWord(row, lang))}</a></div></td></tr>` +
    `<tr class="specstate"><td colspan="2"></td>` +
    `<td data-col="state"><span class="badgeslot">${specStateChip(row, lang, heldBack)}</span>` +
    `${kind ? `<span class="actionslot">${control(row, kind, lang)}</span>` : ""}</td>` +
    `<td data-col="started">${timeCell(row, o.now)}</td>` +
    `<td class="num" data-col="cost">${costCell(row.spentUsd, row.spentTokens, "–")}</td></tr>` +
    `<tr class="specgap" aria-hidden="true"><td colspan="${LIST_COLUMNS}"></td></tr>`
  );
}
