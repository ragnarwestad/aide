// The panel a row's long messages go into (spec 143): a row of its own,
// spanning the table, wrapping rather than overflowing. Everything the
// State column used to hold and could not — the spec's own reason for an
// archive that declined, a job's failure — is said here, once for the
// whole row, in the message component the page already has.
//
// Nothing to say draws nothing at all: an empty `.rowmsg` is invisible,
// but an empty `<tr>` is still a row of padding.
//
// A refused press is written by the page script into a row of its own,
// copied from `refusalRowTemplate` below, and a refusal naming no spec
// into the list's own line. Both are drawn outside `#jobrows`, so no
// redraw of the rows replaces them (`specs-client/row-refusal/`, which
// hand-pairs the two ids).

import { helpPopover, messageSlot, rowMessage, rowMessageParts, stepLabel, type MessagePart } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { sharedFilesSentence, specNotice, wordPhase } from "../../ui/job-state";
import type { OpenOverlap } from "../../../project/overlapping-specs.ts";
import { t, type Language } from "../../../i18n";
import { archivedRowNotices, errorMarkNotices } from "./row-marks.ts";
import { isArchivedRow, type SpecGroup, type SpecsFilter } from "./data-model";
import { checksRow, checksFold, checksPanel } from "./row-checks.ts";
import { archivingAgain, nextPhase, specBusy } from "./row-state.ts";
import { LIST_COLUMNS } from "./row-shared.ts";
import { deleteBranchForm } from "./row-controls.ts";
import { approachPanel } from "./approach-choice";

const REFUSAL_TEMPLATE_ID = "refusal-row";
const LIST_REFUSED_ID = "list-refused";
/** Hand-paired with `specs-client/spec-detail/open.ts`, which copies it. */
const SPEC_LOADING_ROW_ID = "spec-loading-row";

/** The message row a refused press is written into, held in a
 *  `<template>` for the script to copy — in a table of its own there,
 *  where a row is always parsed as one. */
export const refusalRowTemplate = (columns = LIST_COLUMNS): string =>
  `<template id="${REFUSAL_TEMPLATE_ID}"><table><tbody><tr class="specnotice" data-refusal>` +
  `<td colspan="${columns}">${messageSlot("refused", "failed")}</td></tr></tbody></table></template>`;

/** The detail row a spec's › draws while the spec is on its way, held in a
 *  `<template>` for the script to copy: the "Loading …" line, and an empty
 *  slot the script writes the failure sentence (`data-failed`) into when the
 *  spec cannot be loaded. */
export const specLoadingRowTemplate = (columns: number, lang: Language): string =>
  `<template id="${SPEC_LOADING_ROW_ID}"><table><tbody>` +
  `<tr class="specdetail" data-failed="${esc(t(lang, "list.specLoadFailed"))}"><td colspan="${columns}">` +
  `<p class="muted">${esc(t(lang, "shell.loadingPage"))}</p>${messageSlot("refused", "failed")}` +
  `</td></tr></tbody></table></template>`;

/** The list's own refusal line, above the rows. */
export const listRefusalLine = (): string => messageSlot("refused", "failed", { id: LIST_REFUSED_ID });

/** The one phase whose own record disagrees with the files, worded for
 *  the panel (spec 195). The sentence used to be drawn under that
 *  phase's badge, where it was the last thing on this page that could
 *  make one line taller than another.
 *
 *  The panel holds one message, and three disagreements listed in it
 *  would be the same growing block of text in a new place — so still
 *  exactly one sentence. But not always the EARLIEST phase in workflow
 *  order any more (spec 280): a phase whose own last attempt genuinely
 *  FAILED outranks an earlier phase's softer, unrelated note — an
 *  earlier phase's `filesDisagree` must not hide a later phase's real
 *  failure. Among phases with no real failure, the earliest with any
 *  qualifier still wins, exactly as before. It carries the phase's own
 *  name because a sentence moved out of the line it belonged to must
 *  say which line that was — as one phrase with the state word that
 *  follows it ("archive stopped: …"), never a second colon between the
 *  two: the row beside this panel already says both.
 *
 *  `p.attempts[0]`, not the in-flight-first pick the pips use: this is
 *  a RELOCATION of what `phaseSubRows` computes for that same phase's
 *  badge, so it has to read the same attempt that function does. */
function phaseDisagreement(g: SpecGroup, lang: Language, sharedFiles?: string): string | undefined {
  // An analyze stopped on shared files is said from the spec's own record
  // (`sharedFilesSentence`), which already opens with the step.
  const said = (step: string, qualifier: string, stopped?: string): string =>
    sharedFiles && step === "analyze" && stopped === "shared-files" ? sharedFiles : `${stepLabel(step, lang)} ${qualifier}`;
  let earliest: { step: string; qualifier: string; stopped?: string } | undefined;
  for (const p of g.phases) {
    const word = wordPhase(g.done.includes(p.step), p.heldBack, p.attempts[0], { ...p.history, fileResult: p.fileResult }, lang);
    if (!word.qualifier) continue;
    if (p.attempts[0]?.state === "failed") return said(p.step, word.qualifier, p.history.stopped);
    earliest ??= { step: p.step, qualifier: word.qualifier, stopped: p.history.stopped };
  }
  return earliest && said(earliest.step, earliest.qualifier, earliest.stopped);
}

