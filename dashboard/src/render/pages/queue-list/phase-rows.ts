// One line per phase, in the workflow's own order, whether or not it
// has happened. Split out of cells.ts (split cells.ts by theme).

import { PHASE_TAB, specTabPath } from "../spec-page.ts";
import { ICON_CHEVRON, badge, phaseChip, stepLabel } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import { anyCostUnmeasured, wordPhase } from "../../ui/job-state.ts";
import type { QueuePageOptions } from "../queue-list.ts";
import { QUEUE_STEPS, isArchivedRow, type SpecGroup } from "./data-model.ts";
import { costCell, phaseDurationCell, phaseWordCell } from "./cell-helpers.ts";
import { aiPicker, lockedDuration, lockedModel, modelPicker, phaseCaptionCells } from "./model-picker.ts";
import { busyReason, preTicked, runFormId, specBusy } from "./row-state.ts";

// The line is where a phase is TICKED since spec 124 — the box the
// header's strip of chips used to carry, on the phase's own line,
// beside the picker for the next run of it. What it does NOT carry is
// a Run button: one press runs whatever is ticked, from the row's one
// action beside the state.
//
// The box is built without `done`: the phase's own State column, the
// next cell along, already says "done", and a checkmark here said it a
// second time, in a second alphabet. It stays tickable — rerunning a
// finished phase is the same submission it always was.
//
// The leading cell is the phase's NAME, hard left and alone (spec
// 165). It was the action column's, reserved and never filled, until
// spec 157 moved the row's one button beside the state.
export function phaseSubRows(g: SpecGroup, opts: QueuePageOptions, now: number): string {
  const busy = specBusy(g);
  // The row is a record, not a control (spec 224). Read once here, like
  // `busy` beside it, and consulted where a line would otherwise offer a
  // press the server refuses.
  const locked = isArchivedRow(g);
  // Row-level, all three: which phases a press would run and why the
  // row will not take a click. Row-level facts, so they are asked once
  // and consulted per phase — the same shape `busy` itself already had.
  // Which step is being worked was a fourth until spec 168, read by
  // nothing but the spinner that used to sit on that phase's box.
  const ticked = preTicked(g);
  const why = busy ? busyReason(g) : "";
  // Spec 160: the phases this run can still be given or relieved of.
  // The server worked it out from the job as it stands — the row does
  // not re-derive it, so a live box and the route that takes its tick
  // can never disagree about where the tail starts. Empty for every
  // job that is not running, which is what keeps the brief `queued`
  // window between two steps looking exactly as it does today.
  const editable = new Set(g.lead?.editableSteps ?? []);
  // Every sub-row's tag and its cells, kept apart because the tag
  // carries the step and the cells carry the line. There is no cell
  // spanning them any more: the row's one action moved beside the
  // state (spec 157), and the phase lines took the left edge it left
  // — which is where "left of the phases" always meant.
  const lines: { tag: string; cells: string }[] = [];
  // A caption heads a control. A locked row draws no AI and no model
  // select (spec 224), so "AI" and "Model" would stand over an empty
  // cell — the same reason `aiPicker` draws nothing below two tools.
  if (!locked && (opts.modelChoices ?? []).length) {
    lines.push({
      tag: `<tr class="subrow" data-caption="1">`,
      cells: phaseCaptionCells(opts),
    });
  }
  g.phases
    .forEach((p) => {
      const latest = p.attempts[0];
      const word = wordPhase(g.done.includes(p.step), p.heldBack, latest, p.history);
      // Spec 237: a phase line opens the tab that shows what the phase
      // MADE, on the spec page the reader is already on — the four
      // workflow steps each have one, and `PHASE_TAB` is where the
      // mapping lives.
      //
      // Such a link is live whether or not the phase has ever run: the
      // tab is the spec's, not the run's, and it exists either way.
      // That is the same reason spec 150 gave a never-run SPEC somewhere
      // to point. A step OUTSIDE the four has no tab that speaks for it
      // and keeps the old rule exactly: its own job page, or plain text
      // when nothing has run it.
      const tab = PHASE_TAB[p.step];
      const href =
        tab ? specTabPath(g.project, g.specFolder, tab)
        : latest ? `/specs/${latest.id}`
        : undefined;
      const nameLink = href
        ? `<a href="${esc(href)}">${esc(stepLabel(p.step))}</a>`
        : `<span class="muted">${esc(stepLabel(p.step))}</span>`;
      // On mobile the AI/model selects are folded behind this control by
      // default (design handoff, mobile-spec-row): reading the list to
      // check status should not carry setup controls on every line. The
      // checkbox is invisible outside the mobile media query, so desktop
      // is unaffected — `.phasefold` is a plain inline wrapper there.
      // Only `.aimodel`'s own visibility toggles on the checkbox
      // (2026-08-24): `.modelcell` itself stays display:block on every
      // subrow, open or shut, so the table's column layout never
      // depends on which rows happen to be open — that inconsistency
      // was the actual bug the first version of this control had.
      // Not on a locked row (spec 224): what this folds away is the
      // `.aimodel` pair, and a locked line draws neither — so the
      // chevron would be a control that hides nothing, and the one
      // thing that may take a click on such a row is Reopen.
      const name = locked
        ? nameLink
        : `<label class="phasefold">` +
          `<input type="checkbox" class="foldphase">` +
          `<span class="foldchevron">${ICON_CHEVRON}</span>${nameLink}</label>`;
      // The latest attempt, with a count when there have been more —
      // three archive runs on one spec is a real history, not a row to
      // repeat three times.
      // The plan is about an older problem than the description is: said
      // on the analyze line, because analyze is the phase that has to
      // run again. Amber, like every other "worth noticing, not
      // alarming" mark on this page — and it blocks nothing.
      const stale =
        p.step === "analyze" && g.analyzeStale
          ? " " +
            badge(
              "waiting",
              "description changed since",
              "1-description.md was committed after the last finished analyze",
            )
          : "";
      const tries =
        p.attempts.length > 1 ? `<span class="muted small">${p.attempts.length} attempts</span>` : "";
      // Live although the row is busy (spec 160): a phase this run has
      // not reached, which the reader may add to it or drop from it as
      // the run goes.
      const live = editable.has(p.step);
      // What the last run used is not spelled out in text any more —
      // it IS the picker's pre-filled value, in the column the caption
      // calls "Model".
      // `create` gets a box that is ticked and cannot be untucked: the
      // folder being on disk IS its answer, and a spec that exists
      // cannot be created again. It had no box at all until
      // 2026-08-21, and the hole where the other four have one made
      // the line read as a different KIND of thing rather than as the
      // one phase already behind you. It carries no `name`, so no
      // press can ever post `steps=create` — a disabled input is not
      // submitted either, and this is the belt as well as the braces.
      const box = locked
        ? phaseChip({
            dataAttr: "data-phase",
            value: p.step,
            label: "",
            ariaLabel: `${stepLabel(p.step)} — this spec is archived`,
            // Nothing to post and no form to post it to: `reopen` is the
            // one step an archived spec may be asked for, and the row's
            // Reopen carries it as a hidden field of its own.
            name: "",
            // What HAPPENED, not what a press would run next (spec 224).
            // `preTicked` answers the second question — and for a spec
            // whose workflow is over it always answers `{archive}`
            // alone, which would tick the one step this row did not have
            // and leave the ones it did unticked.
            checked: g.done.includes(p.step),
            disabled: true,
            // Inert, not padlocked — the same reason spec 145 gives for
            // a phase queued behind the running one: the tick says what
            // there is to say, and a padlock on all four of them would
            // be the row saying "archived" a fifth time.
            plain: true,
          })
        : QUEUE_STEPS.includes(p.step)
        ? phaseChip({
            // `data-phase`, not `data-step`: the line already carries
            // `data-step`, and one attribute per question keeps a test
            // that enumerates boxes from finding the lines too.
            dataAttr: "data-phase",
            value: p.step,
            // No visible label — the phase's own name leads the line
            // and the caption calls this column "Select". The
            // accessible one is given outright, since a wrapper with
            // no text has no name to offer.
            label: "",
            ariaLabel: stepLabel(p.step),
            // An editable box is never posted with the Run form: while
            // a job runs, that form asks for a SECOND job and the
            // queue refuses it as a clash. It still NAMES the form,
            // because that is how a press finds every control on the
            // row to lock — and a field with no name is submitted by
            // nobody, whatever it names.
            name: live ? "" : "steps",
            form: runFormId(g),
            postTo: live ? `/api/queue/${esc(g.lead!.id)}/steps` : undefined,
            // While busy this says what the RUNNING job will do with
            // the step, not what a fresh press would pre-tick
            // (`ticked`) — a step queued behind the running one is
            // still one this job named, and still reads as ticked.
            checked: busy ? !!g.lead?.steps.includes(p.step) : ticked.has(p.step),
            // The step being run had a carve-out here until spec 168,
            // because its box was drawn as a spinner instead. It falls
            // under the ordinary rule now and lands in the same place:
            // a running step is never `live` — `live` names a step the
            // run has NOT reached — so `busy && !live` disables it
            // exactly as the carve-out did.
            disabled: busy && !live,
            // Inert, but not padlocked: the tick already says whether
            // this job will get to the step (spec 145).
            plain: true,
            // A box the reader can still act on says what the tick
            // WOULD do; the rest say why the row will not take a
            // click.
            title: live
              ? `not started yet — ${g.lead?.steps.includes(p.step) ? "untick to drop it from this run" : "tick to add it to this run"}`
              : busy
                ? why
                : undefined,
          })
        : phaseChip({
            dataAttr: "data-phase",
            value: p.step,
            label: "",
            ariaLabel: `${stepLabel(p.step)} — already done, and not a step you can run`,
            // No name: nothing to post, whatever a browser decides to
            // do with a disabled field.
            name: "",
            checked: true,
            disabled: true,
            // Inert, not padlocked — the same reason spec 145 gives for
            // a phase queued behind the running one: the tick says what
            // there is to say.
            plain: true,
          });
      // The three choices this line offers, in one cell (spec 192): the
      // AI, then the model it fills in, then the phase's box. In the
      // order they are made in — which AI a phase runs on decides which
      // models there ARE to pick from, so it comes first.
      //
      // The AI had a column of its own from spec 165 to spec 192, and
      // one cell for the whole group before that — a span that had to
      // be kept level with `g.phases.length` and never a literal five,
      // since a spec whose past jobs touched a step outside the usual
      // set has that step appended as a line of its own. Neither is
      // needed now: every line writes this cell, whichever step it
      // names, and `aiPicker` simply draws nothing when there is one
      // configured AI and nothing to choose between.
      const pickCell =
        `<td class="modelcell"><span class="row">` +
        `<span class="aimodel">${aiPicker(g, opts, p.step, busy, live, latest?.model)}` +
        `${modelPicker(g, opts, p.step, busy, live, latest?.model)}</span>` +
        (locked ? lockedModel(p.step, p.model) : "") +
        `${box}</span></td>`;
      lines.push({
        tag: `<tr class="subrow" data-step="${esc(p.step)}">`,
        cells:
          // The name alone, hard left: it is what the eye lands on
          // first, and it started 2.5rem in behind the box until spec
          // 165 moved the box in beside the model.
          `<td class="phasecell">${name}</td>` +
          pickCell +
          `<td>${phaseWordCell(word, `${stale}${tries}`)}</td>` +
          // The phase's own duration, not when it began (spec 199).
          // Same physical column, a different question per row type —
          // which this column already did before, and which is what
          // makes "how long did this take?" readable without a column
          // of its own.
          `<td data-col="started">${locked ? lockedDuration(p.timeSpentMs) : phaseDurationCell(latest, p.step, now)}</td>` +
          `<td class="num" data-col="cost">${
            locked
              ? costCell(p.cost ?? 0, p.tokens, "", p.costUnmeasured)
              : latest
                ? costCell(latest.spentUsd, latest.spentTokens, "", anyCostUnmeasured(latest.results))
                : ""
          }</td>`,
      });
    });
  return lines.map((l) => `${l.tag}${l.cells}</tr>`).join("");
}
