import type { Language } from "../../../i18n";
// The spec's own header row: what it is, how far it has got, what it
// has cost, and the one thing that can be done about it.

import { specPagePath } from "../spec-page";
import { CHECKING, badge, stepLabel } from "../../ui/components";
import { projectLink } from "../../ui/components/spec-name.ts";
import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { esc } from "../../ui/html.ts";
import { inFlight, restingChip } from "../../ui/job-state";
import type { SpecsPageOptions } from "./";
import { ARCHIVED_STATE, CLOSED_STATE, isArchivedRow, isFinishedGroup, type SpecGroup } from "./data-model";
import {
  activeDurationCell,
  archiveDateCell,
  costCell,
  createdCell,
  phasePips,
  stateCell,
} from "./cell-helpers.ts";
import { foldControl } from "./row-controls.ts";
import { LIST_COLUMNS, notVerifiedMark } from "./row-shared.ts";
import { nextPhase, rowAnchorId, specNumber } from "./row-state.ts";

// One line about the spec: what NOTHING ELSE on the row says. It used
// to fall back to "no status recorded yet" rather than go blank, on the
// grounds that a line blank on half the rows reads as a page that failed
// to load; spec 176 overturned that outright. No phase status belongs in
// this column at all — the markers and the State column are where a
// spec's progress is said — and a line with nothing to say says nothing.
function specSummary(g: SpecGroup): string {
  const bits: string[] = [];
  // NOT the title, and NOT the phase (2026-08-21), and NOT the
  // percentage (spec 167). The folder name above IS the title — in slug
  // form once landed, in the form's own words while it is not
  // (`specHeadRow`'s `spec` constant, spec 307) — and said it twice; the
  // phase is what the pips and the State column are for. The percentage
  // counted the checkbox rows the implement step ticks, and implement is
  // ONE step — so it read 0 until implement finished and 90-something
  // after, never anything between. Two specs on the same day both read
  // "0% done", one with 21 task rows behind it and one with 4. What is
  // left is what neither the pips nor the badge carries.
  // Spec 208. Whatever git knows about this spec is not in yet — the
  // schedule that fills the caches has not reached it. Said out loud
  // rather than drawn as "nothing has run": that false negative is the
  // whole reason the peeks carry a `checkedAt` at all.
  if (g.freshnessUnknown) bits.push(CHECKING);
  // By NUMBER since 2026-08-21, not by folder. This line used to match
  // `aide-run-spec`'s dependency refusal word for word, which names the
  // whole folder; the number is what a reader recognises, it is
  // unambiguous because a number is never reused, and the folder name
  // made the line longer than the row it sits in.
  if (g.dependsOn.length) bits.push(`depends on: ${g.dependsOn.map((d) => esc(specNumber(d))).join(", ")}`);
  return bits.join(" · ");
}

