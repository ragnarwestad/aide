// `/specs/<project>/<specFolder>/edit`: the description, in a textarea
// (spec 162).
//
// A spec's description is edited constantly — a measurement added, a
// decision closed, a point the analysis got wrong — and every one of
// those edits meant leaving the dashboard for an editor and a terminal.
// Spec 150 put the four files on a page; this is the one of them a
// person owns, on a page of its own, with a Save that commits and
// pushes.
//
// A page of its own rather than a box on the Overview tab, for one
// reason that decides it: the spec page refreshes itself every ten
// seconds so the tabs stay live while a step runs, and a textarea
// inside a page that reloads on a timer is one poll away from losing
// what was typed. This page simply never asks for a refresh.
//
// Modelled on `new-spec-page.ts`, which is the other page here that is
// nothing but a form: same shell, same `field()`/`tokenField()`
// helpers, same Save-and-Cancel pair, and no script at all — a real
// form posting to a real route, following a 303 back.

import { btn, field, rowMessage, tokenField } from "./components.ts";
import { esc } from "./html.ts";
import { dependsOnField } from "./new-spec-page.ts";
import type { QueueTarget } from "./queue-list.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { specPagePath } from "./spec-page.ts";

export interface SpecEditPageView {
  project: string;
  specFolder: string;
  /** Which file is open. One today; named rather than assumed, because
   *  the heading and the refusals both say it. */
  file: string;
  /** The file as it is on disk right now. Empty for a file that is not
   *  there yet — the editor is then how it gets written. */
  text: string;
  /** What this spec MAY be made to depend on: every active spec in its
   *  own project, itself left out. Empty — a project whose only spec is
   *  this one — and the field is not drawn at all (spec 174).
   *
   *  A list rather than a line to type into, because the New-spec page
   *  already had the right control and this page had a text input only
   *  because spec 166's description said "a field" without saying which. */
  dependsOnOptions: QueueTarget[];
  /** Which of them are ticked: the spec's `Depends on:` line, resolved
   *  to folders the way the runtime gate resolves it (spec 166's line
   *  may hold a bare number, and a hand-edited one usually does). The
   *  line itself is never in `text` — this page is its only writer, so
   *  the two cannot say different things about it. */
  dependsOnChecked: string[];
  /** The commit that text was read at, carried through the form so a
   *  save whose file has moved since can be refused. Absent for a file
   *  git has never committed, which is not a mismatch. */
  baseSha?: string;
  /** Where Save posts. Built by the server, because only it knows the
   *  action's own path. */
  saveAction: string;
  /** The checks that are still holding this spec back: the CURRENT
   *  phase's open rows of `4-status.md`, and nothing else (spec 188).
   *  A check already made, and a check nothing is waiting on, do not
   *  belong on a form whose question is what has to be answered before
   *  this spec moves on — the server has already left both out.
   *
   *  Absent, or with no rows, and the section is not drawn at all —
   *  the same convention `dependsOnField` keeps for a project with
   *  nothing to offer.
   *
   *  One `phase` for the whole set rather than one per row, which is
   *  what makes each box's own value the row's verbatim line: a table
   *  row contains `|` and cannot be packed into one field with its
   *  phase beside it. `baseSha` is the file's own commit at read time,
   *  the same guard the description above carries. */
  checks?: {
    phase: string;
    baseSha?: string;
    rows: { line: string; task: string }[];
  };
  /** For a browser that got the page with the token in the address
   *  rather than in a cookie. */
  token?: string;
  /** Why the last save was refused, and what a save that went through
   *  did — both off the query string, the same round trip Update
   *  already uses. */
  error?: string;
  notice?: { note: string; ok: boolean };
}

/** The open checks, as boxes in the page's one form. Nothing at all
 *  when the server offered none: a spec whose current phase is clear,
 *  a fully done one, and one whose `4-status.md` has no phase sections
 *  all reach this the same way. */
