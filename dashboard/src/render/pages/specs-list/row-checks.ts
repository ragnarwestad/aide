// The acceptance criteria, unfolded under the held-back message on a
// spec's row (spec 493): the › that opens them and the list with its one
// Save. The state is in the URL (`?checks=`), like the row's own fold, so
// it survives the live redraw and works with script off.

import { ICON_CHEVRON, btn } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { acTestsLine } from "../../ui/ac-tests.ts";
import { t, type Language } from "../../../i18n";
import { specTabPath } from "../spec-page";
import { groupKey, type SpecGroup, type SpecsFilter } from "./data-model";
import { queueHref } from "./filter-bar.ts";
import { filterFields } from "./row-shared.ts";

/** The keys named in `?checks=`: the specs whose criteria are unfolded. */
export const unfoldedKeys = (f: SpecsFilter): Set<string> =>
  new Set((f.checks ?? "").split(",").filter(Boolean));

/** The › to the left of the held-back message. Adds or removes only this
 *  spec's key and keeps every other part of the view. */
export function checksFold(g: SpecGroup, f: SpecsFilter, lang: Language): string {
  const key = groupKey(g.project, g.specFolder);
  const unfolded = unfoldedKeys(f);
  const shut = !unfolded.has(key);
  const next = shut ? [...unfolded, key] : [...unfolded].filter((k) => k !== key);
  const action = t(lang, shut ? "list.foldShow" : "list.foldHide");
  return (
    `<a class="fold${shut ? " shut" : ""}" data-nav href="${queueHref(f, { checks: next.join(",") })}" ` +
    `aria-expanded="${shut ? "false" : "true"}" ` +
    `title="${esc(t(lang, "list.checksFoldTitle", { action, folder: g.specFolder }))}">${ICON_CHEVRON}</a>`
  );
}

/** The list under the message, or nothing while it is folded. */
export function checksPanel(g: SpecGroup, f: SpecsFilter, lang: Language): string {
  const key = groupKey(g.project, g.specFolder);
  if (!unfoldedKeys(f).has(key)) return "";
  const rows = g.acceptance ?? [];
  if (rows.length === 0) {
    return (
      `<p class="checksunread muted">${esc(t(lang, "list.checksUnreadable"))} ` +
      `<a href="${esc(specTabPath(g.project, g.specFolder, "status"))}">${esc(t(lang, "list.checksOpenTab"))}</a></p>`
    );
  }
  // One heading covers every row; the route scopes the press to it.
  const phase = rows[0]!.phase;
  const formId = `rowchecks-${key}`;
  // The boxes name the form with `form=`, so they can sit in the list
  // while the row's own table stays outside any form.
  const item = (row: (typeof rows)[number]): string => {
    const state = row.done ? "done" : "open";
    return (
      `<li class="check ${state}">` +
      `<input type="hidden" name="row" value="${esc(row.line)}" form="${esc(formId)}">` +
      `<label class="checkbox"><input type="checkbox" name="tick" value="${esc(row.line)}" form="${esc(formId)}"` +
      `${row.done ? " checked" : ""}></label>` +
      `<span class="checktask">${esc(row.task)}</span>` +
      (row.note ? `<span class="checknote">${esc(row.note)}</span>` : "") +
      acTestsLine(row, lang) +
      `</li>`
    );
  };
  return (
    `<form class="actionform rowchecks" id="${esc(formId)}" method="post" ` +
    `action="/api/queue/specs/${esc(g.project)}/${esc(g.specFolder)}/tick?fromList=1">` +
    filterFields(f) +
    `<input type="hidden" name="checksPhase" value="${esc(phase)}">` +
    `<ul class="checklist">${rows.map(item).join("")}</ul>` +
    btn({ label: t(lang, "list.checksSave"), pending: t(lang, "list.checksSaving"), variant: "primary" }) +
    `</form>`
  );
}
