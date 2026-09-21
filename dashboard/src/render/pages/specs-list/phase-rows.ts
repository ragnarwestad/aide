// One line per phase, in the workflow's own order, whether or not it
// has happened.

import { badge, phaseChip, stepLabel } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t } from "../../../i18n";
import { wordPhase } from "../../ui/job-state";
import type { QueueRowView } from "../../ui/job-state";
import type { SpecsPageOptions } from "./";
import { RUN_STEPS, groupKey, isArchivedRow, type SpecGroup } from "./data-model";
import { costCell, phaseDurationCell, phaseWordCell, specTotalCell } from "./cell-helpers.ts";
import { aiPicker, ALREADY_RUN_REASON, compactModelLabel, compactModelLabelFull, lockedDuration, modelPicker, phaseAiModel, phaseCaptionCells } from "./model-picker.ts";
import { chosenSteps, offersAnotherRound, runFormId, specBusy } from "./row-state.ts";
import { stateAction } from "./row-controls.ts";
import { NO_PULL_REQUEST, prErrorOf, prErrorSentence } from "./row-shared.ts";
import { headStateBadge } from "./head-row.ts";
import { phaseHasRun, phaseMessagesFold, phaseMessagesRow } from "./phase-messages";

/** The archive gates' own refusals: nothing was tried, so nothing is
 *  counted as an attempt. Hand-paired with run-spec-outcome.sh. */
const GUARD_REFUSALS = new Set(["not-implemented-yet", "acceptance-criteria-unticked"]);
const stepResultOf = (r: QueueRowView, step: string) => (r.results ?? []).find((x) => x.step === step);

