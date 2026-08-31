import { pageShell, type NavEntry } from "../ui/shell.ts";
import { esc } from "../ui/html.ts";
import { backLink } from "../ui/components.ts";
import { defaultModelForTool, modelOptions, resolveChosenModel } from "./queue-list.ts";

export const SETTINGS_ROUTE = "/settings";
export const SETTINGS_STEPS = ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen"] as const;

export interface SettingsPageOptions {
  modelChoices: { name: string; budgetUsd: number; tool?: "claude" | "codex" }[];
  defaultModels: Record<string, string>;
  budgetUsd: number;
  jobCapUsd: number;
  timeoutSec: Record<string, number>;
  script?: string;
  error?: string;
  notice?: string;
  /** Where "← Back" goes (spec 252) — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. Settings is reachable
   *  from every page's "…" menu, so this is genuinely unbounded. */
  backHref?: string;
}

const LABELS: Record<(typeof SETTINGS_STEPS)[number], string> = {
  explore: "Explore", create: "Create", analyze: "Analyze", implement: "Implement",
  archive: "Archive", manifest: "Manifest", reopen: "Reopen",
};

// The only other place this codebase already displays a timeout
// (render/job-state.ts:145) shows it in minutes, not seconds.
const toMinutes = (sec: number): number => Math.round(sec / 60);

export function renderSettingsPage(entries: NavEntry[], generatedAt: string, opts: SettingsPageOptions): string {
  const models = opts.modelChoices;
  const back = backLink(opts.backHref ?? "/", "Settings");
  // budgetUsd/jobCapUsd/timeoutSec are meaningful and already enforced
  // (runner.ts) even on a server with no modelChoices configured — only
  // the AI/model columns depend on a choice actually being offered.
  const rows = SETTINGS_STEPS.map((step) => {
    const timeout = opts.timeoutSec[step] ?? opts.timeoutSec.default ?? 1200;
    const timeoutCell = `<td><input type="number" min="1" max="360" aria-label="Timeout in minutes for ${LABELS[step]}" ` +
      `form="settings-form" name="timeoutSec.${step}" value="${toMinutes(timeout)}"></td>`;
    if (!models.length) {
      return `<tr data-step="${step}"><th scope="row">${LABELS[step]}</th>${timeoutCell}</tr>`;
    }
    const configured = opts.defaultModels[step] ?? opts.defaultModels.default;
    const chosen = resolveChosenModel(models, configured, undefined);
    const tool = models.find((model) => model.name === chosen)?.tool ?? "claude";
    const tools = [...new Set(models.map((model) => model.tool ?? "claude"))];
    const ai = tools.map((name) => {
      const label = name === "codex" ? "Codex" : "Claude Code";
      const preferred = defaultModelForTool(models, name, configured);
      return `<option value="${name}" data-default="${esc(preferred ?? "")}"${name === tool ? " selected" : ""}>${label}</option>`;
    }).join("");
    return `<tr data-step="${step}"><th scope="row">${LABELS[step]}</th><td>` +
      `<select aria-label="AI for ${LABELS[step]}" form="settings-form" data-ai="model.${step}">${ai}</select>` +
      `<select aria-label="Model for ${LABELS[step]}" form="settings-form" name="model.${step}">${modelOptions(models, chosen)}</select>` +
      `</td>${timeoutCell}</tr>`;
  }).join("");
  const message = opts.error ?? opts.notice ?? "";
  const modelHeader = models.length ? "<th>Default AI and model</th>" : "";
  const noModelsNote = models.length ? "" : `<p class="muted">No model choices are configured on this server.</p>`;
  const body = `<main>${back}<form id="settings-form" data-settings-form method="post" action="/api/queue/settings">` +
    `<p class="refused${opts.error ? " rowmsg warn" : ""}" aria-live="polite">${esc(message)}</p>` +
    `<p><label>Budget per job (USD) <input type="number" min="0.01" max="100" step="0.01" ` +
    `name="budgetUsd" value="${opts.budgetUsd}"></label></p>` +
    `<p><label>Job cap (USD) <input type="number" min="0.01" max="300" step="0.01" ` +
    `name="jobCapUsd" value="${opts.jobCapUsd}"></label></p>` +
    noModelsNote +
    `<table><thead><tr><th>Step</th>${modelHeader}<th>Timeout (min)</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="factions"><button class="btn primary" type="submit">Save</button></div></form></main>`;
  return pageShell("Settings", entries, SETTINGS_ROUTE, body, generatedAt, undefined, {
    script: opts.script, hideHeading: true,
  });
}