// The header line for one spec: what it is, how far it has got, what it
// has cost in total, and — beside the state that says why — the one
// thing that can be done about it (`stateAction`, spec 157). Which
// phases a press would run is said on the phase lines beneath
// (`phaseSubRows`), one box per line, and on the button's own label.
export function specHeadRow(
  g: SpecGroup,
  opts: SpecsPageOptions,
  opened: Set<string>,
): string {
  const lang = opts.lang ?? "en";
  // Whether this row is a RECORD rather than a control (spec 224). It
  // is asked once here and consulted wherever the row would otherwise
  // read live-only state, exactly as `busy` already is — the difference
  // being that `busy` says "not right now" and this says "not ever
  // again, without a Reopen first".
  const locked = isArchivedRow(g);
  // Four answers, not three: a spec that has never run, one with a job in
  // flight, one whose last job is over, and an archived one. Written as
  // `data-run`, a marker no stylesheet styles.
  const runState = locked ? "archived" : !g.lead ? "new" : inFlight(g.lead) ? "live" : "past";
  // The spec name is the way IN, and since spec 150 it opens the SPEC —
  // all four of its files as they stand — rather than whichever job
  // happened to run last. Which means EVERY spec has somewhere to point:
  // the old branch here said "a spec that has never run has no job page
  // to point at, so the name is text", and that is the sentence the spec
  // page invalidates. The phase lines below still link to jobs, because
  // a phase's page is that phase's own run.
  // The diff link sits beside it rather than replacing it — nothing a
  // reader uses today disappears.
  // `.label` so the name clamps to two lines with an ellipsis
  // (src/render/css.ts `.spec-name > .label`, reworked 2026-08-26): a
  // one-line clamp hid most of a long folder name behind a click.
  // `<project>:<folder>` since 2026-08-21. The project used to open the
  // line under the name, beside the title; it belongs to the NAME — a
  // folder number is only unique within its project — and the line
  // under it now carries what nothing else says.
  // `data-goto` (spec 208): a real navigation to a different document,
  // which no script can swap in — so the click is MARKED and the
  // browser is left to get on with it. Without it the reader saw the
  // old page, unchanged, for however long `specPageView` took, and a
  // click that changes nothing reads as a click that did not register.
  // A create job's spec has no folder yet (REQ-1/REQ-2, spec 307), so
  // the row names itself after the title given on the New spec form.
  // The PROJECT is known from the first moment either way, and is drawn
  // on both: a create row without it was the one row on the list shaped
  // differently from every other, for no reason a reader could see.
  // What changes when the folder lands is that the name becomes a link
  // — there is a page to open now — and gains its number, the
  // identifier every other surface uses for this spec.
  // The number, then the spec's own TITLE. The number is the identifier
  // every other surface uses and is never reused; the title is what a
  // reader recognises the spec by. The slug between them said the title
  // over again in hyphens, and is left to the link's href.
  // A create job has neither number nor folder yet, so its row is the
  // title alone until the folder lands.
  // No title on disk — a spec whose 1-description.md says none — leaves
  // the folder name standing on its own: it already carries the number,
  // and prefixing it again read "81-81-queue-and-runner".
  const number = g.named ? g.specFolder.split("-")[0] : "";
  const specName = g.title ? (number ? `${number}-${g.title}` : g.title) : g.specFolder;
  // The project is a link to its page and the rest a link to the spec:
  // two anchors side by side inside the label's flex row, the colon in
  // the spec's, with no whitespace between them so the two touch.
  const project = projectLink(g.project, { className: "muted" });
  const spec = g.named
    ? `<span class="label">${project}<a class="specpart" data-goto href="${esc(specPagePath(g.project, g.specFolder))}" ` +
      // The tooltip is the IDENTIFIER — project and folder — which is
      // what a reader copies into a command or another page.
      `title="${esc(g.project)}:${esc(g.specFolder)}">` +
      // The name in a span of its own beside the colon (2026-09-10):
      // the label is a flex row, so a name that wraps hangs under
      // itself — every line starting where the number does — rather
      // than running back under the project on its second line.
      `<span class="muted">:</span><span class="specname">${esc(specName)}</span></a></span>`
    // No `title` attribute here: the whole name is already on the line,
    // and a tooltip repeating it would put the spec's title on the page
    // twice (`row-links-and-branches.test.ts`). There is no spec page to
    // open yet, so only the project is a link.
    : `<span class="label">${project}<span class="specpart"><span class="muted">:</span><span class="specname">${esc(specName)}</span></span></span>`;
  // A pull request open for this row's branch is a fact about the work,
  // not a second state the spec is IN (REQ-1, spec 403 — reversing spec
  // 339's own REQ-1, which put it here): it is true for the whole window
  // from implement opening one to the branch finally landing, so it says
  // nothing about which of the states the spec passes through in between
  // it sits beside. It is said on the notice line instead, ranked among
  // this row's other marks (`errorMarkNotices`/`archivedRowNotices`,
  // row-marks.ts).
  // The earliest phase the spec's own files say has not happened — the
  // same one `chosenSteps`/`actionState` name a box or a button for
  // (spec 439's rename of `preTicked`/`actionLabel`), from the same
  // `nextPhase()` call below, so the badge and the button cannot name
  // different phases (spec 191).
  // Worded for a reader here through `stepLabel`, so a phase added to
  // `STEP_LABELS` later reaches this sentence too.
  // NOT on a locked row (spec 224). `nextPhase` deletes `archive` from
  // the done-set before it looks for what is missing — right for a spec
  // still on the active list, and wrong for one whose folder has already
  // moved: it resolves to "archive" for every archived spec there is,
  // and `restingChip` would draw "ready" beside a spec that is finished.
  // What the State column says for a locked row, drawn directly rather
  // than through `stateCell`/`restingChip`: those two answer "what is
  // happening, and what can happen next", and for this row the answer to
  // both is that it is over — the bare word, always (REQ-1, spec 339).
  // A branch left open or not landed is an ERROR, not a second state,
  // and is said on the notice line instead (`archivedRowNotices`).
  // spec 406, REQ-7: a closed row's badge word is CLOSED_STATE
  // ("closed"), never ARCHIVED_STATE — same literal-word precedent this
  // badge already followed for "archived", now told apart by `g.state`.
  const stateBadge = headStateBadge(g, lang);
  // What goes under the name. A locked row draws nothing here (spec
  // 257) — `specSummary` has no path for it at all: it draws a title
  // for an unnamed create job and the dependency list, and an archived
  // row is `named` with nothing left to depend on. The description
  // stays searchable (`g.description`, read by `matchesSearch`); only
  // showing it under the title goes.
  const under = locked ? "" : `<div class="spec-title">${specSummary(g)}</div>`;
  return (
    // `data-folder`, not `data-spec`: the attribute NAME would otherwise
    // end in the same "a-spec" that half the fixtures use as a folder,
    // and a test looking for a spec by name would find the markup.
    // `data-run` sits BEFORE `data-folder`: about twenty test helpers read a
    // head row by `data-folder="…">` with the `>` directly after it.
    `<tr class="spechead" id="${esc(rowAnchorId(g))}" data-run="${runState}" data-folder="${esc(g.specFolder)}">` +
    // The whole row wide, since 2026-09-22. It spanned the Spec and
    // Phase columns until then, and a long project name ate the line: a
    // spec on `woodstack-climate` started its title nearly halfway
    // across the cell and wrapped after a handful of words, while the
    // three figures to the right sat on a line of their own anyway.
    // Nothing else stands on this line, so there is nothing for the
    // title to share it with.
    // The row's own button rides with the name, at the end of the name
    // box — where the pips were until 2026-09-07. The workflow is
    // LINEAR, so the button's label says how far the spec has come:
    // "Implement" means create and analyze are behind it. The pips drew
    // that same fact a second time, in the widest column on the row.
    //
    // The badge is left alone in the State cell by the same move, which
    // is what lets the table align the two by column instead of by two
    // hand-set widths inside one cell.
    // The chevron spans BOTH of the header's lines and is centred in
    // them: it opens the whole spec, not the title line, and a control
    // one line tall was hard to hit (asked for 2026-09-22). Out here it
    // also gives the title and the pips below it the same left edge for
    // nothing — they both start where this cell ends.
    `<td class="foldcell" rowspan="2" data-col="fold">${foldControl(g, opts.filter ?? {}, opened, lang)}</td>` +
    `<td colspan="${LIST_COLUMNS - 1}"><div class="spec-name">${spec}` +
    `</div>` +
    notVerifiedMark(g, lang) +
    under +
    `</td>` +
    `</tr>` +
    // Line 2, its own row since the title took line 1 whole. A ROW and
    // not a grid on the one above: the table already sizes these
    // columns, and it drops them one at a time as the box narrows
    // (list.css's four breakpoints) — mirroring those percentages in a
    // grid would be the same six widths written twice. What a phone
    // shows falls out of the same markup: there the last three columns
    // are zero, so the figures land beside the badge by themselves,
    // which is what narrow.css used to lay out by hand.
    //
    // `data-folder` again, so a helper can find this line on its own;
    // the anchor id, `data-run` and the `spechead` class stay on the
    // title's row, which is the row every other reader looks for.
    `<tr class="specstate" data-folder="${esc(g.specFolder)}">` +
    // The pips at the left, in the columns the title no longer needs:
    // the button's label says how far the spec has come, and the pips
    // say the same at a glance for a row that is shut.
    `<td colspan="2"><span class="pipslot">${phasePips(g.phases, g.done)}</span></td>` +
    // The badge says what is happening, or — once nothing is — the
    // resting state and what can happen next (spec 132). A sentence
    // under it said what to press until spec 174: the control names the
    // phase it would run, so the line was telling a reader to press what
    // they were looking at, to do what it already said. The pips and the
    // badge each answer a narrower question of their own.
    //
    // No button stands here: the row's one action rides the caption line
    // inside the fold (`phase-rows.ts`), so this row is information and
    // nothing else.
    // `.badgeslot` mirrors `.actionslot`: an invisible holder that can
    // reserve a width (mobile does) without stretching the pill inside
    // it — a min-width on the badge itself widened the coloured pill
    // (2026-08-24).
    // The pips ride in front of the badge for a PHONE only (narrow.css
    // lays the two out on the row's second line, the pips at the left
    // and the badge over the phases' own state column). A desktop hides
    // them: there the button's label already says how far the spec has
    // come, and the pips drew that fact a second time.
    `<td data-col="state"><span class="badgeslot">${stateBadge}</span></td>` +
    // When the spec was made (spec 317, REQ-1/REQ-6) — one call for
    // either kind of row, now that `readerGroup()` copies an archived
    // row's own answer onto these same top-level fields.
    // How long the spec's phases have come to, summed (spec 199, spec
    // 281). The column used to hold the most recent job's own start, so
    // every run threw the row to the top of a list sorted by it — and
    // later, the spec's own creation date instead, which stopped
    // moving but stopped saying anything about the work either. A dash
    // where nothing has settled yet: deliberately not a creation date,
    // which is the text this change removes from this cell for good.
    (locked
      ? `<td class="archive-date" data-col="started">${archiveDateCell(g.totalDurationMs ?? 0)}</td>`
      : `<td data-col="started">${activeDurationCell(g)}</td>`) +
    `<td class="num" data-col="cost">${costCell(g.spentUsd, g.spentTokens, "–", g.done.length > 0)}</td>` +
    // Last, after the two figures a phase line also fills (2026-09-08):
    // a phase has no creation date of its own, and this column standing
    // in the middle left an empty cell on every phase line between the
    // state and the numbers.
    `<td class="created-date" data-col="created">${createdCell(g.createdAt, g.createdAtChecking ?? false, isFinishedGroup(g), lang)}</td>` +
    `</tr>`
  );
}

/** The spec's own state badge — what the head row draws in the State
 *  column. Shared with the caption line under an open row
 *  (phase-rows.ts), which draws it again on a phone: there the head
 *  row's badge sits under the name, and the copy stands over the
 *  phases' states so the column reads down (2026-09-10).
 *  A locked row is over — the bare word, always (REQ-1, spec 339); a
 *  closed row's word is CLOSED_STATE, never ARCHIVED_STATE (spec 406).
 *  A spec with no job in the queue's memory reads through `restingChip`
 *  (spec 176). */
export function headStateBadge(g: SpecGroup, lang: Language): string {
  const locked = isArchivedRow(g);
  const nextStep = locked ? undefined : nextPhase(g.done);
  const readyPhase = nextStep ? stepLabel(nextStep) : undefined;
  const heldBack = g.phases.find((p) => p.step === "archive")?.heldBack?.reason;
  return locked
    ? badge("done", capitalizeFirst(g.state === CLOSED_STATE ? CLOSED_STATE : ARCHIVED_STATE))
    : g.lead
      ? stateCell(g.lead, lang, { archiveHeldBack: heldBack, readyPhase })
      : restingChip(lang, { archiveHeldBack: heldBack, readyPhase });
}
