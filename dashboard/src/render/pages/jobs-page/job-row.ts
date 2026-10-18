// A scheduled job's row on the Jobs tab, in the Specs list's own
// shape: a title line, a state line and a gap, in the same columns. It has no
// spec folder, phases or target for the list's row builder to read, so it is
// drawn here from the job alone and with the classes the list already has.
// The `spechead` class and the `spec-<project>/<folder>` id make the page
// script treat it as a spec's row: it redraws it by that id and writes a
// refused Stop under it. A scheduled job's row folds as a spec's does,
// from the `open` key in the address: shut, it holds the title, state, time and
// cost; open, it adds Stop or Cancel, and a line per step its log has marked, in
// the row's own columns: its state, its time, and no cost of its own, since the
// job's cost is the row's. A Close or Reopen is drawn the same way, with no
// Stop or Cancel, and open it adds a line per step of the job. A deploy is
// drawn as they are, with Cancel while it is queued. A job that ended badly
// says why in a line under its state, open or shut, and the line ends with a
// Log link to the job's own page; a deploy held back has its waiting line
// there, with no link.

import { t, type Language } from "../../../i18n";
import { askButton, badge, confirmDialog, foldArrow, rowMessage, stepLabel, type ProgressStepState } from "../../ui/components";
import { projectLink } from "../../ui/components/spec-name.ts";
import { esc } from "../../ui/html.ts";
import { currentStep, durationLabel, inFlight, specStateChip, type QueueRowView } from "../../ui/job-state";
import { landingStep } from "../../ui/job-state/resting.ts";
import { costCell } from "../specs-list/cell-helpers.ts";
import type { SpecsFilter } from "../specs-list";
import { queuePath } from "../specs-list/filter-bar.ts";
import { LIST_COLUMNS } from "../specs-list/row-shared.ts";
import { logBox } from "../specs-list/phase-messages";
import type { LogPart } from "../../../queue/parse-stream";
import { closeOrReopenStep, deployStep } from "../../../queue/queue.ts";
import { isScheduleJob, jobControl, jobKey, jobMessage, jobTitle } from "./rows.ts";
import { jobDurationMs, jobEndMs } from "./view.ts";

/** One step of a Close or Reopen: its state, and for Aide's own steps its
 *  seconds once ended, or when it started while it runs. */
export interface JobStep {
  key: string;
  label: string;
  state?: ProgressStepState;
  seconds?: number;
  since?: string;
  /** The step's own part of the job's Log, once it is marked. */
  logs?: LogPart[];
}

export interface JobRowOptions {
  lang: Language;
  now: number;
  /** How the rows are folded, from the address: `open` names the rows shown open. */
  filter: SpecsFilter;
  /** The page the row sits on, for its fold's address. */
  listPath: string;
  /** A Close, Reopen, deploy or scheduled job's steps, each in the state its log has it in. */
  steps?: (jobId: string, step: string) => JobStep[];
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

/** The line under the state, open or shut, from `jobMessage`; its Log link
 *  ends the line. */
function messageLine(row: QueueRowView, lang: Language): string {
  const m = jobMessage(row, lang);
  if (!m) return "";
  const log = m.log ? `<a data-goto href="${esc(m.log)}">${esc(t(lang, "job.tabLog"))}</a>` : "";
  return `<tr class="specnotice"><td colspan="${LIST_COLUMNS}">${rowMessage(m.variant, m.text, { actions: log })}</td></tr>`;
}

/** A step's state, in the badge a phase line uses; a step not reached yet in a muted word. */
function stepState(state: ProgressStepState | undefined, lang: Language): string {
  if (state === "done") return badge("done", t(lang, "dialog.stepDone"));
  if (state === "running") return badge("running", t(lang, "dialog.stepRunning"));
  if (state === "failed") return badge("refused", t(lang, "dialog.stepFailed"));
  return `<span class="muted small">${esc(t(lang, "dialog.stepWaiting"))}</span>`;
}

/** A step's time: its seconds once ended, counting from its start while it runs. */
function stepTime(s: JobStep, now: number): string {
  if (s.seconds !== undefined) return `<span class="muted small">${durationLabel(s.seconds * 1000)}</span>`;
  if (s.since) {
    return `<span class="muted small" data-elapsed="${esc(s.since)}">${durationLabel(Math.max(0, now - Date.parse(s.since)))}</span>`;
  }
  return "–";
}

/** A Close's, Reopen's, deploy's or scheduled job's steps, a line each in the row's columns, while the row is open.
 *  The name starts where a spec's phase names do. A step its log has marked
 *  unfolds to its own part of the log, as a phase does: the unfolded steps
 *  are in the address (`phases`), each as the row's key and the step's place. */
function stepLines(row: QueueRowView, o: JobRowOptions): string {
  const step = closeOrReopenStep(row) ?? deployStep(row) ?? (isScheduleJob(row) ? "schedule" : undefined);
  const unfolded = (o.filter.phases ?? "").split(",").filter(Boolean);
  return (step ? (o.steps?.(row.id, step) ?? []) : [])
    .map((s, i) => {
      const key = `${jobKey(row)}.${i}`;
      const open = unfolded.includes(key);
      const next = open ? unfolded.filter((k) => k !== key) : [...unfolded, key];
      const arrow = s.logs?.length
        ? foldArrow({
            href: queuePath(o.filter, { phases: next.join(",") }, o.listPath),
            open,
            lang: o.lang,
            title: "list.phaseFoldTitle",
            params: { phase: s.label },
          })
        : "";
      return (
        `<tr class="subrow" data-step="${esc(s.key)}" data-jobstep="1"><td class="phasecell" colspan="3">${arrow}${esc(s.label)}</td>` +
        `<td data-col="state">${stepState(s.state, o.lang)}</td>` +
        `<td data-col="started">${stepTime(s, o.now)}</td>` +
        `<td class="num" data-col="cost">–</td></tr>` +
        (open && s.logs?.length
          ? `<tr class="phasemsgs" data-msgs="${esc(s.key)}"><td colspan="${LIST_COLUMNS}">${logBox(s.logs, undefined, o.lang)}</td></tr>`
          : "")
      );
    })
    .join("");
}

export function jobRow(row: QueueRowView, o: JobRowOptions): string {
  const { lang } = o;
  const key = jobKey(row);
  const open = openKeys(o).includes(key);
  const name = jobTitle(row, lang);
  const kind = open ? jobControl(row) : undefined;
  const label =
    `${projectLink(row.project, { className: "muted" })}<span class="specpart"><span class="muted">:</span>` +
    `<span class="specname">${esc(name)}</span></span>`;
  return (
    `<tr class="spechead" id="spec-${esc(key)}" data-job="1">` +
    `<td class="foldcell" rowspan="2" data-col="fold">${fold(key, open, `${row.project}:${name}`, o)}</td>` +
    `<td colspan="${LIST_COLUMNS - 1}"><div class="spec-name"><span class="label">${label}</span></div></td></tr>` +
    `<tr class="specstate"><td colspan="2"></td>` +
    `<td data-col="state"><span class="badgeslot">${specStateChip(row, lang)}</span>` +
    `${kind ? `<span class="actionslot">${control(row, kind, lang)}</span>` : ""}</td>` +
    `<td data-col="started">${timeCell(row, o.now)}</td>` +
    `<td class="num" data-col="cost">${costCell(row.spentUsd, row.spentTokens, "–")}</td></tr>` +
    messageLine(row, lang) +
    (open ? stepLines(row, o) : "") +
    `<tr class="specgap" aria-hidden="true"><td colspan="${LIST_COLUMNS}"></td></tr>`
  );
}
