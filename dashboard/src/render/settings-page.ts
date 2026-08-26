import { pageShell, type NavEntry } from "./shell.ts";
import { esc } from "./html.ts";
import { backLink } from "./components.ts";
import { defaultModelForTool, modelOptions, resolveChosenModel } from "./queue-list.ts";

export const SETTINGS_ROUTE = "/settings";
export const SETTINGS_STEPS = ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen"] as const;

export interface SettingsPageOptions {
  modelChoices: { name: string; budgetUsd: number; tool?: "claude" | "codex" }[];
  defaultModels: Record<string, string>;
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

export function renderSettingsPage(entries: NavEntry[], generatedAt: string, opts: SettingsPageOptions): string {
  const models = opts.modelChoices;
  const back = backLink(opts.backHref ?? "/");
  if (!models.length) {
    return pageShell("Settings", entries, SETTINGS_ROUTE,
      `<main>${back}<h1>Settings</h1><p class="muted">No model choices are configured on this server.</p></main>`,
      generatedAt, undefined, { script: opts.script, hideHeading: true });
  }
  const rows = SETTINGS_STEPS.map((step) => {
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
      `</td></tr>`;
  }).join("");
  const message = opts.error ?? opts.notice ?? "";
  const body = `<main>${back}<h1>Settings</h1><form id="settings-form" data-settings-form method="post" action="/api/queue/settings">` +
    `<p class="refused${opts.error ? " rowmsg warn" : ""}" aria-live="polite">${esc(message)}</p>` +
    `<table><thead><tr><th>Step</th><th>Default AI and model</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="factions"><button class="btn primary" type="submit">Save</button></div></form></main>`;
  return pageShell("Settings", entries, SETTINGS_ROUTE, body, generatedAt, undefined, {
    script: opts.script, hideHeading: true,
  });
}
