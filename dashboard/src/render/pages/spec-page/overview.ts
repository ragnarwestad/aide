// The spec's read-only facts (what it depends on, whether it is
// archived) drawn in the banner on every tab, the Checks tab's own
// checklist, and the Reopen/Reset controls.

import { helpPopover, ICON_PDF, saveCancelActions, tokenField } from "../../ui/components.ts";
import { SPINNER } from "../../ui/components/icons.ts";
import { esc } from "../../ui/html.ts";
import { dependsOnField } from "../new-spec-page.ts";
import { CLOSE_VS_RESET_SENTENCE } from "./close-page.ts";
import type { SpecCheckView, SpecPageView } from "./types.ts";

/** The two whole-spec facts that sit above the tabs (spec 394): what the
 *  spec depends on, and whether it requires acceptance ticking. Neither
 *  is about any one document — REQ-1 moves the depends-on picker out of
 *  the Description tab's own save form for exactly that reason, and
 *  REQ-2 puts the acceptance switch beside it rather than leaving it
 *  homeless on the specs list's own row.
 *
 *  Read-only sentences for an archived spec — the same shape this
 *  banner always drew, since an archived spec is a RECORD with no form
 *  to draw at all (REQ-7). One combined form for a live spec, posting
 *  to `view.trackingAction`.
 *
 *  The acceptance switch is drawn LOCKED, not omitted, once `analyze`
 *  has already decided the question (REQ-6) — the same disabled-with-
 *  title shape `pdfControl`/`resetControl` use below for "possible in
 *  principle, not right now". A locked box submits nothing at all, the
 *  same as an unchecked one — `acceptanceEditable` is a hidden sentinel
 *  precisely so the route can tell those two apart (see
 *  `spec-edit/tracking.ts`). */
export function trackingControl(view: SpecPageView): string {
  const folders = view.dependsOn ?? [];
  const options = view.dependsOnOptions ?? [];
  if (view.archived) {
    const dep = folders.length ? fact("Depends on", folders.map((f) => esc(f)).join(", ")) : "";
    return dep + fact("Acceptance", view.acceptanceNotRequired ? "not required" : "required");
  }
  const acceptanceLocked = view.done?.includes("analyze") ?? false;
  // A spec this one depends on that is no longer a valid CHOICE is
  // still a fact about this spec. Nothing archived is among the
  // options — it cannot be picked — so a spec whose dependencies have
  // all been archived showed a list of specs it does NOT depend on and
  // none of the ones it does, while the specs list one click away
  // printed them plainly. They are shown, locked: a box that cannot be
  // unticked says what is true without promising a change it cannot
  // make.
  const known = new Set(options.map((t) => t.specFolder));
  const locked = folders.filter((f) => !known.has(f));
  // The Save/Cancel pair rides on the "Depends on" label line, after
  // its "(?)" — the picker is the form's one real control, and a pair
  // under a list this tall sat far from what it saves. A spec with no
  // picker to draw at all still needs them, so they fall back to a row
  // of their own below.
  const actions = saveCancelActions("trackingform");
  const picker =
    options.length || locked.length
      ? dependsOnField(options, new Set(folders), {
        wide: true,
        locked,
        project: view.project,
        actions,
      })
      : "";
  // The sentence that stood here is the field's own "(?)" now, on the
  // label's line, rather than a paragraph under the control.
  const note = "";
  // `.row`, not `.checkbox`: that class is the fixed 18px square an
  // acceptance ROW draws so every row's mark lines up, and it carries
  // `width: 18px; flex: none`. Wrapped around a label with words in it,
  // the words were squeezed into eighteen pixels, wrapped to three
  // lines, and the Save button beside them landed on top.
  const acceptance = acceptanceLocked
    ? `<span class="row" aria-disabled="true" title="analyze has already decided whether to write the acceptance-criteria table — this cannot change now">` +
      `<span>acceptance ticking not required</span></span>`
    : `<label class="row">` +
      `<input type="hidden" name="acceptanceEditable" value="1">` +
      `<input type="checkbox" name="acceptanceNotRequired" value="1"${view.acceptanceNotRequired ? " checked" : ""}>` +
      `<span>acceptance ticking not required</span></label>`;
  // `.trackingform`, never `.specform`: the Checks tab's tick form
  // already carries that class, and the banner renders on every tab —
  // Checks included — so a shared class would leave that tab with TWO
  // `.specform` forms, breaking anything that finds one by that class
  // alone (`dashboard/test/e2e/acceptance-gate-checks-tab.test.ts`,
  // spec 382).
  return (
    `<form class="trackingform" method="post" action="${esc(view.trackingAction)}">` +
    tokenField(view.token) +
    (picker ? `<span class="frow">${picker}</span>` : "") +
    note +
    // Not `.factions`: the switch is a FIELD, not an action, and the
    // page's one actions row is the Save/Cancel pair below it.
    `<p class="row">${acceptance}</p>` +
    // The same pair, and the same rules, the document forms already
    // have: both inactive until something changes, Cancel putting the
    // form back the way the page opened it.
    (picker ? "" : actions) +
    `</form>`
  );
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
  // spec 406, REQ-7: a closed spec is under archive/ too (the same
  // folder move), but must never read as "archived" on its own page —
  // closedLine, below, is what draws for it instead.
  if (!view.archived || view.closed) return "";
  return (
    `<p class="desc"><span class="muted">The spec has moved into <code>archive/</code>, ` +
    `and the description and the checks cannot be edited until the spec is reopened</span></p>`
  );
}

