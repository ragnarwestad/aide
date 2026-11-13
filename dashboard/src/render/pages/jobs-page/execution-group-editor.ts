// The New group dialog on the Jobs tab: one project, a name, and the specs a
// group can be made of, each with its place in the order. The search row's
// New group button opens it (`filter-bar.ts`); the page script keeps the
// list to the chosen project and numbers the ticked specs
// (`specs-client/execution-groups/editor.ts`).

import type { SpecTarget } from "../specs-list";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { formDialog } from "../../ui/components";

export interface EditableExecutionGroup {
  id: string; anchor: string; project: string; name: string;
  members: { specFolder: string; title?: string; locked: boolean }[];
}
interface EditorOptions { projects: string[]; candidates: SpecTarget[]; group?: EditableExecutionGroup; lang?: Language }

/** The dialog's id, which the New group button names with `data-ask`. */
export const NEW_GROUP_DIALOG = "new-group";

export function executionGroupEditor(options: EditorOptions): string {
  const lang = options.lang ?? "en";
  const group = options.group;
  const rows = group
    ? [...group.members.map((member) => ({ ...member, project: group.project, checked: true })), ...options.candidates.map((candidate) => ({ ...candidate, locked: false, checked: false }))]
    : options.candidates.map((candidate) => ({ ...candidate, locked: false, checked: false }));
  const id = group ? `edit-group-${group.anchor}` : NEW_GROUP_DIALOG;
  return formDialog(lang, {
    id,
    title: group ? t(lang, "list.groupEditTitle", { group: group.name }) : t(lang, "list.groupCreate"),
    action: group ? `/api/queue/groups/${encodeURIComponent(group.id)}` : "/api/queue/groups",
    hook: "actionform",
    data: { "execution-group-editor": "" },
    fields:
      `<div class="execution-group-editor">` +
      `<label class="field">${t(lang, "list.groupProject")}<select name="project"${group ? " disabled" : ""}>${(group ? [group.project] : options.projects).map((project) => `<option value="${esc(project)}">${esc(project)}</option>`).join("")}</select></label>` +
      (group ? `<input type="hidden" name="project" value="${esc(group.project)}">` : "") +
      `<label class="field">${t(lang, "list.groupName")}<input name="name" required${group ? ` value="${esc(group.name)}"${group.members.some((member) => member.locked) ? " readonly" : ""}` : ""}></label>` +
      `<ol>${rows.map((candidate, index) => {
        return `<li data-group-project="${esc(candidate.project)}"${candidate.locked ? " data-group-locked" : ""}><label>` +
          (candidate.locked ? `<input type="checkbox" checked disabled><input type="hidden" name="member" value="${esc(candidate.specFolder)}">` : `<input type="checkbox" name="member" value="${esc(candidate.specFolder)}"${candidate.checked ? " checked" : ""}>`) +
          `<strong>${esc(candidate.specFolder)}</strong> ${esc(candidate.title ?? candidate.specFolder)}</label>` +
          `<label>${t(lang, "list.groupOrder")} <input type="number" name="position" min="1"${candidate.checked ? ` value="${index + 1}"` : ""}${candidate.locked ? " readonly" : ""}></label>` +
          (candidate.locked ? `<span class="muted small">${esc(t(lang, "list.groupLocked"))}</span>` : "") + `</li>`;
      }).join("")}</ol>` +
      // Shown by the page script while the chosen project has fewer than two.
      `<p class="muted" data-group-none hidden>${esc(t(lang, "list.groupTooFew"))}</p></div>`,
  });
}
