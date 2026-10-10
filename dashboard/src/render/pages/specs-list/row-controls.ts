// The forms and links a spec's row draws to act on it: fold, cancel,
// the compare links, reopen, and the one Run/Cancel control the State
// column carries.

import { askButton, btn, buttonForm, confirmDialog, foldArrow, stepLabel } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { currentStep, type QueueRowView } from "../../ui/job-state";
import { landingStep } from "../../ui/job-state/resting.ts";
import type { SpecsPageOptions } from "./";
import {
  groupKey,
  isArchivedRow,
  type SpecsFilter,
  type SpecGroup,
} from "./data-model";
import { reopenAskDialog } from "../spec-page/ask-dialog.ts";
import { queuePath } from "./filter-bar.ts";
import { actionState, rowAnchorId, runFormId, specBusy } from "./row-state.ts";
import { specPagePath } from "../spec-page/tabs.ts";

// The fold is a LINK, not a button, and the state is in the URL. That
// buys three things at once for no browser code at all: it works with
// script off, `specs-client.ts` already intercepts `a[data-nav]` inside
// `#jobrows` so a click neither reloads the page nor wipes a half-filled
// form, and the choice survives the table swapping itself every five
// seconds — the same mechanism the filter and the sort ride on.
export function foldControl(
  g: SpecGroup,
  f: SpecsFilter,
  opened: Set<string>,
  lang: Language,
  path?: string,
  /** The list opens one spec at a time at the spec's own address: the arrow
   *  loads that page, or the list to shut it, and the row's anchor keeps
   *  the row in view. */
  pageLoad = false,
): string {
  const key = groupKey(g.project, g.specFolder);
  const shut = !opened.has(key);
  if (pageLoad) {
    const { open: _fold, ...view } = f;
    return foldArrow({
      href: `${queuePath(view, {}, shut ? specPagePath(g.project, g.specFolder) : undefined)}#${rowAnchorId(g)}`,
      open: !shut,
      lang,
      title: "list.foldTitle",
      params: { folder: g.specFolder },
      goto: true,
    });
  }
  const next = shut ? [...opened, key] : [...opened].filter((k) => k !== key);
  return foldArrow({
    href: queuePath(f, { open: next.join(",") }, path),
    open: !shut,
    lang,
    title: "list.foldTitle",
    params: { folder: g.specFolder },
    data: { fold: "open", key },
  });
}

// Stopping a run is the one thing this form does. It offered Approve
// beside it until spec 149, for a job parked between two steps — there
// is no stop between steps any more, so there is nothing to release and
// nothing to approve.
//
// It says "Cancel" and nothing else. It named the step it would stop
// until 2026-08-21 — "Cancel implement" — on the argument that it
// should read like the Run button beside it; but a row has only ever
// one thing to cancel, the State column beside it already says which
// step is running, and the name added a word without adding an answer.
//
// Drawn only when there IS something to cancel. It used to be in the
// markup whatever the state, greyed out, so the width of the action
// column could not change from row to row (spec 124); that column is
// gone, and a row draws exactly one control now — an inert Cancel
// beside a live Run is the "two controls" this spec removes.
//
// A button, and the confirmation it opens over the row (spec 423): the
// reader never leaves the row they are watching. The dialog's OK is the
// row's `actionform`, which the page's own code posts; it does not stand
// while the job stops — the row's redraw after the post replaces it,
// dialog and all. It needs script, as Close and Reopen do.
function actionForm(r: QueueRowView, lang: Language): string {
  // Gated on `r.landing`, exactly like `specStateChip`/`busyReason`
  // already do (spec 423, REQ-3): `landingStep(r)` alone answers the
  // wrong question on an ordinary row queued for its NEXT step with no
  // landing in progress.
  const step = stepLabel(r.landing ? landingStep(r) : currentStep(r), lang);
  const id = `cancelask-${r.id}`;
  return (
    // Primary, like every row's one action (spec 161): `danger` was
    // supposed to set it apart, but in dark mode `--danger` and
    // `--accent` sit close enough in hue that an outlined Cancel and a
    // filled button beside it said nothing different to the eye. And a
    // cancelled run can be started again, so it was never what `danger`
    // is for.
    askButton({ label: t(lang, "list.cancel"), dialogId: id, variant: "primary" }) +
    confirmDialog(lang, {
      id,
      title: t(lang, "list.cancelConfirmTitle", { step }),
      sentence: t(lang, "list.cancelConfirmBody", { step }),
      ok: { variant: "primary", pending: t(lang, "list.cancelling") },
      post: { action: `/api/queue/${r.id}/cancel`, hook: "actionform" },
    })
  );
}

// Merging was a button here until spec 149, with a long comment about
// what it said and where it said it. It says nothing now, because it is
// not pressed: every step lands the work it produced, `implement` alone
// leaves its branch open on purpose, and `archive` is what lands that.
// `mergeForm`, `mergeReadyLabel` and `isCodeRepo` went with it —
// `isCodeRepo` existed only so the button's own sentence could say
// whether it would land the plan or the code.

/** Reopen's dialog over the list, `id` being the one its button names.
 *  Whether the job ends done or not, the reader comes back to the list as
 *  it was: the list's own address is where the script goes either way. */
export function listReopenDialog(
  g: SpecGroup,
  filter: SpecsFilter | undefined,
  lang: Language,
  id: string,
  path?: string,
): string {
  const list = queuePath(filter ?? {}, {}, path);
  return reopenAskDialog(g.project, g.specFolder, lang, {
    id,
    back: list,
    done: list,
  });
}

/** The one action an archived spec offers (spec 198, on its row since
 *  spec 221): a button, and the dialog it opens beside it. */
