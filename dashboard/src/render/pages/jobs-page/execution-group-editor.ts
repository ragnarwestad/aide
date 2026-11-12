import type { ExecutionGroup } from "../../../queue/execution-groups";
import type { SpecTarget } from "../specs-list";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { btn } from "../../ui/components";

interface EditorOptions { projects: string[]; candidates: SpecTarget[]; group?: ExecutionGroup; lang?: Language }

export function executionGroupEditor(options: EditorOptions): string {
  const group = options.group;
  const lang = options.lang ?? "en";
  if (group && (group.state !== "prepared" || group.startedAt)) return "";
  const action = group ? `/api/queue/groups/${encodeURIComponent(group.id)}` : "/api/queue/groups";
  const projects = group ? [group.project] : options.projects;
  const selected = new Map((group?.members ?? []).map((folder, index) => [folder, index + 1]));
  const candidates = [...options.candidates]
    .filter((candidate) => !group || candidate.project === group.project)
    .sort((a, b) => (selected.get(a.specFolder) ?? Number.MAX_SAFE_INTEGER) - (selected.get(b.specFolder) ?? Number.MAX_SAFE_INTEGER));
  return `<details class="execution-group-editor">` +
    `<summary>${t(lang, group ? "list.groupEdit" : "list.groupCreate")}</summary>` +
    `<form method="post" action="${action}" class="actionform" data-execution-group-editor>` +
    `<label class="field">${t(lang, "list.groupProject")}<select name="project"${group ? " disabled" : ""}>${projects.map((project) => `<option value="${esc(project)}">${esc(project)}</option>`).join("")}</select></label>` +
    (group ? `<input type="hidden" name="project" value="${esc(group.project)}">` : "") +
    `<label class="field">${t(lang, "list.groupName")}<input name="name" value="${esc(group?.name ?? "")}"${group ? " readonly" : ""} required></label>` +
    `<ol>${candidates.map((candidate) => {
      const position = selected.get(candidate.specFolder) ?? "";
      return `<li data-group-project="${esc(candidate.project)}"><label><input type="checkbox" name="member" value="${esc(candidate.specFolder)}"${position ? " checked" : ""}>` +
        `<strong>${esc(candidate.specFolder)}</strong> ${esc(candidate.title ?? candidate.specFolder)}</label>` +
        `<label>${t(lang, "list.groupOrder")} <input type="number" name="position" min="1" value="${position}"></label></li>`;
    }).join("")}</ol>${btn({ label: t(lang, "list.groupSave"), variant: "primary" })}</form></details>`;
}
