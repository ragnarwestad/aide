// The spec's read-only facts (what it depends on, whether it is
// archived) drawn in the banner on every tab, the Checks tab's own
// checklist, and the Reopen/Reset controls.

import { btn, tokenField } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import type { SpecCheckView, SpecPageView } from "./types.ts";

/** What the spec depends on, on the front page, in words (spec 212).
 *
 *  Read-only, whether the spec is archived or not: the control that
 *  CHANGES it is the Description tab's picker, because the line it
 *  writes is a line of `1-description.md` and belongs with that file's
 *  own Save. Two controls for one fact can disagree; one cannot.
 *
 *  Nothing at all when the spec depends on nothing — the same
 *  convention `dependsOnField` keeps for a project with nothing to
 *  offer. */
export function dependsOnLine(view: SpecPageView): string {
  const folders = view.dependsOn ?? [];
  if (folders.length === 0) return "";
  return fact("Depends on", folders.map((f) => esc(f)).join(", "));
}

/** One labelled fact about the spec: what it is, then what it says.
 *
 *  The shape `Depends on` already had, made shared (2026-08-23) because
 *  the page's other facts were loose sentences with nothing naming
 *  them — "This spec is archived — a record, and read-only." sat under
 *  the title as a notice, which is the shape this page uses for
 *  something that just happened, not for something that is the case.
 *
 *  `value` is already escaped: some of these are a list of links and
 *  some are plain words. */
export function fact(label: string, value: string): string {
  return `<p class="desc"><strong>${esc(label)}</strong> <span class="muted">${value}</span></p>`;
}

/** What being archived actually means for this spec.
 *
 *  Not "read-only", which was the wording until 2026-08-23 and is a
 *  truth with modifications: Reopen is right there on the head line,
 *  and archive can be run again while the spec's branch is still open.
 *  What IS true is that the description's textarea and the checks'
 *  boxes are gone until it is reopened. */
export function archivedLine(view: SpecPageView): string {
  if (!view.archived) return "";
  return (
    `<p class="desc"><span class="muted">The spec has moved into <code>archive/</code>, ` +
    `and the description and the checks cannot be edited until the spec is reopened</span></p>`
  );
}

/** The spec's checks, on the CHECKS tab (specs 182, 188, 212).
 *
 *  Spec 182 put these rows at the top of the page because they were
 *  buried near the bottom of the fourth file, which is the last place
 *  anyone looks. Spec 188 then made every one of them inert and moved
 *  the tick onto the description's Edit form, because a second way of
 *  changing a spec was one too many for a reader to learn.
 *
 *  They are boxes again, with a Save of their own. That is not spec
 *  188 undone: a reader still has ONE place to tick, and the
 *  description's editor is now a tab beside this one rather than a page
 *  behind a link, so ticking a box no longer means opening it.
 *
 *  On the Checks PANEL rather than in the banner, which is where spec
 *  182 put the summary: a form in the banner rides onto Activity and
 *  Steps, and those two reload every ten seconds — which would wipe a
 *  half-ticked list, the exact failure this spec's reload scoping
 *  exists to prevent.
 *
 *  Done rows are shown too, dimmed: the list is what is left AND what
 *  has been settled, and a list that only ever shrinks says nothing
 *  about how far the spec got. They are not boxes, and neither are the
 *  open rows of a phase the workflow has not reached — a check already
 *  made and a check nothing is waiting on are both answers, not
 *  questions.
 *
 *  The phase leads its own group heading rather than repeating on every
 *  row: the rows under `Phase 4: REFACTOR` are all Phase 4's. */
