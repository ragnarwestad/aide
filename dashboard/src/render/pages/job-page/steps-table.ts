// The steps table: what each of a job's steps did, and its own log
// under a fold. Split out of job-page.ts by theme — exported since spec
// 150, because the SPEC page's Steps tab is the lead job's own, and two
// copies of this table would be a fourth instance of the
// hand-paired-lists problem `development.md` already names three times
// over.

import { esc, usdOrTokens } from "../../ui/html.ts";
import { renderSentence } from "../../../i18n/message.ts";
import type { Language } from "../../../i18n";
import { heldBackReasonText } from "../../ui/job-state/notice.ts";
import { ICON_CHEVRON, stepLabel } from "../../ui/components.ts";
import type { JobDetailView, JobStepResultView } from "./types.ts";

/** A heading that says "Cost" above a column of token counts is the
 *  wrong word, so it flips with the figures under it — the description
 *  asked for the Cost column "(header and values)", and this is the
 *  header half. Dollar mode is byte-for-byte what it was. */
export const unitLabel = (usd: string, tok: string): string =>
  `<span class="u-usd">${esc(usd)}</span><span class="u-tok">${esc(tok)}</span>`;

/** What a finished step actually DID. `ok` is the claude session's own
 *  exit status, and for archive that is not the same question: a run
 *  that read an unfinished `4-status.md` and declined to move the
 *  folder exits just as successfully as one that moved it. So the one
 *  archive row reads the spec's own reason instead — the same words the
 *  list's row shows, from the same field. */
function outcome(r: JobStepResultView, archiveHeldBack?: string, landingRefused?: LandingRefusal, lang: Language = "en"): string {
  if (r.step === "archive" && r.ok && archiveHeldBack) {
    return `held back — ${esc(heldBackReasonText(lang, archiveHeldBack))}`;
  }
  // Spec 433: a create step that skipped the AI session reads distinctly
  // from an AI-run one, so a reader can tell which of the two paths
  // create took.
  if (r.step === "create" && r.ok && r.tool === "none") return "created (no AI)";
  // The step's own process exited fine — that is all `ok` records — and
  // the merge that followed it was refused. A cell reading "ok" there
  // tells the reader the opposite of what the row on the specs list
  // says, so this one says the same thing that one does.
  if (landingRefused && r.step === landingRefused.step && r.ok) return esc(landingRefused.word);
  return r.ok ? "ok" : esc(r.terminalReason || "failed");
}

/** A step whose own run finished and whose MERGE was then refused: which
 *  step it was, the short word for its Outcome cell, and what the
 *  refusal said — the sentence and, when the project's tests are what
 *  refused it, the lines naming the tests that failed.
 *
 *  Read off the job the page is already showing (`landingError` names
 *  the step, `errorReason` says whether the tests were what stopped it),
 *  so nothing new is plumbed through to reach it. */
export interface LandingRefusal {
  step: string;
  word: string;
  detail?: string;
}

export function landingRefusal(
  job: { landingError?: unknown; errorReason?: string; errorDetail?: string },
  lang: Language,
): LandingRefusal | undefined {
  const e = job.landingError;
  if (!e || typeof e !== "object" || Array.isArray(e)) return undefined;
  const step = (e as { values?: Record<string, unknown> }).values?.step;
  if (typeof step !== "string" || !step) return undefined;
  const sentence = renderSentence(lang, e as never) ?? "";
  return {
    step,
    // "stopped" is the landing's own word for a merge the project's
    // tests refused: the step ran and the merge was built, and what is
    // missing is a green suite. Everything else is a failure.
    word: job.errorReason === "tests-red" ? "merge stopped" : "merge failed",
    detail: [sentence, job.errorDetail].filter(Boolean).join("\n") || undefined,
  };
}

/** Which row a Steps tab has open, from the raw `step=` query value and
 *  whether a step is running right now (spec 240). `"none"` is an
 *  explicit close — the one value a click actually sends to collapse a
 *  row that defaulted open — and is kept apart from "absent": nothing
 *  in the URL defaults to the running row when there is one, exactly
 *  the behaviour `activityPanel` gave a live job before it existed. This
 *  is what survives the page's own 10-second reload: the open row is a
 *  property of the URL, never of a client-only widget (`queue-list.ts`'s
 *  row-fold already rejected `<details>` for the identical reason). */
export function resolveOpenStep(query: string | undefined, hasRunning: boolean): string | undefined {
  if (query === "none") return undefined;
  if (query !== undefined) return query;
  return hasRunning ? "live" : undefined;
}

/** What a step row's expanded panel shows: its own transcript, or —
 *  when it has none — why not. Subsumes `activityPanel`'s one sentence
 *  for a run the runner refused before it started; every other note
 *  that function carried is already said elsewhere (`job.error` in the
 *  banner, `archiveHeldBack` in this same row's Outcome cell). */
function stepLogPanel(logs: string[] | undefined, terminalReason: string, refusal?: string): string {
  // The merge's own refusal first: it is the newest thing that happened
  // to this step, and the transcript below it is of the run that
  // succeeded. Without it the page showed four steps reading "ok" and
  // no sign of the tests that refused the merge.
  const merge = refusal ? `<pre class="specfile">${esc(refusal)}</pre>` : "";
  if (logs && logs.length > 0) return `${merge}<pre class="specfile">${logs.join("\n")}</pre>`;
  if (merge) return merge;
  if (terminalReason === "refused") {
    return (
      `<p class="muted">This step was refused before it started, so nothing ran and ` +
      `no transcript exists.</p>`
    );
  }
  return `<p class="muted">Nothing has been captured from this step.</p>`;
}

