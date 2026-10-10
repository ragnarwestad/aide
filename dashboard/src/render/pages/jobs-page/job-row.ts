// A wiki or scheduled job's row on the Jobs tab, in the Specs list's own
// shape: a title line, a state line and a gap, in the same columns. It has no
// spec folder, phases or target for the list's row builder to read, so it is
// drawn here from the job alone and with the classes the list already has.
// The `spechead` class and the `spec-<project>/<folder>` id make the page
// script treat it as a spec's row: it redraws it by that id and writes a
// refused Stop under it. A wiki or scheduled job's row folds as a spec's does,
// from the `open` key in the address: shut, it holds the title, state, time and
// cost; open, it adds the links and Stop or Cancel.

import { t, type Language } from "../../../i18n";
import { isWikiBuild } from "../../../queue/steps.ts";
import { askButton, confirmDialog, foldArrow, stepLabel } from "../../ui/components";
import { projectLink } from "../../ui/components/spec-name.ts";
import { esc } from "../../ui/html.ts";
import { currentStep, durationLabel, inFlight, specStateChip, type QueueRowView } from "../../ui/job-state";
import { landingStep } from "../../ui/job-state/resting.ts";
import { costCell } from "../specs-list/cell-helpers.ts";
import type { SpecsFilter } from "../specs-list";
import { queuePath } from "../specs-list/filter-bar.ts";
import { LIST_COLUMNS } from "../specs-list/row-shared.ts";
import { jobControl, jobHome, jobTitle } from "./rows.ts";
import { jobDurationMs, jobEndMs } from "./view.ts";

export interface JobRowOptions {
  lang: Language;
  now: number;
  /** How the rows are folded, from the address: `open` names the rows shown open. */
  filter: SpecsFilter;
  /** The page the row sits on, for its fold's address. */
  listPath: string;
}

const openKeys = (o: JobRowOptions): string[] => (o.filter.open ?? "").split(",").filter(Boolean);

/** The row's ›, as a spec's: a link that names the row in `open`, or takes it out. */
function fold(key: string, open: boolean, name: string, o: JobRowOptions): string {
  const next = open ? openKeys(o).filter((k) => k !== key) : [...openKeys(o), key];
  return foldArrow({
    href: queuePath(o.filter, { open: next.join(",") }, o.listPath),
    open,
    lang: o.lang,
    title: "jobs.foldTitle",
    params: { name },
    data: { fold: "open", key },
  });
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
 *  it has ended, a dash before it has started or with no recorded end. */
function timeCell(row: QueueRowView, now: number): string {
  if (!row.startedAt) return "–";
  if (inFlight(row)) {
    return `<span class="muted small" data-elapsed="${esc(row.startedAt)}">${durationLabel(jobDurationMs(row, now))}</span>`;
  }
  return Number.isNaN(jobEndMs(row)) ? "–" : `<span class="muted small">${durationLabel(jobDurationMs(row, now))}</span>`;
}

/** The word of the link to the place the job belongs. */
function homeWord(row: QueueRowView, lang: Language): string {
  if (isWikiBuild(row)) return t(lang, "jobs.linkWiki");
  return t(lang, "shell.tabSchedule");
}

export function jobRow(row: QueueRowView, o: JobRowOptions): string {
  const { lang } = o;
  const key = `${row.project}/${row.specFolder}`;
  const open = openKeys(o).includes(key);
  const name = jobTitle(row, lang);
  const kind = open ? jobControl(row) : undefined;
  const label =
    `${projectLink(row.project, { className: "muted" })}<span class="specpart"><span class="muted">:</span>` +
    `<span class="specname">${esc(name)}</span></span>`;
  return (
    `<tr class="spechead" id="spec-${esc(key)}" data-job="1">` +
    `<td class="foldcell" rowspan="2" data-col="fold">${fold(key, open, `${row.project}:${name}`, o)}</td>` +
    `<td colspan="${LIST_COLUMNS - 1}"><div class="spec-name"><span class="label">${label}</span></div>` +
    (open
      ? `<div class="spec-title"><a data-goto href="/jobs/${esc(row.id)}?tab=steps">${t(lang, "job.tabLog")}</a> · ` +
        `<a data-goto href="${esc(jobHome(row))}">${esc(homeWord(row, lang))}</a></div>`
      : "") +
    `</td></tr>` +
    `<tr class="specstate"><td colspan="2"></td>` +
    `<td data-col="state"><span class="badgeslot">${specStateChip(row, lang)}</span>` +
    `${kind ? `<span class="actionslot">${control(row, kind, lang)}</span>` : ""}</td>` +
    `<td data-col="started">${timeCell(row, o.now)}</td>` +
    `<td class="num" data-col="cost">${costCell(row.spentUsd, row.spentTokens, "–")}</td></tr>` +
    `<tr class="specgap" aria-hidden="true"><td colspan="${LIST_COLUMNS}"></td></tr>`
  );
}