export function checklist(view: SpecPageView): string {
  const rows = view.checks?.rows ?? [];
  if (rows.length === 0) {
    return `<p class="muted">No checks yet.</p>`;
  }
  const open = rows.filter((r) => !r.done).length;
  const groups: { phase: string; rows: SpecCheckView[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.phase === row.phase) last.rows.push(row);
    else groups.push({ phase: row.phase, rows: [row] });
  }
  // Spec 163: an archived spec is a RECORD, and a tick would write,
  // commit and push into `archive/`. The rows stay — they are a fact
  // about the spec — and nothing on them presses.
  const activeJob = view.lead?.state === "queued" || view.lead?.state === "running";
  const tickable = (row: SpecCheckView): boolean =>
    !view.archived && !activeJob && !row.done && row.phase === view.checks?.phase;
  const anyTickable = rows.some(tickable);
  const control = (row: SpecCheckView): string =>
    tickable(row)
      // The row's verbatim line is the value: the server finds the row
      // by it and refuses one that has moved, so a stale page can never
      // flip the wrong line.
      ? `<label class="checkbox"><input type="checkbox" name="tick" value="${esc(row.line)}"></label>`
      : `<span class="checkbox" aria-hidden="true">${row.done ? "✅" : "☐"}</span>`;
  const item = (row: SpecCheckView): string =>
    `<li class="check ${row.done ? "done" : "open"}">${control(row)}` +
    `<span class="checktask">${esc(row.task)}</span></li>`;
  const group = (g: { phase: string; rows: SpecCheckView[] }): string =>
    `<li class="checkphase">${esc(g.phase)}</li>` + g.rows.map(item).join("");
  const list = `<ul class="checklist">${groups.map(group).join("")}</ul>`;
  const head =
    `<p class="checkshead"><strong>Checks</strong> ` +
    `<span class="small muted">${open === 0 ? "all done" : `${open} of ${rows.length} still open`}</span></p>`;
  if (!anyTickable) return `<section class="checks">${head}${list}</section>`;
  return (
    `<section class="checks">${head}` +
    `<form class="specform" method="post" action="${esc(view.tickAction)}">` +
    tokenField(view.token) +
    `<input type="hidden" name="checksPhase" value="${esc(view.checks!.phase!)}">` +
    // Empty rather than absent for a file git has never committed —
    // the same answer the description's own field gives.
    `<input type="hidden" name="statusBaseSha" value="${esc(view.checks?.baseSha ?? "")}">` +
    list +
    `<span class="factions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}</span>` +
    `</form></section>`
  );
}

/** The one action an archived spec offers (spec 198).
 *
 *  Reopening used to be done by hand in a terminal — move the folder out
 *  of `archive/`, overwrite three files, hunt the branch down in two
 *  repositories and two places each. It was done twice and something was
 *  missed both times, so it is one press, offered where the spec is.
 *
 *  A plain `POST /api/queue` with `steps=reopen`, the same enqueue every
 *  other lifecycle action on this dashboard uses. That is not tidiness:
 *  it is what makes this control and `/aide-reopen` in a terminal one
 *  operation rather than two implementations that have to be kept
 *  agreeing.
 *
 *  A form and not a link, for the reason the Update button gives: a GET
 *  would let a reload run it again.
 *
 *  Nothing ELSE about an archived spec changes — no textarea on the
 *  Description tab, the same read-only note above this, the checks shown
 *  but not tickable. And nothing here is drawn for a live spec: its own
 *  row on the queue list is where its actions are. */
export function reopenControl(view: SpecPageView): string {
  return (
    `<form class="actionform" method="post" action="/api/queue">` +
    (view.token ? `<input type="hidden" name="token" value="${esc(view.token)}">` : "") +
    `<input type="hidden" name="project" value="${esc(view.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(view.specFolder)}">` +
    `<input type="hidden" name="steps" value="reopen">` +
    `<button class="btn" type="submit" ` +
    `title="take this spec back into the active list for another round: ` +
    `reset the analysis, the plan and the status, keep the description, and remove its branch">` +
    `Reopen</button></form>`
  );
}

export function resetControl(view: SpecPageView): string {
  if (!view.resetAction || view.archived) return "";
  if (view.resetUnavailableReason) {
    return `<span class="btn" aria-disabled="true" title="${esc(view.resetUnavailableReason)}">Reset</span>`;
  }
  return `<a class="btn" href="${esc(view.resetAction)}" title="start this active spec again from its description">Reset</a>`;
}