// Ticked and locked: the box answers "has this phase run", nothing
// else. Shared by `create` (always) and by any other phase once
// `g.done` proves it ran (spec 267) — the two call sites differ only
// in WHEN they reach here, never in what they draw.
function finishedPhaseChip(step: string): string {
  return phaseChip({
    dataAttr: "data-phase",
    value: step,
    label: "",
    ariaLabel: `${stepLabel(step)} — ${ALREADY_RUN_REASON}`,
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
}

// The line is where a phase is TICKED since spec 124 — the box the
// header's strip of chips used to carry, on the phase's own line,
// beside the picker for the next run of it. What it does NOT carry is
// a Run button: one press runs whatever is ticked, from the row's one
// action beside the state.
//
// A phase this row's own history proves ran (`g.done`) is ticked and
// LOCKED, not tickable (spec 267) — the box answers one question only,
// has this phase run, and the phase's own State column already says
// "done" beside it. `archive` is excepted (a held-back archive stays
// offered from this row, see `finished` below), and so is a phase
// genuinely busy re-running by hand: the busy arm renders that case,
// with its own reason, and this rule only ever applies while idle.
//
// The leading cell is the phase's NAME, hard left and alone (spec
// 165). It was the action column's, reserved and never filled, until
// spec 157 moved the row's one button beside the state.
export function phaseSubRows(g: SpecGroup, opts: SpecsPageOptions, now: number): string {
  const busy = specBusy(g);
  // The row is a record, not a control (spec 224). Read once here, like
  // `busy` beside it, and consulted where a line would otherwise offer a
  // press the server refuses.
  const locked = isArchivedRow(g);
  // Row-level, like `busy` beside it: which phases a press would run.
  // Why the row will not take a click is asked per phase instead, in
  // `aiModel()` below (spec 454) — a live box and a locked one differ on
  // that question, and a row-level flag could not tell them apart.
  // Which step is being worked was a third until spec 168, read by
  // nothing but the spinner that used to sit on that phase's box.
  const ticked = chosenSteps(g, opts);
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
  // A caption heads a control (spec 265): a locked row draws the same AI
  // and model selects a live one does now, so it heads them the same
  // way — the only reason this stays conditional at all is `aiPicker`'s
  // own rule, one tool configured is nothing to choose between.
  // The row's one action, in the State column of the caption line
  // (2026-09-08): the head line above is what the spec IS, and this line
  // heads what it is set to do. Spec 157 put the button on the shut row
  // deliberately; what this costs is a click, and what it buys is a
  // head line that is only information.
  const action = stateAction(g, opts);
  // The spec's own state, drawn again on the caption line for a phone
  // (2026-09-10), inside the action slot so the row keeps its six cells:
  // hidden on a desktop, where the head row's badge is a column away; on
  // a phone the head row's badge sits under the name, and this copy
  // stands over the phases' states, with the action button at the
  // line's left — narrow.css lays the slot out.
  const headState = `<span class="headstate">${headStateBadge(g, opts.lang ?? "en")}</span>`;
  // The row's total beside it, the head row's own figure (spec 496): the
  // head row's Time cell is hidden on a phone, and this copy stands in
  // the Time column the phase lines use.
  const headTime = `<span class="headtime">${specTotalCell(g)}</span>`;
  if ((opts.modelChoices ?? []).length) {
    lines.push({
      tag: `<tr class="subrow" data-caption="1">`,
      cells: phaseCaptionCells(opts, true, action + headState + headTime, opts.lang ?? "en"),
    });
  } else if (action) {
    // No captions to head — one tool configured, nothing to choose
    // between — and the press still needs a line of its own.
    lines.push({
      tag: `<tr class="subrow" data-caption="1">`,
      cells:
        `<td class="phasecell"></td><td class="modelcell"></td>` +
        `<td data-col="state"><span class="actionslot">${action}${headState}${headTime}</span></td>` +
        `<td data-col="started"></td><td class="num" data-col="cost"></td><td data-col="created"></td>`,
    });
  }
  g.phases
    .forEach((p) => {
      const latest = p.attempts[0];
      const word = wordPhase(g.done.includes(p.step), p.heldBack, latest, { ...p.history, fileResult: p.fileResult, step: p.step });
      // The phase's own name, plain text: a phase line used to open the
      // tab the phase wrote (spec 237), but the mapping did not hold for
      // every phase — archive writes no file of its own, and a step
      // outside the fixed four pointed at its job page instead, with
      // nothing on the row saying why the destination differed — so the
      // name is text now, and the spec page stays reachable from the
      // spec's own name in the row's header line (spec 451).
      //
      // It wore a fold control on mobile until
      // 2026-09-07 — a chevron per phase line, whose only job was to
      // hide the AI/model pair on a narrow screen. The pair fits beside
      // the name at every width this list is drawn for (`narrow.css`
      // states the floor), so there is nothing left to fold and no
      // control to explain.
      const name = `<span class="phasefold">${esc(stepLabel(p.step, opts.lang))}</span>`;
      // The latest attempt, with a count when there have been more —
      // three archive runs on one spec is a real history, not a row to
      // repeat three times.
      // The plan is about an older problem than the description is: said
      // on the analyze line, because analyze is the phase that has to
      // run again. Amber, like every other "worth noticing, not
      // alarming" mark on this page — and it blocks nothing.
      // `gh` opened no pull request for THIS step's branch. The row's
      // panel carries the sentence for a reader; this says which of the
      // five lines it happened on, which is the one thing the panel
      // cannot say. A badge, not the text: a sentence beside a phase
      // badge runs off the right edge of the table.
      const noPullRequest = prErrorOf(p)
        ? " " + badge("refused", NO_PULL_REQUEST(opts.lang ?? "en"), prErrorSentence(opts.lang ?? "en"))
        : "";
      const stale =
        p.step === "analyze" && g.analyzeStale
          ? " " +
            badge("waiting", "description changed since")
          : "";
      // The larger of what the queue remembers and what the phase's own
      // file has stamped (spec 341) — the queue wins while it still
      // holds every attempt (including one still in flight, not yet
      // stamped); the file wins once the queue has forgotten the
      // earliest of them, or once the phase is archived and the queue
      // has nothing left for it at all.
      // A run the archive gates turned away before anything was tried
      // is a guard, not an attempt (2026-09-11) — the same two reasons
      // aide-run-spec leaves out of the file's own stamp
      // (run-spec-outcome.sh).
      const tried = p.attempts.filter((a) => !GUARD_REFUSALS.has(stepResultOf(a, p.step)?.terminalReason ?? ""));
      const attemptCount = Math.max(tried.length, p.attemptCount ?? 0);

      // Live although the row is busy (spec 160): a phase this run has
      // not reached, which the reader may add to it or drop from it as
      // the run goes.
      const live = editable.has(p.step);
      // Since spec 267 it is no longer the only phase drawn this way:
      // `finished` below reaches the same `finishedPhaseChip` once
      // `g.done` proves a RUN_STEPS phase ran too.
      //
      // A phase this row's own history proves ran. `archive` is excluded
      // on purpose (spec 267): a HELD-BACK archive — one that ran and
      // committed but declined to move the folder
      // (`archiveHeldBackReason`, parse-status.ts) — leaves `archive`
      // in `g.done` on a row that is still active, and stays offered
      // from this same row exactly as before, so its box keeps the
      // tickable treatment below.
      //
      // Busy excludes only the phase the CURRENT job is itself naming
      // (spec 286) — not the whole row. A job re-running this exact step
      // by hand (outside this row) still reports the
      // older `g.done`, and the busy arm beneath this one already renders
      // that correctly, with its own reason in the title; this branch
      // must not shadow it. But a job retrying a LATER phase (e.g.
      // archive, after an earlier landing failure) does not name an
      // already-finished earlier phase at all — `g.lead.steps` is fixed
      // at that job's own creation — and such a phase must keep reading
      // as done, exactly as it does while the row is idle. Same test the
      // busy branch's own `checked` uses two lines below, for the same
      // "did THIS job name this step" question.
      //
      // Analyze and Implement are excluded the same way while the
      // archive is held back on unticked acceptance criteria (spec
      // 471): the round may be run again from this row, and a locked
      // box was the one part of that rule with nothing to press. Only
      // while the row is idle — a press has nowhere to go while it is
      // busy, and the box would be saying "not run" about a phase that
      // has run.
      const finished =
        RUN_STEPS.includes(p.step) &&
        p.step !== "archive" &&
        g.done.includes(p.step) &&
        !(busy && g.lead?.steps.includes(p.step)) &&
        !(!busy && offersAnotherRound(g, p.step));
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
            // `chosenSteps` answers the second question — and for a spec
            // whose workflow is over, with no recorded choice, it falls
            // back to `{archive}` alone, which would tick the one step
            // this row did not have and leave the ones it did unticked.
            checked: g.done.includes(p.step),
            disabled: true,
            // Inert, not padlocked — the same reason spec 145 gives for
            // a phase queued behind the running one: the tick says what
            // there is to say, and a padlock on all four of them would
            // be the row saying "archived" a fifth time.
            plain: true,
          })
        : finished
        ? finishedPhaseChip(p.step)
        : RUN_STEPS.includes(p.step)
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
            // What the tick would do, or why the row will not take a
            // click, is said once for the whole phase line now — the
            // shared "(?)" `aiModel()` draws below (spec 454) — rather
            // than repeated on this box's own `title`.
          })
        : finishedPhaseChip(p.step); // `create`'s own arm, same shape
      // The three choices this line offers, in one cell (spec 192): the
      // AI, then the model it fills in, then the phase's box. In the
      // order they are made in — which AI a phase runs on decides which
      // models there ARE to pick from, so it comes first.
      //
      // The AI had a column of its own from spec 165 to spec 192, and
      // one cell for the whole group before that — a span that had to
      // be kept level with `g.phases.length` and never a literal five,
      // since a spec's phase lines are always the four. Neither is
      // needed now: every line writes this cell, whichever step it
      // names, and `aiPicker` simply draws nothing when there is one
      // configured AI and nothing to choose between.
      // The recorded string is always "<tool> <model>" (spec 244's
      // `aide-run-spec` format), so the model half — the one the live
      // picker's own options are keyed on — is everything after the
      // first word.
      const recordedModel = p.model?.split(" ").slice(1).join(" ") || undefined;
      // The Select box's own answer, read once for the two selects beside
      // it: a phase whose box is drawn ticked and disabled cannot be
      // given an AI or a model either. `finished` covers a phase this
      // row has run; a step outside `RUN_STEPS` — `create` above all —
      // is drawn the same way and is locked for the same reason. The
      // archived row and the busy one are the pickers' own, already.
      const alreadyRun = finished || !RUN_STEPS.includes(p.step);
      const pickCell =
        `<td class="modelcell"><span class="row">` +
        // No effort control: the line names the AI and the model, and
        // the effort a step runs at is a configuration answer, not a
        // per-row pick.
        aiModel(g, opts, p.step, busy, live, latest?.model, recordedModel, alreadyRun, latest?.results?.find((x) => x.step === p.step)?.tool) +
        `${box}</span></td>`;
      // Does this phase's own file say it ran at all (spec 274/247/284's
      // fallback in `phasesFor`), even with no Cost line recorded? Used
      // by BOTH branches below — an archived `create` line is exactly as
      // permanently costless as a live one, so the blank-vs-unknown fix
      // has to reach both, not just the live row.
      const ran = phaseHasRun(g, p);
      const ranWithNoCost = p.timeSpentMs !== undefined || p.cost !== undefined || p.tokens !== undefined;
      lines.push({
        tag: `<tr class="subrow" data-step="${esc(p.step)}">`,
        cells:
          // The name alone, hard left: it is what the eye lands on
          // first, and it started 2.5rem in behind the box until spec
          // 165 moved the box in beside the model.
          `<td class="phasecell">${phaseMessagesFold(g, p, opts, ran)}${name}</td>` +
          pickCell +
          `<td data-col="state">${phaseWordCell(word, stale + noPullRequest, attemptCount)}</td>` +
          // The phase's own duration, not when it began (spec 199).
          // Same physical column, a different question per row type —
          // which this column already did before, and which is what
          // makes "how long did this take?" readable without a column
          // of its own. A live row with no queue-job attempt falls back
          // to the same file-stamped figure a locked row reads.
          `<td data-col="started">${
            phaseDurationCell(latest, p.step, now) || lockedDuration(p.timeSpentMs)
          }</td>` +
          // `p.cost !== undefined` (spec 433), not `ranWithNoCost`: a
          // phase can have run (a stamped Time spent) with NO Cost: line
          // at all — REQ-3-AC1's own case, still an explicit "–", since
          // "ran" and "a real $0 was recorded" are different claims.
          // `ranWithNoCost` still decides the BLANK text (a phase that
          // ran at all reads "–", not empty); `p.cost !== undefined`
          // alone decides whether the figure itself is trusted as a
          // settled $0.
          `<td class="num" data-col="cost">${
            locked
              ? costCell(p.cost ?? 0, p.tokens, ranWithNoCost ? "–" : "", p.cost !== undefined)
              : latest
                ? costCell(latest.spentUsd, latest.spentTokens, "", latest.state === "done")
                // No queue job for this phase, but its own file carries
                // a stamped record: it ran, and — when the file's own
                // Cost: line is present — its cost is genuinely $0
                // rather than unattempted, never a blank indistinguishable
                // from "not run".
                : ranWithNoCost
                  ? costCell(p.cost ?? 0, p.tokens, "–", p.cost !== undefined)
                  : ""
          }</td>` +
          // Blank, and LAST since 2026-09-08: a phase line has no
          // creation date of its own to draw, and the empty cell used
          // to sit between the state and the two figures it does fill.
          `<td data-col="created"></td>`,
      });
      // The model's own messages, unfolded under the line (spec 500).
      const messages = phaseMessagesRow(g, p, opts, ran);
      if (messages) lines.push(messages);
    });
  // Spec 386 drew the same switch as the New-spec page here, on a row
  // of its own. Spec 394 (REQ-2, REQ-8) removes it: the choice now lives
  // on the spec page's own banner and is recorded on the spec itself,
  // so a later job for this spec reads that record instead of asking
  // again from a checkbox unchecked by default on every render.
  //
  return lines.map((l) => `${l.tag}${l.cells}</tr>`).join("");
}