/** What being closed actually means for this spec (spec 406, REQ-7) —
 *  `archivedLine`'s sibling, drawn instead of it. Names the reason and
 *  the date (REQ-5's "travels with the spec"), never the word
 *  "archived": the description's own emphasis is that closing must not
 *  look like archiving, and this is where a reader of the spec's own
 *  page meets that distinction stated as fact rather than left to be
 *  inferred from the folder alone. */
export function closedLine(view: SpecPageView): string {
  if (!view.closed) return "";
  const when = view.closedDate ? ` on ${esc(view.closedDate)}` : "";
  const reason = view.closeReason ? `: ${esc(view.closeReason)}` : "";
  return (
    `<p class="desc"><span class="muted">This spec was closed${when}${reason} — ` +
    `it did not work out, and the description and the checks cannot be edited ` +
    `until the spec is reopened</span></p>`
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
 *  about how far the spec got — a check already made is an answer, not
 *  a question, so it is not a box.
 *
 *  The section leads its own group heading rather than repeating on
 *  every row. */
/** This page shows ONE section: `## Acceptance criteria`.
 *
 *  The Phase tables (RED/GREEN/REFACTOR, and a LOW spec's `## Checklist`)
 *  are the implement RUN's own record of its work, and nothing anywhere
 *  gates on them — archive's only gate is the Acceptance section, and
 *  has been since spec 268. Drawing them as boxes therefore asked a
 *  person to do work that changed nothing, while making the page look
 *  like it was holding the spec back; a run that forgets to tick its own
 *  row is the run's record to fix, never a person's clicking. They stay
 *  in the file, where the Status tab reads them.
 *
 *  So there is one group, one form and one Save — never one per phase. */
const isAcceptance = (phase: string): boolean => /^acceptance\b/i.test(phase);

export function checklist(view: SpecPageView, mark = ""): string {
  const rows = (view.checks?.rows ?? []).filter((row) => isAcceptance(row.phase));
  if (rows.length === 0) {
    return `<p class="muted">No acceptance criteria to tick.${mark ? ` ${mark}` : ""}</p>`;
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
  // Running, or landing — not queued: a queued job writes nothing yet,
  // and an archive job parked on this very tick is queued (the same
  // rule the tick route applies, `specWriteInFlight`).
  const activeJob = view.lead?.state === "running" || !!view.lead?.landing;
  // Spec 163: an archived spec's rows stay, and nothing on them presses.
  // A job in flight is writing the file this form would commit onto.
  //
  // The section a tick is scoped to is the rows' OWN heading, taken from
  // the first of them rather than passed in: one heading covers every
  // row here, and a file pathological enough to carry a second
  // `Acceptance` section leaves its rows read-only rather than ticking
  // them against the wrong one.
  const phase = rows[0]!.phase;
  const canTick = !view.archived && !activeJob && rows.some((r) => !r.done && r.phase === phase);
  const tickable = (row: SpecCheckView): boolean => canTick && !row.done && row.phase === phase;
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
  // The head line and, when the boxes are tickable, Save/Cancel beside it
  // (spec 391) — one `.panelhead` div, the form's first child, so the
  // buttons sit on the same line as the mark rather than below the list.
  const panelHead = (actions = ""): string =>
    `<div class="panelhead"><p class="checkshead"><strong>Checks</strong> ` +
    `<span class="small muted">${open === 0 ? "all done" : `${open} of ${rows.length} still open`}</span>${mark}</p>${actions}</div>`;
  // The boxes sit INSIDE the one form, and Save closes it — no id
  // plumbing, because there is only ever one form to belong to.
  const body = canTick
    ? `<form class="specform" method="post" action="${esc(view.tickAction)}">` +
      tokenField(view.token) +
      `<input type="hidden" name="checksPhase" value="${esc(phase)}">` +
      // Empty rather than absent for a file git has never committed —
      // the same answer the description's own field gives.
      `<input type="hidden" name="statusBaseSha" value="${esc(view.checks?.baseSha ?? "")}">` +
      panelHead(saveCancelActions()) +
      list +
      `</form>`
    : panelHead() + list;
  return `<section class="checks">${body}</section>`;
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

/** The PDF button (spec 358): opens `GET .../pdf` in a new tab, where
 *  the browser's own viewer shows it — a plain link, never a form, so it
 *  works with JavaScript switched off (REQ-2). Disabled with its reason
 *  rather than hidden when the tool is missing (REQ-7), the exact shape
 *  `resetControl` below already uses.
 *
 *  An icon alone, not the word "PDF" beside it (spec 391): it opens a
 *  document, so it reads as one — the same `aria-label` says what it
 *  does to a reader who cannot see the icon, on both branches. */
export function pdfControl(view: SpecPageView): string {
  if (!view.pdfAction) return "";
  const what = "open this spec as a PDF in a new tab";
  if (view.pdfUnavailableReason) {
    return (
      `<span class="btn" aria-disabled="true" aria-label="${esc(what)}" ` +
      `title="${esc(view.pdfUnavailableReason)}">${ICON_PDF}</span>`
    );
  }
  return (
    `<a class="btn" href="${esc(view.pdfAction)}" target="_blank" rel="noopener" data-pdf ` +
    `aria-label="${esc(what)}" title="${esc(what)}">${ICON_PDF}</a>`
  );
}

/** What a board is doing, when one was ever asked for: starting,
 *  failed, or running at an address (REQ-4: its branch and commit;
 *  REQ-5: whose specs these are), with the Stop button beside it.
 *
 *  There is no Start button on this page. It sat in the tab row, where
 *  it took the width that made the row wider than the fields and the
 *  editor below it, and starting a round costs minutes and real model
 *  spend — a press that expensive needs a home of its own, not the
 *  corner of a row of small navigation actions. The route it posted to
 *  is untouched; what is gone is the button.
 *
 *  Drawn in the banner, above the tabs: it is a sentence, and the tab
 *  row holds buttons only. */
export function boardStatus(view: SpecPageView): string {
  if (!view.boardAction || !view.board) return "";
  if (view.board.status === "starting") {
    return (
      `<p class="desc">${SPINNER}<span class="muted">Starting a board for ${esc(view.board.branch)} @ ` +
      `${esc(view.board.commit)} — this can take several minutes.</span></p>`
    );
  }
  if (view.board.status === "failed") {
    return (
      `<p class="desc"><span class="muted">The board failed to start` +
      `${view.board.error ? `: ${esc(view.board.error)}` : ""}.</span></p>`
    );
  }
  return (
    `<p class="desc"><strong>Board:</strong> ` +
    `<a href="${esc(view.board.url ?? "")}" target="_blank" rel="noopener">${esc(view.board.url ?? "")}</a> ` +
    `<span class="muted">— serving ${esc(view.board.branch)} @ ${esc(view.board.commit)}. ` +
    `These are the round's own fixture specs, not this project's.</span></p>` +
    `<form class="actionform" method="post" action="${esc(view.boardStopAction ?? "")}">` +
    tokenField(view.token) +
    `<button class="btn" type="submit">Stop board</button></form>`
  );
}

export function resetControl(view: SpecPageView): string {
  if (!view.resetAction || view.archived) return "";
  if (view.resetUnavailableReason) {
    return `<span class="btn" aria-disabled="true" title="${esc(view.resetUnavailableReason)}">Reset</span>`;
  }
  return `<a class="btn" href="${esc(view.resetAction)}" title="start this active spec again from its description">Reset</a>`;
}

/** The other operation that ends a work round (spec 406, REQ-1), drawn
 *  beside Reset. Same disabled-with-`title` shape as `resetControl` for
 *  "possible in principle, not right now" (REQ-11) — `view.archived`
 *  hides it for an archived OR a closed spec alike, the same one flag
 *  `resetControl` already checks, since neither move applies once a
 *  spec has left the active list. */
export function closeControl(view: SpecPageView): string {
  if (!view.closeAction || view.archived) return "";
  if (view.closeUnavailableReason) {
    return `<span class="btn" aria-disabled="true" title="${esc(view.closeUnavailableReason)}">Close</span>`;
  }
  return `<a class="btn" href="${esc(view.closeAction)}" title="say this spec is not going to work, and archive the record">Close</a>`;
}

/** Drawn once, beside both controls — REQ-2's non-hover distinction: a
 *  reader meets Close and Reset differently only in a `title` attribute
 *  otherwise, which REQ-2 explicitly says is not enough. Shares its
 *  exact wording with the close confirmation page's own prose
 *  (`CLOSE_VS_RESET_SENTENCE`, close-page.ts) so the two places can
 *  never say it differently. */
export function resetCloseNote(view: SpecPageView): string {
  if (!view.resetAction && !view.closeAction) return "";
  if (view.archived) return "";
  // A "(?)", not a `<p>`: this sits in the tab row beside the two
  // buttons it distinguishes, and a block element there makes the whole
  // action group wrap below the tabs and stacks the buttons.
  return helpPopover("Reset or Close", esc(CLOSE_VS_RESET_SENTENCE));
}
