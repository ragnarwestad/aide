// One line per phase, in the workflow's own order, whether or not it
// has happened.

import { PHASE_TAB, specTabPath } from "../spec-page.ts";
import { badge, phaseChip, stepLabel } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import { anyCostUnmeasured, wordPhase } from "../../ui/job-state.ts";
import type { QueuePageOptions } from "../queue-list.ts";
import { QUEUE_STEPS, groupKey, isArchivedRow, type SpecGroup } from "./data-model.ts";
import { costCell, phaseDurationCell, phaseWordCell } from "./cell-helpers.ts";
import { aiPicker, lockedDuration, modelPicker, phaseAiModel, phaseCaptionCells, SHORT_TOOL_NAMES } from "./model-picker.ts";
import { busyReason, preTicked, runFormId, specBusy } from "./row-state.ts";

// Ticked and locked: the box answers "has this phase run", nothing
// else. Shared by `create` (always) and by any other phase once
// `g.done` proves it ran (spec 267) — the two call sites differ only
// in WHEN they reach here, never in what they draw.
function finishedPhaseChip(step: string): string {
  return phaseChip({
    dataAttr: "data-phase",
    value: step,
    label: "",
    ariaLabel: `${stepLabel(step)} — already done, and not a step you can run`,
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
  // A caption heads a control (spec 265): a locked row draws the same AI
  // and model selects a live one does now, so it heads them the same
  // way — the only reason this stays conditional at all is `aiPicker`'s
  // own rule, one tool configured is nothing to choose between.
  if ((opts.modelChoices ?? []).length) {
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
      // The phase's own name. It wore a fold control on mobile until
      // 2026-09-07 — a chevron per phase line, whose only job was to
      // hide the AI/model pair on a narrow screen. The pair fits beside
      // the name at every width this list is drawn for (`narrow.css`
      // states the floor), so there is nothing left to fold and no
      // control to explain.
      const name = `<span class="phasefold">${nameLink}</span>`;
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
      // The larger of what the queue remembers and what the phase's own
      // file has stamped (spec 341) — the queue wins while it still
      // holds every attempt (including one still in flight, not yet
      // stamped); the file wins once the queue has forgotten the
      // earliest of them, or once the phase is archived and the queue
      // has nothing left for it at all.
      const attemptCount = Math.max(p.attempts.length, p.attemptCount ?? 0);
      // The count alone where it is drawn, and the word in the title:
      // "done (2)" beside a state word is short enough for the column
      // it shares, and a reader who wonders what the 2 counts gets
      // "2 attempts" on hover.
      const tries =
        attemptCount > 1
          ? `<span class="muted small" title="${attemptCount} attempts">(${attemptCount})</span>`
          : "";
      // Live although the row is busy (spec 160): a phase this run has
      // not reached, which the reader may add to it or drop from it as
      // the run goes.
      const live = editable.has(p.step);
      // Since spec 267 it is no longer the only phase drawn this way:
      // `finished` below reaches the same `finishedPhaseChip` once
      // `g.done` proves a QUEUE_STEPS phase ran too.
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
      // by hand (via /aide-reset, outside this row) still reports the
      // older `g.done`, and the busy arm beneath this one already renders
      // that correctly, with its own reason in the title; this branch
      // must not shadow it. But a job retrying a LATER phase (e.g.
      // archive, after an earlier landing failure) does not name an
      // already-finished earlier phase at all — `g.lead.steps` is fixed
      // at that job's own creation — and such a phase must keep reading
      // as done, exactly as it does while the row is idle. Same test the
      // busy branch's own `checked` uses two lines below, for the same
      // "did THIS job name this step" question.
      const finished =
        QUEUE_STEPS.includes(p.step) &&
        p.step !== "archive" &&
        g.done.includes(p.step) &&
        !(busy && g.lead?.steps.includes(p.step));
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
        : finished
        ? finishedPhaseChip(p.step)
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
        : finishedPhaseChip(p.step); // `create`'s own arm, same shape
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
      // The recorded string is always "<tool> <model>" (spec 244's
      // `aide-run-spec` format), so the model half — the one the live
      // picker's own options are keyed on — is everything after the
      // first word.
      const recordedModel = p.model?.split(" ").slice(1).join(" ") || undefined;
      const pickCell =
        `<td class="modelcell"><span class="row">` +
        // No effort control: the line names the AI and the model, and
        // the effort a step runs at is a configuration answer, not a
        // per-row pick.
        aiModel(g, opts, p.step, busy, live, latest?.model, recordedModel) +
        `${box}</span></td>`;
      // Does this phase's own file say it ran at all (spec 274/247/284's
      // fallback in `phasesFor`), even with no Cost line recorded? Used
      // by BOTH branches below — an archived `create` line is exactly as
      // permanently costless as a live one, so the blank-vs-unknown fix
      // has to reach both, not just the live row.
      const ranWithNoCost = p.timeSpentMs !== undefined || p.cost !== undefined || p.tokens !== undefined;
      lines.push({
        tag: `<tr class="subrow" data-step="${esc(p.step)}">`,
        cells:
          // The name alone, hard left: it is what the eye lands on
          // first, and it started 2.5rem in behind the box until spec
          // 165 moved the box in beside the model.
          `<td class="phasecell">${name}</td>` +
          pickCell +
          `<td>${phaseWordCell(word, `${stale}${tries}`)}</td>` +
          // Blank: a phase line has no creation date of its own to
          // draw — only alignment with the head row's real cell (spec
          // 317, LIST_COLUMNS).
          `<td data-col="created"></td>` +
          // The phase's own duration, not when it began (spec 199).
          // Same physical column, a different question per row type —
          // which this column already did before, and which is what
          // makes "how long did this take?" readable without a column
          // of its own. A live row with no queue-job attempt falls back
          // to the same file-stamped figure a locked row reads.
          `<td data-col="started">${
            phaseDurationCell(latest, p.step, now) || lockedDuration(p.timeSpentMs, locked)
          }</td>` +
          `<td class="num" data-col="cost">${
            locked
              ? costCell(p.cost ?? 0, p.tokens, ranWithNoCost ? "–" : "", p.costUnmeasured)
              : latest
                ? costCell(latest.spentUsd, latest.spentTokens, "", anyCostUnmeasured(latest.results))
                // No queue job for this phase, but its own file carries
                // a stamped record: it ran, and its cost is genuinely
                // unknown rather than unattempted — an explicit "–"
                // (REQ-3), never a blank indistinguishable from "not
                // run", never an invented $0.
                : ranWithNoCost
                  ? costCell(p.cost ?? 0, p.tokens, "–", p.costUnmeasured)
                  : ""
          }</td>`,
      });
    });
  // Spec 386 drew the same switch as the New-spec page here, on a row
  // of its own. Spec 394 (REQ-2, REQ-8) removes it: the choice now lives
  // on the spec page's own banner and is recorded on the spec itself,
  // so a later job for this spec reads that record instead of asking
  // again from a checkbox unchecked by default on every render.
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
  opts: QueuePageOptions,
  step: string,
  busy: boolean,
  live: boolean,
  used?: string,
  recordedModel?: string,
): string {
  const ai = aiPicker(g, opts, step, busy, live, used, recordedModel);
  const model = modelPicker(g, opts, step, busy, live, used, recordedModel);
  if (!model) return `<span class="aimodel">${ai}</span>`;
  const on = phaseAiModel(g, opts, step, used, recordedModel);
  const now = on ? `${SHORT_TOOL_NAMES[on.tool] ?? on.tool}/${on.model}` : "";
  const locked = isArchivedRow(g) || (busy && !live);
  const id = `aim-${groupKey(g.project, g.specFolder)}-${step}`;
  const button = locked
    ? `<span class="aimodelnow" aria-disabled="true" title="${esc(busyReason(g))}">${esc(now)}</span>`
    : `<input type="checkbox" class="aimodelopen" id="${esc(id)}">` +
      `<label class="aimodelnow" for="${esc(id)}" title="${esc(now)}">${esc(now)}</label>`;
  return (
    `<span class="aimodel">${button}<span class="aimodelpanel">` +
    (ai ? `<label class="aimodelfield"><span>AI</span>${ai}</label>` : "") +
    `<label class="aimodelfield"><span>Model</span>${model}</label>` +
    `</span></span>`
  );
}