/** The line a spec whose latest analysis was short carries, under its other
 *  notices on the row and so on the spec page (the Specs list with the row
 *  open): the plan and its review were left out by design. */
function shortAnalysisLine(g: SpecGroup, lang: Language, columns: number): string {
  if (g.phases.find((p) => p.step === "analyze")?.fileAnalysis !== "short") return "";
  return (
    `<tr class="specnotice" data-folder="${esc(g.specFolder)}">` +
    `<td colspan="${columns}">${rowMessage("info", t(lang, "list.shortAnalysis"))}</td></tr>`
  );
}

/** The line a spec implement sent back to a full analysis carries, under its
 *  other notices on the row and so on the spec page: it says why the plan
 *  and its review are coming. */
function sentBackLine(g: SpecGroup, lang: Language, columns: number): string {
  const why = g.phases.find((p) => p.step === "create")?.fileSentBack;
  if (!why) return "";
  return (
    `<tr class="specnotice" data-folder="${esc(g.specFolder)}">` +
    `<td colspan="${columns}">${rowMessage("info", t(lang, "list.sentBack", { why }))}</td></tr>`
  );
}

export function specNoticeRow(
  g: SpecGroup,
  now: number,
  lang: Language,
  testServerAvailable: (project: string, specFolder: string) => boolean,
  /** The view the row is drawn in: what the unfolded acceptance
   *  criteria (spec 493) need to keep. */
  view: {
    filter?: SpecsFilter;
    branchPreview?: (project: string, specFolder: string) => string | undefined;
    /** The specs an analyze stopped on shared files recorded as sharing
     *  them, less those archived since; called only for a row whose analyze
     *  stands stopped so. */
    overlappingSpecs?: (project: string, specFolder: string) => OpenOverlap[] | undefined;
    /** The page the row sits on, for the criteria's fold; the Specs list's own when absent. */
    listPath?: string;
    /** The row is open on the Specs list, where it is the spec alone: the
     *  approach choice, a press that releases a step, is left out. */
    specOpen?: boolean;
    /** How many columns the row spans: the list's own count. */
    columns?: number;
  } = {},
): string {
  const archiveHeldBack = g.phases.find((p) => p.step === "archive")?.heldBack?.reason;
  const locked = isArchivedRow(g);
  const analyzeStopped = g.phases.find((p) => p.step === "analyze")?.history.stopped;
  const sharedFiles = locked
    ? undefined
    : sharedFilesSentence(g.lead, analyzeStopped, () => view.overlappingSpecs?.(g.project, g.specFolder), lang);
  // A stop on shared files is said from the spec's own record, not from the
  // job's sentence, so the row reads the same once the job has gone.
  const lead =
    sharedFiles && g.lead?.state === "stopped" && g.lead.stopReason === "shared-files"
      ? { ...g.lead, error: sharedFiles }
      : g.lead;
  const notice = specNotice(
    lead,
    archiveHeldBack,
    // A locked row's phases can carry queue-remembered attempts (spec
    // 410, for the duration/cost cells) from a run that happened before
    // the spec was archived or closed — nothing on a locked row is
    // still actionable, so a disagreement between the files and that
    // leftover attempt is not shown as a warning (spec 483). The mark
    // and readyToArchive arguments beside this one already carry the
    // same gate.
    locked ? undefined : phaseDisagreement(g, lang, sharedFiles),
    isArchivedRow(g) ? (archivingAgain(g) ? [] : archivedRowNotices(g.archive, now, lang)) : errorMarkNotices(g, lang, testServerAvailable, view.branchPreview),
    lang,
    !isArchivedRow(g) && !archiveHeldBack && !specBusy(g) && nextPhase(g.done) === "archive",
  );
  const filter = view.filter ?? {};
  // The count and the criteria's own unfold, under whatever notice the row
  // carries. A held-back notice unfolds the same list, so there the count
  // stands without a › of its own.
  const holds = (notice?.parts ?? []).some((p) => "kind" in p && p.kind === "acceptance-hold");
  const columns = view.columns ?? LIST_COLUMNS;
  const checks = checksRow(g, filter, lang, columns, !holds, view.listPath) + shortAnalysisLine(g, lang, columns) + sentBackLine(g, lang, columns);
  if (!notice) return checks;
  // The held-back part is led by the › and carries the unfolded list
  // directly under its own box.
  // Delete branch sits in its own note's box, and the approaches under
  // their waiting line.
  const parts: MessagePart[] = (notice.parts ?? [{ text: notice.text }]).map((p) =>
    "kind" in p && p.kind === "acceptance-hold"
      ? { ...p, lead: checksFold(g, filter, lang, view.listPath), after: checksPanel(g, filter, lang) }
      : "kind" in p && p.kind === "branch-left-behind"
        ? { ...p, after: deleteBranchForm(g, lang) }
        : "kind" in p && p.kind === "approach-choice"
          ? view.specOpen ? p : { ...p, after: approachPanel(g, lang) }
          : p,
  );
  const detail = notice.title ? helpPopover("more detail", esc(notice.title)) : "";
  return (
    `<tr class="specnotice" data-folder="${esc(g.specFolder)}">` +
    `<td colspan="${columns}">${rowMessageParts(notice.variant, parts, { hook: notice.hook })}${detail}</td></tr>` +
    checks
  );
}