function reopenAsk(g: SpecGroup, opts: SpecsPageOptions, lang: Language): string {
  const id = `reopenask-${groupKey(g.project, g.specFolder)}`;
  return askButton({ label: t(lang, "list.reopen"), dialogId: id, variant: "primary" }) + listReopenDialog(g, opts.filter, lang, id, opts.listPath);
}

/** The press an archived row's "still on origin" note carries: a POST
 *  that deletes the merged branch on origin. */
export function deleteBranchForm(g: SpecGroup, lang: Language): string {
  return buttonForm({
    action: `/api/queue/specs/${g.project}/${g.specFolder}/delete-branch`,
    hook: "actionform",
    button: { label: t(lang, "list.deleteBranch"), pending: t(lang, "list.deletingBranch"), small: true },
  });
}

// The one thing the row asks of the reader, beside the sentence that
// says why (spec 157). Run or Cancel — never both, and nothing at all
// when there is nothing to run: the two are never the right press at the
// same time, so a second one in the markup could only ever be a
// greyed-out invitation. There was a third, Resolve, until spec 171
// folded resolving into `archive`.
//
// It sits in the State column of the caption line, under the badge the
// head row carries: the badge already answers what is happening or what
// can happen next (spec 132) and the button completes that sentence —
// "archive held back · Implement", "implementing · Cancel". It used to be a stack
// of buttons in a cell of its own — a COLUMN at the front of the table
// in spec 124, which pushed every other column sideways, then the spec
// column's own cell spanning the phase lines (2026-08-19). Both were
// answers to "where do a row's buttons go" while there were still
// several of them.
//
// Only an OPEN row draws it (2026-09-08): the action rides the caption
// line, which is part of the detail the fold opens. A shut row is
// information and nothing else, and the press to act on it is one click
// further in.
//
// The Run form is a carrier and nothing else: it holds the hidden
// fields, and the button that submits it and the boxes that fill it are
// written outside its tags, reaching it by `form="…"` — the trick spec
// 123 introduced for the model select.
export function stateAction(g: SpecGroup, opts: SpecsPageOptions): string {
  const lang = opts.lang ?? "en";
  // The third branch, and the first thing asked (spec 224). An archived
  // spec has ONE action — `reopen` is the only step `ARCHIVE_ONLY_STEP`
  // lets past — so there is no Run form to carry and no phase to name:
  // the branches below would name one, because `chosenSteps`/`actionState`
  // answer "what would run next" for a spec whose workflow is over by
  // falling back to ticking `archive` alone (`defaultTicked`, spec 439's
  // own fallback for a spec with no recorded choice).
  if (isArchivedRow(g)) return reopenAsk(g, opts, lang);
  const busy = specBusy(g);
  // A conflict used to draw a Resolve control of its own here, off the
  // job's stored `errorReason`. Spec 171 took it away: `archive`
  // resolves a conflict with the default branch itself, so a conflict
  // that survives to this row is one no machine could settle and there
  // is no press that would settle it either. It shows as the failure's
  // own text — which names the branch — and the row offers what every
  // other failed step's row offers, an ordinary re-run.
  //
  // What a press would run, and therefore what the button says — and,
  // since spec 439, whether it would do anything at all. There is none
  // while a job is in flight: Cancel is the row's control then.
  const action = busy ? undefined : actionState(g, opts);
  // The form is a CARRIER: hidden fields only, hidden by CSS, with the
  // button and the phase boxes written outside its tags and reaching
  // it by `form="…"`. It carries no `steps` of its own: the row it
  // belongs to is open, so its phase boxes are drawn, and a hidden
  // field beside them would outvote a phase the reader just unticked.
  // Always drawn, button or none — without it on a busy row the page's
  // own script would lose the thread from a press back to the boxes it
  // has to lock with it (`rowControls`, spec 151).
  const runForm =
    `<form id="${esc(runFormId(g))}" method="post" action="/api/queue" class="rowrun">` +
    `<input type="hidden" name="project" value="${esc(g.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
    `</form>`;
  const primary = (() => {
    // Not while `create` is the step running. Every other step can be
    // cancelled and run again from the spec it already made; `create`
    // is what MAKES that spec, so a press there throws away the title
    // and the description with nothing left on the board to run again
    // from. The step's own timeout is what ends a create that hangs.
    if (busy && currentStep(g.lead!) === "create") return "";
    if (busy) return actionForm(g.lead!, lang);
    if (!action) return "";
    // Primary, like every row's one action (spec 161). It was
    // secondary until then, on the argument that a column of primary
    // buttons says nothing about which row to look at — but a row
    // draws exactly one control now, so there is no column to tell
    // apart and nothing left for the colour to say except that the
    // action is here.
    //
    // One button, whichever way `active` reads (spec 439) — never a
    // second element for the disabled case. It still carries `form="…"`
    // disabled or not: that is what lets `relabelRunButton()`
    // (`specs-client/row-swap.ts`) find and re-enable it the instant the
    // reader ticks the phase it names, without waiting for a redraw —
    // and `type="submit"` throughout is what makes that re-enabling
    // actually able to submit, rather than a live control a script can
    // turn on but never press.
    return btn({ label: action.label, variant: "primary", form: runFormId(g), pending: "starting…", disabled: !action.active });
  })();
  // "Also touches" stood here until nobody could point at a press it
  // had ever served: 0 of the queue's 200 jobs named an extra repo, and
  // it drew one tick box per OTHER project on every open row — so
  // adding a project widened it and took the layout with it. The field
  // and the runner's flag went with the box: a run reaches its project
  // and its specs root, and a spec that must change two projects at
  // once needs the naming built back, deliberately.
  return runForm + primary;
}

