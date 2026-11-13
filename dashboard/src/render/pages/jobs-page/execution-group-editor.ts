// The New group dialog on the Jobs tab: one project, a name, and the specs a
// group can be made of, each with its place in the order. The search row's
// New group button opens it (`filter-bar.ts`); the page script keeps the
// list to the chosen project and numbers the ticked specs
// (`specs-client/execution-groups/editor.ts`).

import type { SpecTarget } from "../specs-list";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { formDialog } from "../../ui/components";

interface EditorOptions { projects: string[]; candidates: SpecTarget[]; lang?: Language }

/** The dialog's id, which the New group button names with `data-ask`. */
export const NEW_GROUP_DIALOG = "new-group";

export function executionGroupEditor(options: EditorOptions): string {
  const lang = options.lang ?? "en";
  return formDialog(lang, {
    id: NEW_GROUP_DIALOG,
    title: t(lang, "list.groupCreate"),
    action: "/api/queue/groups",
    hook: "actionform",
    data: { "execution-group-editor": "" },
    fields:
      `<div class="execution-group-editor">` +
      `<label class="field">${t(lang, "list.groupProject")}<select name="project">${options.projects.map((project) => `<option value="${esc(project)}">${esc(project)}</option>`).join("")}</select></label>` +
      `<label class="field">${t(lang, "list.groupName")}<input name="name" required></label>` +
      `<ol>${options.candidates.map((candidate) => {
        return `<li data-group-project="${esc(candidate.project)}"><label><input type="checkbox" name="member" value="${esc(candidate.specFolder)}">` +
          `<strong>${esc(candidate.specFolder)}</strong> ${esc(candidate.title ?? candidate.specFolder)}</label>` +
          `<label>${t(lang, "list.groupOrder")} <input type="number" name="position" min="1"></label></li>`;
      }).join("")}</ol>` +
      // Shown by the page script while the chosen project has fewer than two.
      `<p class="muted" data-group-none hidden>${esc(t(lang, "list.groupTooFew"))}</p></div>`,
  });
}

interface AddOptions {
  /** The dialog's id, which the card's Add spec button names. */
  id: string;
  group: { id: string; name: string };
  candidates: SpecTarget[];
  lang?: Language;
}

/** The Add spec dialog on a group's card: the specs the group can take, one
 *  to choose, added at the end of its order. Drawn as New group's list is;
 *  with nothing to offer it says so and Add stays shut. */
export function addToGroupDialog(options: AddOptions): string {
  const lang = options.lang ?? "en";
  const list = options.candidates.length
    ? `<ol>${options.candidates.map((candidate) =>
      `<li><label><input type="radio" name="member" value="${esc(candidate.specFolder)}" required>` +
      `<strong>${esc(candidate.specFolder)}</strong> ${esc(candidate.title ?? candidate.specFolder)}</label></li>`).join("")}</ol>`
    : `<p class="muted">${esc(t(lang, "list.groupAddNone"))}</p>`;
  return formDialog(lang, {
    id: options.id,
    title: t(lang, "list.groupAddTitle", { group: options.group.name }),
    action: `/api/queue/groups/${encodeURIComponent(options.group.id)}/members`,
    hook: "actionform",
    data: { "group-add": "" },
    fields: `<div class="execution-group-editor">${list}</div>`,
    save: { label: t(lang, "list.groupAddSave"), pending: t(lang, "list.groupAddSaving") },
    saveDisabled: options.candidates.length === 0,
  });
}
