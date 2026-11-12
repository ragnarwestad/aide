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
      }).join("")}</ol></div>`,
  });
}
