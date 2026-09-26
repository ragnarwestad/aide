// The panel a row's long messages go into (spec 143): a row of its own,
// spanning the table, wrapping rather than overflowing. Everything the
// State column used to hold and could not — the runner's refusal, the
// spec's own reason for an archive that declined — is said here, once
// for the whole row, in the message component the page already has.
//
// Nothing to say draws nothing at all: an empty `.rowmsg` is invisible,
// but an empty `<tr>` is still a row of padding.

import { helpPopover, rowMessageParts, stepLabel, type MessagePart } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { specNotice, wordPhase } from "../../ui/job-state";
import type { Language } from "../../../i18n";
import { archivedRowNotices, errorMarkNotices } from "./row-marks.ts";
import { isArchivedRow, type SpecGroup, type SpecsFilter } from "./data-model";
import { checksRow, checksFold, checksPanel } from "./row-checks.ts";
import { nextPhase, specBusy } from "./row-state.ts";
import { LIST_COLUMNS } from "./row-shared.ts";

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
function phaseDisagreement(g: SpecGroup, lang: Language): string | undefined {
  let earliest: { step: string; qualifier: string } | undefined;
  for (const p of g.phases) {
    const word = wordPhase(g.done.includes(p.step), p.heldBack, p.attempts[0], { ...p.history, fileResult: p.fileResult }, lang);
    if (!word.qualifier) continue;
    if (p.attempts[0]?.state === "failed") return `${stepLabel(p.step, lang)} ${word.qualifier}`;
    earliest ??= { step: p.step, qualifier: word.qualifier };
  }
  return earliest && `${stepLabel(earliest.step, lang)} ${earliest.qualifier}`;
}

export function specNoticeRow(
  g: SpecGroup,
  refusal: string | undefined,
  now: number,
  lang: Language,
  testServerAvailable: (project: string) => boolean,
  /** The view the row is drawn in: what the unfolded acceptance
   *  criteria (spec 493) need to keep. */
  view: { filter?: SpecsFilter } = {},
): string {
  const archiveHeldBack = g.phases.find((p) => p.step === "archive")?.heldBack?.reason;
  const notice = specNotice(
    g.lead,
    archiveHeldBack,
    refusal,
    // A locked row's phases can carry queue-remembered attempts (spec
    // 410, for the duration/cost cells) from a run that happened before
    // the spec was archived or closed — nothing on a locked row is
    // still actionable, so a disagreement between the files and that
    // leftover attempt is not shown as a warning (spec 483). The mark
    // and readyToArchive arguments beside this one already carry the
    // same gate.
    isArchivedRow(g) ? undefined : phaseDisagreement(g, lang),
    isArchivedRow(g) ? archivedRowNotices(g.archive, now, lang) : errorMarkNotices(g, lang, testServerAvailable),
    lang,
    !isArchivedRow(g) && !archiveHeldBack && !specBusy(g) && nextPhase(g.done) === "archive",
  );
  const filter = view.filter ?? {};
  // The count and the criteria's own unfold, under whatever notice the row
  // carries. A held-back notice unfolds the same list, so there the count
  // stands without a › of its own.
  const holds = (notice?.parts ?? []).some((p) => "kind" in p && p.kind === "acceptance-hold");
  const checks = checksRow(g, filter, lang, LIST_COLUMNS, !holds);
  if (!notice) return checks;
  // The held-back part is led by the › and carries the unfolded list
  // directly under its own box.
  const parts: MessagePart[] = (notice.parts ?? [{ text: notice.text }]).map((p) =>
    "kind" in p && p.kind === "acceptance-hold"
      ? { ...p, lead: checksFold(g, filter, lang), after: checksPanel(g, filter, lang) }
      : p,
  );
  const detail = notice.title ? helpPopover("more detail", esc(notice.title)) : "";
  return (
    `<tr class="specnotice" data-folder="${esc(g.specFolder)}">` +
    `<td colspan="${LIST_COLUMNS}">${rowMessageParts(notice.variant, parts, { hook: notice.hook })}${detail}</td></tr>` +
    checks
  );
}
