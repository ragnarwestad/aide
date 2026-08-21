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
  /** The commit that text was read at, carried through the form so a
   *  save whose file has moved since can be refused. Absent for a file
   *  git has never committed, which is not a mismatch. */
  baseSha?: string;
  /** Where Save posts. Built by the server, because only it knows the
   *  action's own path. */
  saveAction: string;
  /** For a browser that got the page with the token in the address
   *  rather than in a cookie. */
  token?: string;
  /** Why the last save was refused, and what a save that went through
   *  did — both off the query string, the same round trip Update
   *  already uses. */
  error?: string;
  notice?: { note: string; ok: boolean };
}

export function renderSpecEditPage(
  view: SpecEditPageView,
  generatedAt: string,
  entries: NavEntry[],
): string {
  const back = specPagePath(view.project, view.specFolder);
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
