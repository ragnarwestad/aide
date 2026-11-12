import type { SpecTarget } from "../specs-list";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { btn, foldDisclosure } from "../../ui/components";

interface EditorOptions { projects: string[]; candidates: SpecTarget[]; lang?: Language }

export function executionGroupEditor(options: EditorOptions): string {
  const lang = options.lang ?? "en";
  return `<div class="execution-group-editor">` + foldDisclosure({ summary: t(lang, "list.groupCreate"), body:
    `<form method="post" action="/api/queue/groups" class="actionform" data-execution-group-editor>` +
    `<label class="field">${t(lang, "list.groupProject")}<select name="project">${options.projects.map((project) => `<option value="${esc(project)}">${esc(project)}</option>`).join("")}</select></label>` +
    `<label class="field">${t(lang, "list.groupName")}<input name="name" required></label>` +
    `<ol>${options.candidates.map((candidate) => {
      return `<li data-group-project="${esc(candidate.project)}"><label><input type="checkbox" name="member" value="${esc(candidate.specFolder)}">` +
        `<strong>${esc(candidate.specFolder)}</strong> ${esc(candidate.title ?? candidate.specFolder)}</label>` +
        `<label>${t(lang, "list.groupOrder")} <input type="number" name="position" min="1"></label></li>`;
    }).join("")}</ol>${btn({ label: t(lang, "list.groupSave"), variant: "primary" })}</form>` }) + `</div>`;
}
