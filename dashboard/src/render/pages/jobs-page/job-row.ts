// A scheduled job's row on the Jobs tab, in the Specs list's own
// shape: a title line, a state line and a gap, in the same columns. It has no
// spec folder, phases or target for the list's row builder to read, so it is
// drawn here from the job alone and with the classes the list already has.
// The `spechead` class and the `spec-<project>/<folder>` id make the page
// script treat it as a spec's row: it redraws it by that id and writes a
// refused Stop under it. A scheduled job's row folds as a spec's does,
// from the `open` key in the address: shut, it holds the title, state, time and
// cost; open, it adds Stop or Cancel, and a line per step its log has marked, in
// the row's own columns: its state, its time and the tokens it used (the job's
// cost is the row's, so a step has no dollar figure). A Close or Reopen is drawn the same way, with no
// Stop or Cancel, and open it adds a line per step of the job. A deploy is
// drawn as they are, with Cancel while it is queued. A job that ended badly
// says why in a line under its state, open or shut, and the line ends with a
// Log link to the job's own page and, for a scheduled job, Dismiss, which
// takes the row off the tab and asks nothing first; a deploy held back has its
// waiting line there, with no link.

import { t, type Language } from "../../../i18n";
import { SPEC_HEAD_CLASS } from "../../../page-contract.ts";
import { askButton, buttonForm, confirmDialog, foldArrow, pips, rowMessage, stepLabel, type PipKind, type ProgressStepState } from "../../ui/components";
import { projectLink } from "../../ui/components/spec-name.ts";
import { esc } from "../../ui/html.ts";
import { currentStep, durationLabel, inFlight, specStateChip, type QueueRowView } from "../../ui/job-state";
import { landingStep } from "../../ui/job-state/resting.ts";
import { costCell, createdLabel } from "../specs-list/cell-helpers.ts";
import type { SpecsFilter } from "../specs-list";
import { queuePath } from "../specs-list/filter-bar.ts";
import { LIST_COLUMNS } from "../specs-list/row-shared.ts";
import { stepRows, type JobStep } from "../specs-list/phase-messages";
import { jobControl, jobKey, jobTitle } from "./rows.ts";
import { getJobMessage } from "../../../messages/jobs/get.ts";
import { jobDurationMs, jobEndMs } from "./view.ts";

export type { JobStep };

export interface JobRowOptions {
  lang: Language;
  now: number;
  /** How the rows are folded, from the address: `open` names the rows shown open. */
  filter: SpecsFilter;
  /** The page the row sits on, for its fold's address. */
  listPath: string;
  /** A Close, Reopen, deploy or scheduled job's steps, each in the state its log has it in. */
  steps?: (jobId: string) => JobStep[];
  /** The row's key when it is not the job's own (`jobRowKeys`). */
  key?: string;
  /** A job's steps as its pips draw them: each step's name and state. */
  pips?: (jobId: string) => { label: string; state?: ProgressStepState }[];
}

const PIP_OF: Record<ProgressStepState, PipKind> = { done: "past", running: "now", failed: "refused", waiting: "todo" };

/** A step's pip: done, running, failed, or not started yet. */
export function jobStepPipKind(state: ProgressStepState | undefined): PipKind {
  return state ? PIP_OF[state] : "todo";
}

/** One pip per step, numbered in the job's order, as a group's members are. */
function stepPips(row: QueueRowView, o: JobRowOptions): string {
  const steps = o.pips?.(row.id) ?? [];
  return steps.length
    ? `<span class="pipslot">${pips(steps.map((s, i) => ({ kind: jobStepPipKind(s.state), title: s.label, label: String(i + 1) })))}</span>`
    : "";
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

/** The line under the state, open or shut, from `getJobMessage`; its Log link
 *  and, for a scheduled job, Dismiss end the line. */
function messageLine(row: QueueRowView, lang: Language): string {
  const m = getJobMessage(row, lang);
  if (!m) return "";
  const log = m.log ? `<a data-goto href="${esc(m.log)}">${esc(t(lang, "job.tabLog"))}</a>` : "";
  const dismiss = m.dismiss
    ? buttonForm({
        action: m.dismiss,
        hook: "actionform",
        button: { label: t(lang, "list.createDismiss"), small: true },
      })
    : "";
  return `<tr class="specnotice"><td colspan="${LIST_COLUMNS}">${rowMessage(m.variant, m.text, { actions: log + dismiss })}</td></tr>`;
}

/** A Close's, Reopen's, deploy's or scheduled job's steps, a line each in the row's columns, while the row is open
 *  (`stepRows`, which a spec's unfolded phase draws its steps with too). */
function stepLines(row: QueueRowView, o: JobRowOptions): string {
  return stepRows(o.steps?.(row.id) ?? [], { prefix: o.key ?? jobKey(row), filter: o.filter, listPath: o.listPath, lang: o.lang, now: o.now })
    .map((r) => `${r.tag}${r.cells}</tr>`)
    .join("");
}

export function jobRow(row: QueueRowView, o: JobRowOptions): string {
  const { lang } = o;
  const key = o.key ?? jobKey(row);
  const open = openKeys(o).includes(key);
  const name = jobTitle(row, lang);
  const kind = open ? jobControl(row) : undefined;
  const label =
    `${projectLink(row.project, { className: "muted" })}<span class="specpart"><span class="muted">:</span>` +
    `<span class="specname">${esc(name)}</span></span>`;
  return (
    `<tr class="${SPEC_HEAD_CLASS}" id="spec-${esc(key)}" data-job="1">` +
    `<td class="foldcell" rowspan="2" data-col="fold">${fold(key, open, `${row.project}:${name}`, o)}</td>` +
    `<td colspan="${LIST_COLUMNS - 1}"><div class="spec-name"><span class="label">${label}</span></div></td></tr>` +
    // When the job was made and a pip per step, where a spec's row has its
    // date and its phases' pips; a phone shows the pips alone.
    `<tr class="specstate"><td colspan="2"><span class="createdpips"><span class="muted small">${esc(createdLabel(row.createdAt))}</span>${stepPips(row, o)}</span></td>` +
    `<td data-col="state"><span class="badgeslot">${specStateChip(row, lang)}</span>` +
    `${kind ? `<span class="actionslot">${control(row, kind, lang)}</span>` : ""}</td>` +
    `<td data-col="started">${timeCell(row, o.now)}</td>` +
    `<td class="num" data-col="cost">${costCell(row.spentUsd, row.spentTokens, "–")}</td></tr>` +
    (open ? stepLines(row, o) : "") +
    messageLine(row, lang) +
    `<tr class="specgap" aria-hidden="true"><td colspan="${LIST_COLUMNS}"></td></tr>`
  );
}