function checkList(view: SpecEditPageView): string {
  const checks = view.checks;
  if (!checks || checks.rows.length === 0) return "";
  return (
    `<input type="hidden" name="checksPhase" value="${esc(checks.phase)}">` +
    // Empty rather than absent for a file git has never committed —
    // the same answer the description's own field gives.
    `<input type="hidden" name="statusBaseSha" value="${esc(checks.baseSha ?? "")}">` +
    `<span class="frow">` +
    field(
      "Checks",
      `<ul class="checklist"><li class="checkphase">${esc(checks.phase)}</li>` +
        checks.rows
          .map(
            (row) =>
              `<li class="check">` +
              // The row's verbatim line is the value: the server finds
              // the row by it and refuses one that has moved, so a
              // stale page can never flip the wrong line.
              `<label class="checkbox"><input type="checkbox" name="tick" value="${esc(row.line)}"></label>` +
              `<span class="checktask">${esc(row.task)}</span></li>`,
          )
          .join("") +
        `</ul>`,
      { group: true },
    ) +
    `</span>`
  );
}

export function renderSpecEditPage(
  view: SpecEditPageView,
  generatedAt: string,
  entries: NavEntry[],
): string {
  const back = specPagePath(view.project, view.specFolder);
  const picker = dependsOnField(view.dependsOnOptions, new Set(view.dependsOnChecked));
  const body =
    `<p class="intro"><a href="${esc(back)}">← ${esc(view.specFolder)}</a></p>\n` +
    // A refusal first, or it is read after the thing it refused.
    (view.error ? rowMessage("err", view.error, { tag: "p" }) : "") +
    (view.notice ? rowMessage(view.notice.ok ? "info" : "warn", view.notice.note, { tag: "p" }) : "") +
    `<form method="post" action="${esc(view.saveAction)}" class="newspecform">` +
    tokenField(view.token) +
    // Empty rather than absent when git has never committed the file:
    // an absent field and an empty one say the same thing to the route,
    // and one of them is a field that cannot be there.
    `<input type="hidden" name="baseSha" value="${esc(view.baseSha ?? "")}">` +
    // Spec 166: above the file, because a dependency is about the spec
    // rather than about the prose — and because the line it writes is
    // the one line the textarea below no longer shows. The control is
    // the New-spec page's own since spec 174.
    //
    // The note goes with the picker rather than standing on its own: a
    // project with nothing to depend on draws neither, and a sentence
    // about a control that is not there is one more thing to read past.
    (picker
      ? `<span class="frow">${picker}</span>` +
        `<p class="muted">A dependency applies from this spec's next gated step ` +
        `(implement, resolve, archive) — never to a step already running.</p>`
      : "") +
    `<span class="frow">` +
    field(
      view.file,
      // No newline between the tag and the text: an HTML parser eats a
      // single leading one, which would silently drop the first line of
      // a file that begins with a blank one.
      `<textarea name="text" rows="30" spellcheck="false">${esc(view.text)}</textarea>`,
      { wide: true },
    ) +
    `</span>` +
    // Spec 188: ticking a check is part of editing the spec. Under the
    // textarea rather than above it — the description is what the page
    // is for, and the checks are the short list beneath it — and inside
    // the SAME form, so one Save posts both. The classes are the ones
    // the spec page's own checklist already uses, so the two readings
    // of a row look alike.
    checkList(view) +
    `<span class="factions">` +
    btn({ label: "Save", variant: "primary", pending: "saving…" }) +
    // Out, having done nothing. A plain link: there is nothing for a
    // Cancel to post.
    `<a class="btn" href="${esc(back)}">Cancel</a>` +
    `</span>` +
    `</form>`;
  // `/` as the current path, not this page's own: the tab bar names the
  // two AREAS of the site, and a spec's file belongs to the spec list's
  // — the same answer the job and spec pages give.
  //
  // No `refreshSeconds`, and that is the point of the page.
  return pageShell(`${view.specFolder} — ${view.file}`, entries, "/", body, generatedAt, undefined, {
    docTitle: `aide-board — ${view.file}`,
  });
}
