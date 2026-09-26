// The acceptance criteria, unfolded under the held-back message on a
// spec's row (spec 493): the › that opens them and the list with its one
// Save. The state is in the URL (`?checks=`), like the row's own fold, so
// it survives the live redraw and works with script off.

import { ICON_CHEVRON, btn, rowMessageParts } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { acTestsLine } from "../../ui/ac-tests.ts";
import { checkColumns, checkControls, checkReadOnlyMark } from "../../ui/check-controls.ts";
import { t, type Language } from "../../../i18n";
import { specTabPath } from "../spec-page";
import { groupKey, isArchivedRow, type SpecGroup, type SpecsFilter } from "./data-model";
import { specBusy } from "./row-state.ts";
import { queueHref } from "./filter-bar.ts";
import { drawsChecksLine, filterFields } from "./row-shared.ts";

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
    `<a class="fold${shut ? " shut" : ""}" data-nav data-fold="checks" data-key="${esc(key)}" ` +
    `href="${queueHref(f, { checks: next.join(",") })}" ` +
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
  // An archived spec is a record: only a Not verified row is a box (tick,
  // Failed and a note), and a Failed row is never one on any spec. While a
  // job runs the boxes are drawn disabled and nothing is posted: the run
  // owns the spec's files until it ends.
  const archived = isArchivedRow(g);
  const locked = specBusy(g);
  const boxed = (row: (typeof rows)[number]): boolean => !row.failed && (!archived || !!row.notVerified);
  const drawn = rows.filter(boxed).map((row) => row.line);
  const reopen = `<a class="btn" href="/specs/${esc(g.project)}/${esc(g.specFolder)}/reopen">${esc(t(lang, "list.reopen"))}</a>`;
  // The boxes name the form with `form=`, so they can sit in the list
  // while the row's own table stays outside any form.
  const item = (row: (typeof rows)[number]): string => {
    const state = row.failed ? "failed" : row.notVerified ? "notverified" : row.done ? "done" : "open";
    const control = boxed(row)
      ? checkControls(row, lang, locked ? { disabled: true } : archived ? { formId, archivedIndex: drawn.indexOf(row.line) } : { formId })
      : checkReadOnlyMark(row, lang);
    return (
      `<li class="check ${state}">` +
      control +
      `<span class="checktask">${esc(row.task)}</span>` +
      (row.note ? `<span class="checknote">${esc(row.note)}</span>` : "") +
      (row.failed && archived ? reopen : "") +
      acTestsLine(row, lang) +
      `</li>`
    );
  };
  const list = `<ul class="checklist">${drawn.length > 0 ? checkColumns(lang, archived) : ""}${rows.map(item).join("")}</ul>`;
  // Nothing to save when no row is a box (an archived spec whose rows are
  // all Failed), or while a job runs.
  if (drawn.length === 0 || locked) return `<div class="rowchecks">${list}</div>`;
  return (
    `<form class="actionform rowchecks" id="${esc(formId)}" method="post" ` +
    `action="/api/queue/specs/${esc(g.project)}/${esc(g.specFolder)}/tick?fromList=1">` +
    filterFields(f) +
    `<input type="hidden" name="checksPhase" value="${esc(phase)}">` +
    list +
    btn({ label: t(lang, "list.checksSave"), pending: t(lang, "list.checksSaving"), variant: "primary" }) +
    `</form>`
  );
}

/** A row with a criterion still waiting for a check, or one that failed,
 *  gets a line of its own with the › and the same unfold a held-back row
 *  has: the choice "under ›" belongs on every row a criterion is decided
 *  on. A closed spec has none, and nothing is drawn without rows to show. */
export function checksRow(g: SpecGroup, f: SpecsFilter, lang: Language, columns: number, fold = true): string {
  if (!drawsChecksLine(g)) return "";
  const parts = [
    ...((g.notVerified ?? 0) > 0 ? [t(lang, "list.notVerifiedMark", { n: g.notVerified! })] : []),
    ...((g.failed ?? 0) > 0 ? [t(lang, "list.failedMark", { n: g.failed! })] : []),
  ];
  return (
    `<tr class="specnotice" data-folder="${esc(g.specFolder)}"><td colspan="${columns}">` +
    rowMessageParts("info", [
      fold
        ? { text: parts.join(" · "), own: true, lead: checksFold(g, f, lang), after: checksPanel(g, f, lang) }
        : { text: parts.join(" · "), own: true },
    ]) +
    `</td></tr>`
  );
}
