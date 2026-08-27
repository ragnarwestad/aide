// The forms and links a spec's row draws to act on it: fold, cancel,
// the compare links, reopen, and the one Run/Cancel control the State
// column carries. Split out of cells.ts (split cells.ts by theme).

import { ICON_CHEVRON, btn, tokenField } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import type { BranchView, QueueRowView } from "../../ui/job-state.ts";
import type { QueuePageOptions } from "../queue-list.ts";
import {
  FROM_LIST_FIELD,
  groupKey,
  isArchivedRow,
  type QueueFilter,
  type SpecGroup,
} from "./data-model.ts";
import { queueHref } from "./filter-bar.ts";
import { filterFields } from "./row-shared.ts";
import { actionLabel, preTicked, runFormId, specBusy } from "./row-state.ts";

// The fold is a LINK, not a button, and the state is in the URL. That
// buys three things at once for no browser code at all: it works with
// script off, `queue-client.ts` already intercepts `a[data-nav]` inside
// `#jobrows` so a click neither reloads the page nor wipes a half-filled
// form, and the choice survives the table swapping itself every five
// seconds — the same mechanism the filter and the sort ride on.
export function foldControl(g: SpecGroup, f: QueueFilter, opened: Set<string>): string {
  const key = groupKey(g.project, g.specFolder);
  const shut = !opened.has(key);
  const next = shut ? [...opened, key] : [...opened].filter((k) => k !== key);
  return (
    `<a class="fold${shut ? " shut" : ""}" data-nav href="${queueHref(f, { open: next.join(",") })}" ` +
    // The key is never the visible content — anything in `?open=` is
    // attacker-chosen text, and an icon cannot be mistaken for markup.
    `aria-expanded="${shut ? "false" : "true"}" ` +
    `title="${shut ? "show" : "hide"} the phases and controls of ${esc(g.specFolder)}">${ICON_CHEVRON}</a>`
  );
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
// `actionform` is what the page's own code selects on, and
// `data-pending` is what the button says while the request is out —
// written here, beside the label it replaces, rather than as a verb
// table in the script.
function actionForm(r: QueueRowView, token: string | undefined, filter: QueueFilter | undefined): string {
  const hidden = tokenField(token) + filterFields(filter);
  return (
    `<form method="post" action="/api/queue/${esc(r.id)}/cancel" class="actionform">${hidden}` +
    // Primary, like every row's one action (spec 161): `danger` was
    // supposed to set it apart, but in dark mode `--danger` and
    // `--accent` sit close enough in hue that an outlined Cancel and a
    // filled button beside it said nothing different to the eye. And a
    // cancelled run can be started again, so it was never what `danger`
    // is for.
    btn({ label: "Cancel", pending: "cancelling…", variant: "primary" }) +
    `</form>`
  );
}

// Merging was a button here until spec 149, with a long comment about
// what it said and where it said it. It says nothing now, because it is
// not pressed: every step lands the work it produced, `implement` alone
// leaves its branch open on purpose, and `archive` is what lands that.
// `mergeForm`, `mergeReadyLabel` and `isCodeRepo` went with it —
// `isCodeRepo` existed only so the button's own sentence could say
// whether it would land the plan or the code.

// Every repo the spec pushed to, each with its own compare link and its
// own merge state. Never one link standing in for two: the two branches
// share a NAME and nothing else.
export function branchList(branches: BranchView[]): string {
  if (branches.length === 0) return "";
  // A lead-in, because bare repo names read as words that fell out of
  // something else (asked for 2026-08-19).
  return (
    `<span class="branchlist"><span class="lbl">Repos:</span>` +
    branches
      .map(
        (b) =>
          `<span class="branch"><a class="small" href="${esc(b.url)}" ` +
          `title="compare the branch in ${esc(b.label)}">${esc(b.label)}</a>` +
          // Beside the compare link, never instead of it: one says where
          // the work is, the other where it can be tried.
          (b.previewUrl
            ? ` <a class="small" href="${esc(b.previewUrl)}" ` +
              `title="open this branch's own build">preview</a>`
            : "") +
          `</span>`,
      )
      .join("") +
    `</span>`
  );
}

/** The one action an archived spec offers (spec 198, on its row since
 *  spec 221). The same `POST /api/queue` with `steps=reopen` the spec's
 *  own page sends — not a shared helper with it, because the two differ
 *  in the one thing that matters here and a five-field form is not worth
 *  an abstraction over that difference.
 *
 *  What they differ in is `FROM_LIST_FIELD`: it is what tells the
 *  handler the press came from a row rather than from the spec's page,
 *  and therefore which page to answer on. A no-script form POST gets one
 *  redirect and no second chance to ask. */
function reopenForm(g: SpecGroup, opts: QueuePageOptions): string {
  return (
    `<form method="post" action="/api/queue" class="actionform">` +
    tokenField(opts.token) +
    filterFields(opts.filter) +
    `<input type="hidden" name="project" value="${esc(g.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
    `<input type="hidden" name="steps" value="reopen">` +
    `<input type="hidden" name="${FROM_LIST_FIELD}" value="1">` +
    btn({ label: "Reopen", pending: "reopening…", variant: "primary" }) +
    `</form>`
  );
}

// The one thing the row asks of the reader, beside the sentence that
// says why (spec 157). Run or Cancel — never both, and nothing at all
// when there is nothing to run: the two are never the right press at the
// same time, so a second one in the markup could only ever be a
// greyed-out invitation. There was a third, Resolve, until spec 171
// folded resolving into `archive`.
//
// It sits in the State column now, after the badge, because the badge
// already answers what is happening or what can happen next (spec 132)
// and the button completes that sentence: "archive held back ·
// Implement", "implementing · Cancel". It used to be a stack
// of buttons in a cell of its own — a COLUMN at the front of the table
// in spec 124, which pushed every other column sideways, then the spec
// column's own cell spanning the phase lines (2026-08-19). Both were
// answers to "where do a row's buttons go" while there were still
// several of them.
//
// The same function draws it open or shut. A collapsed row used to have
// a narrower path of its own; what the two differ in now is one branch,
// not two call sites.
//
// The Run form is a carrier and nothing else: it holds the hidden
// fields, and the button that submits it and the boxes that fill it are
// written outside its tags, reaching it by `form="…"` — the trick spec
// 123 introduced for the model select.
export function stateAction(g: SpecGroup, opts: QueuePageOptions, open: boolean): string {
  // The third branch, and the first thing asked (spec 224). An archived
  // spec has ONE action — `reopen` is the only step `ARCHIVE_ONLY_STEP`
  // lets past — so there is no Run form to carry and no phase to name:
  // the branches below would name one, because `preTicked` answers
  // "what would run next" for a spec whose workflow is over by ticking
  // `archive` alone.
  if (isArchivedRow(g)) return reopenForm(g, opts);
  const busy = specBusy(g);
  // A conflict used to draw a Resolve control of its own here, off the
  // job's stored `errorReason`. Spec 171 took it away: `archive`
  // resolves a conflict with the default branch itself, so a conflict
  // that survives to this row is one no machine could settle and there
  // is no press that would settle it either. It shows as the failure's
  // own text — which names the branch — and the row offers what every
  // other failed step's row offers, an ordinary re-run.
  //
  // What a press would run, and therefore what the button says. There
  // is none while a job is in flight: Cancel is the row's control then.
  const label = busy ? undefined : actionLabel(g);
  // The form is a CARRIER: hidden fields only, hidden by CSS, with the
  // button and the phase boxes written outside its tags and reaching
  // it by `form="…"`. So it is drawn wherever something names it — an
  // open row's boxes and model selects always do, and a shut row's
  // button does when there is one. Without it on a busy open row, the
  // page's own script would lose the thread from a press back to the
  // boxes it has to lock with it (`rowControls`, spec 151).
  const runForm =
    open || label
      ? `<form id="${esc(runFormId(g))}" method="post" action="/api/queue" class="rowrun">` +
        `${tokenField(opts.token)}${filterFields(opts.filter)}` +
        `<input type="hidden" name="project" value="${esc(g.project)}">` +
        `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
        // A SHUT row draws no phase boxes, so the phases a press would
        // run have nothing to be read off at submit time: they travel
        // as hidden fields instead. An open row must NOT have them — its
        // boxes are the reader's own, and a hidden field beside them
        // would outvote a phase just unticked.
        (open || !label
          ? ""
          : [...preTicked(g)].map((s) => `<input type="hidden" name="steps" value="${esc(s)}">`).join("")) +
        `</form>`
      : "";
  const primary = (() => {
    if (busy) return actionForm(g.lead!, opts.token, opts.filter);
    if (!label) return "";
    // Primary, like every row's one action (spec 161). It was
    // secondary until then, on the argument that a column of primary
    // buttons says nothing about which row to look at — but a row
    // draws exactly one control now, so there is no column to tell
    // apart and nothing left for the colour to say except that the
    // action is here.
    //
    // Built by hand rather than through `btn()`: it needs `form="…"`,
    // an attribute that helper's signature does not carry — the same
    // reason `modelPicker` builds its own `<select>`.
    return `<button type="submit" form="${esc(runFormId(g))}" class="btn primary" data-pending="starting…">${esc(label)}</button>`;
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