/** The AI and the model a phase line offers, in one place.
 *
 *  Two shapes out of one DOM. Wide, the two selects stand side by side
 *  as they always have. Narrow, they do not fit — a 360px phone has
 *  room for one of them, not two — so a box eight characters wide says
 *  what the line is ON ("Claude/sonnet"), and a tap lays the two
 *  selects over it. The stylesheet decides which; the selects
 *  themselves are drawn once, with the same `name` and `form` they have
 *  always had, so nothing about what a press posts changes.
 *
 *  No JavaScript opens it: the box is a `<label>` for a checkbox, the
 *  same technique the phase fold used, and `menu-script.ts` closes it
 *  on a click outside or Escape the way it already closes the "…" menu.
 *  A locked line draws the box unpressable — its selects are a record,
 *  not a choice. */
function aiModel(
  g: SpecGroup,
  opts: SpecsPageOptions,
  step: string,
  busy: boolean,
  live: boolean,
  used?: string,
  recordedModel?: string,
  alreadyRun = false,
  usedTool?: string,
): string {
  const lang = opts.lang ?? "en";
  const ai = aiPicker(g, opts, step, busy, live, used, recordedModel, undefined, alreadyRun, usedTool);
  const model = modelPicker(g, opts, step, busy, live, used, recordedModel, undefined, alreadyRun);
  const locked = isArchivedRow(g) || (busy && !live) || alreadyRun;
  // No "(?)" on a phase line: the State column already says what is
  // running, and an archived or already-run phase needs no sentence to
  // say it cannot run again. The column has no room for a mark.
  if (!model) return `<span class="aimodel">${ai}</span>`;
  const on = phaseAiModel(g, opts, step, used, recordedModel, usedTool);
  // Two candidate strings, always both rendered (AC-1/AC-2, spec 488): the
  // SHORT one exactly as before, and a FULL one, always tool-prefixed.
  // Which of the two spans shows is a `narrow.css` media query's own
  // decision, not a runtime one — see that file's 400-600px band.
  const short = compactModelLabel(opts.modelChoices ?? [], on);
  const full = compactModelLabelFull(opts.modelChoices ?? [], on);
  const now = `<span class="aimodelshort">${esc(short)}</span><span class="aimodelfull">${esc(full)}</span>`;
  const id = `aim-${groupKey(g.project, g.specFolder)}-${step}`;
  const button = locked
    ? `<span class="aimodelnow" aria-disabled="true">${now}</span>`
    : `<input type="checkbox" class="aimodelopen" id="${esc(id)}">` +
      `<label class="aimodelnow" for="${esc(id)}">${now}</label>`;
  return (
    `<span class="aimodel">${button}<span class="aimodelpanel">` +
    (ai ? `<label class="aimodelfield"><span>${t(lang, "list.captionAi")}</span>${ai}</label>` : "") +
    `<label class="aimodelfield"><span>${t(lang, "list.captionModel")}</span>${model}</label>` +
    `</span></span>`
  );
}
