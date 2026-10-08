// The Jobs tab: the board's first page. Every job that is queued, running or
// landing, and every finished one that waits for the user, whatever started
// it. Which jobs and what each row says live in `rows.ts`; this draws them.
// Phases are started from the Specs list, so no row here offers a Run.

import { t, type Language } from "../../../i18n";
import { ACCEPTANCE_CRITERIA_UNTICKED } from "../../../queue/steps.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../project/parse-status";
import { askButton, confirmDialog, stepLabel } from "../../ui/components";
import { messageSlot, rowMessage } from "../../ui/components/message.ts";
import { esc } from "../../ui/html.ts";
import { currentStep, durationLabel, inFlight, specStateChip, type QueueRowView } from "../../ui/job-state";
import { landingStep } from "../../ui/job-state/resting.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { followPart } from "../job-page/follow.ts";
import { costCell } from "../specs-list/cell-helpers.ts";
import { isWikiBuild } from "../../../queue/steps.ts";
import { jobControl, jobHome, jobTitle } from "./rows.ts";

export { jobControl, jobHome, jobsShown, jobTitle } from "./rows.ts";
export type { JobLike } from "./rows.ts";

/** Where a refused Stop or Cancel is written. */
const REFUSED_LINE = "jobs-refused";

/** The page always follows the queue, even while nothing runs: a job that
 *  starts must get its row without the page being loaded again. */
const FOLLOW_MARKER = `<span hidden data-follow></span>`;

export interface JobsPageOptions {
  /** A spec's own title, by project and folder. */
  titleOf: (project: string, specFolder: string) => string | undefined;
  lang?: Language;
  currentUrl?: string;
  script?: string;
  /** The moment the page is drawn at, for the time of a job still going. */
  now?: number;
}

/** Stop or Cancel with the question it asks first. The dialog's OK posts the
 *  cancel route and writes a refusal into the page's line. */
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
      post: { action: `/api/queue/${row.id}/cancel`, hook: "reloadform", data: { line: REFUSED_LINE } },
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

function jobRow(row: QueueRowView, o: JobsPageOptions, lang: Language, now: number): string {
  const heldBack =
    row.state === "done" && row.results?.at(-1)?.terminalReason === ACCEPTANCE_CRITERIA_UNTICKED
      ? { archiveHeldBack: ACCEPTANCE_CRITERIA_UNTICKED_NOTE }
      : {};
  const kind = jobControl(row);
  return (
    `<tr data-job="${esc(row.id)}">` +
    `<td data-col="spec">${esc(jobTitle(row, lang, o.titleOf))} ` +
    `<span class="muted small"><a data-goto href="/jobs/${esc(row.id)}?tab=steps">${t(lang, "job.tabLog")}</a> · ` +
    `<a data-goto href="${esc(jobHome(row))}">${esc(homeWord(row, lang))}</a></span></td>` +
    `<td data-col="state"><span class="badgeslot">${specStateChip(row, lang, heldBack)}</span>` +
    `${kind ? `<span class="actionslot">${control(row, kind, lang)}</span>` : ""}</td>` +
    `<td data-col="started">${timeCell(row, now)}</td>` +
    `<td class="num" data-col="cost">${costCell(row.spentUsd, row.spentTokens, "–")}</td>` +
    `</tr>`
  );
}

function head(lang: Language): string {
  return (
    `<thead><tr>` +
    `<th data-col="spec">${t(lang, "jobs.colTitle")}</th>` +
    `<th data-col="state">${t(lang, "jobs.colState")}</th>` +
    `<th data-col="started">${t(lang, "list.colTime")}</th>` +
    `<th class="num" data-col="cost"><span class="u-usd">${t(lang, "list.colCost")}</span>` +
    `<span class="u-tok">${t(lang, "list.colTokens")}</span></th>` +
    `</tr></thead>`
  );
}

/** The part the page script swaps: the table, or the sentence for no row. */
function jobsPart(rows: QueueRowView[], o: JobsPageOptions, lang: Language): string {
  if (!rows.length) return rowMessage("info", t(lang, "jobs.nothingRunning"));
  const now = o.now ?? Date.now();
  return (
    `<div class="tablewrap"><table class="list">${head(lang)}<tbody>` +
    rows.map((r) => jobRow(r, o, lang, now)).join("") +
    `</tbody></table></div>`
  );
}

/** `/?follow=1`: the marker and the part alone. */
export function renderJobsFollowParts(rows: QueueRowView[], o: JobsPageOptions): string {
  return FOLLOW_MARKER + followPart("jobs", jobsPart(rows, o, o.lang ?? "en"));
}

export function renderJobsPage(
  rows: QueueRowView[],
  generatedAt: string,
  entries: NavEntry[],
  o: JobsPageOptions,
): string {
  const lang = o.lang ?? "en";
  // The refusal line sits above the part, outside what the script swaps.
  const body = messageSlot("refused", "failed", { id: REFUSED_LINE }) + renderJobsFollowParts(rows, o);
  return pageShell("Jobs", entries, "/", body, generatedAt, {
    docTitle: "aide -board · Jobs",
    hideHeading: true,
    script: o.script,
    lang,
    currentUrl: o.currentUrl,
  });
}