/** Exported since spec 150: the SPEC page's Steps tab is the lead job's
 *  own, and two copies of this table would be a fourth instance of the
 *  hand-paired-lists problem `development.md` already names three times
 *  over. A spec with no job at all renders through the same empty case
 *  an empty job does.
 *
 *  Since spec 240 this is also where the Activity tab's one job lives:
 *  each row expands to ITS OWN transcript (`r.logs`, read from that
 *  step's own `streamFile` rather than the job's last one), and a step
 *  currently running gets a row of its own — `opts.runningStep` — since
 *  it has no `JobStepResultView` yet. `opts.tabHref` is absent only for
 *  a caller that wants the bare table with no expand control at all
 *  (`responsive.test.ts`'s wrap check, which asserts markup nothing
 *  here changes). `opts.mark` (spec 360) is the spec page's own "(?)"
 *  help popover, appended inside this table's own first line — this
 *  page draws none of its own, so it stays absent here. */
export function stepResults(
  results: JobStepResultView[],
  archiveHeldBack?: string,
  opts: {
    tabHref?: string;
    openStep?: string;
    runningStep?: JobDetailView["runningStep"];
    mark?: string;
    landingRefused?: LandingRefusal;
    lang?: Language;
  } = {},
): string {
  const lang: Language = opts.lang ?? "en";
  // The list shows one line per SPEC, and attributes a job to the single
  // step it is on — so a three-step job's finished steps are invisible
  // there, even though every one of them is recorded with its cost, its
  // session and how it ended.
  if (results.length === 0 && !opts.runningStep)
    return `<p class="muted">No step has finished yet.${opts.mark ? ` ${opts.mark}` : ""}</p>`;
  const open = resolveOpenStep(opts.openStep, !!opts.runningStep);
  // The chevron toggles; the name beside it is plain text — the same
  // split the specs list's own `.fold` uses, rather than making the
  // whole name the click target the way this used to (spec 240,
  // adjusted 2026-08-25): a name with no visible affordance read as
  // plain text with a hover underline, not as something to press.
  const stepCell = (label: string, key: string, isOpen: boolean): string =>
    opts.tabHref
      ? `<a class="fold steplink${isOpen ? "" : " shut"}" data-nav ` +
        `href="${opts.tabHref}&step=${isOpen ? "none" : esc(key)}" ` +
        `aria-expanded="${isOpen ? "true" : "false"}" ` +
        `title="${isOpen ? "hide" : "show"} this step's own log">${ICON_CHEVRON}</a> ${esc(label)}`
      : esc(label);
  const rows = results
    .map((r, i) => {
      const key = String(i);
      const isOpen = open === key;
      const main =
        `<tr><td>${r.attempt === undefined ? "" : `<span class="muted small">Attempt ${r.attempt}</span> `}` +
        `${stepCell(r.step ? stepLabel(r.step) : "–", key, isOpen)}</td>` +
        `<td>${outcome(r, archiveHeldBack, opts.landingRefused, lang)}</td>` +
        // A Codex step has no dollar figure ANYWHERE in its output, so
        // the money half is a dash rather than the $0.00 its stored
        // zero would print — and there is no estimate to mark either,
        // because nothing was estimated (spec 125).
        `<td class="num">${usdOrTokens(r.tool === "codex" ? undefined : r.costUsd, r.tokens)}` +
        `${r.tool === "codex" || r.costMeasured ? "" : ' <span class="muted small">est.</span>'}</td>` +
        `<td>${esc(r.terminalReason)}</td>` +
        `<td class="muted small">${esc(r.sessionId ? r.sessionId.slice(0, 8) : "–")}</td>` +
        `<td class="muted small">${r.at ? esc(r.at) : "–"}</td></tr>`;
      const log = isOpen
        ? `<tr class="steplog"><td colspan="6">${stepLogPanel(
            r.logs,
            r.terminalReason,
            opts.landingRefused && r.step === opts.landingRefused.step ? opts.landingRefused.detail : undefined,
          )}</td></tr>`
        : "";
      return main + log;
    })
    .join("");
  const runningRow = ((): string => {
    if (!opts.runningStep) return "";
    const isOpen = open === "live";
    const main =
      `<tr><td>${opts.runningStep.attempt === undefined ? "" : `<span class="muted small">Attempt ${opts.runningStep.attempt}</span> `}` +
      `${stepCell(stepLabel(opts.runningStep.step), "live", isOpen)}</td>` +
      `<td>running</td><td class="num">${usdOrTokens(undefined, undefined)}</td><td>–</td>` +
      `<td class="muted small">${esc(opts.runningStep.sessionId ? opts.runningStep.sessionId.slice(0, 8) : "–")}</td>` +
      `<td class="muted small">–</td></tr>`;
    const log = isOpen
      ? `<tr class="steplog"><td colspan="6">${stepLogPanel(opts.runningStep.logs, "")}</td></tr>`
      : "";
    return main + log;
  })();
  // Six columns of names, figures and timestamps: wider than a phone
  // whatever it is told, so the box scrolls rather than the page
  // (spec 155). The spec page's Steps tab is this same table.
  return (
    `<div class="tablewrap"><table><thead><tr><th>Step</th><th>Outcome</th>` +
    `<th class="num">${unitLabel("Cost", "Tokens")}</th>` +
    `<th>Ended as</th><th>Session</th><th>At${opts.mark ?? ""}</th></tr></thead><tbody>${rows}${runningRow}</tbody></table></div>`
  );
}
