import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { esc } from "../../ui/html.ts";
import { backLink, btn, helpPopover, messageSlot } from "../../ui/components";
import { pickTab, tabBar } from "../../ui/tabs.ts";
import { notificationsPanel } from "./notifications.ts";
import { processPanel, type ProcessSettings } from "./process.ts";
import { providersBlock, type ProviderStatus } from "./providers.ts";
import type { Provider } from "../../../queue/providers/index.ts";
import { t, type Language } from "../../../i18n";
import { stepLabel } from "../../../format/step-label.ts";
import { defaultModelForTool, modelOptions, resolveChosenModel, resolveProvider, type ProviderOption } from "../specs-list";
import { WORKFLOW_STEPS } from "../../../queue/steps.ts";
import { SIDE_PARTS, type SidePart } from "../../../queue/providers/side-tools.ts";

export const SETTINGS_ROUTE = "/settings";

/** The page's top row. It is a row INSIDE the page, not the
 *  application's own tab bar, which this page hides. */
export const SETTINGS_GROUPS = ["ai", "process", "notifications"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/** AI's own row: the models-per-phase table and the providers. The table
 *  keeps the key it had as the page's first tab, so `?tab=phases` still
 *  opens it. */
export const AI_TABS = ["phases", "providers"] as const;

/** The tool tabs the row had once: a link that still names one opens
 *  Providers, where each tool's providers are. */
const REMOVED_TOOL_TABS = ["claude", "codex", "copilot", "opencode"] as const;

/** Every value `?tab=` can name: a group, or a tab inside AI. */
export const SETTINGS_TABS = [...SETTINGS_GROUPS, ...AI_TABS, ...REMOVED_TOOL_TABS] as const;

export type SettingsPanel = Exclude<(typeof SETTINGS_GROUPS)[number] | (typeof AI_TABS)[number], "ai">;

/** Which group is open and which panel it draws, off `?tab=`. AI opens on
 *  its models table, and an unknown or absent value opens AI. */
export function resolveSettingsTab(raw: string | undefined): { group: SettingsGroup; panel: SettingsPanel } {
  const tab = pickTab(SETTINGS_TABS, raw, "ai");
  if (tab === "ai") return { group: "ai", panel: "phases" };
  if (tab === "process" || tab === "notifications") return { group: tab, panel: tab };
  if ((REMOVED_TOOL_TABS as readonly string[]).includes(tab)) return { group: "ai", panel: "providers" };
  return { group: "ai", panel: tab as SettingsPanel };
}

/** The steps that act on a spec: what a reader presses on a row of the
 *  specs list. They are one group because that is the one thing they
 *  have in common, and it is the thing a reader is looking for. */
export const SPEC_STEPS = [
  "create", "analyze", "implement", "archive", "close", "reopen",
] as const;

/** The steps that do not act on a spec. `schedule` runs a job from a
 *  prompt file and names no spec at all. Their own group, below the
 *  first. */
export const OTHER_STEPS = ["schedule"] as const;

/** A step the queue can run that has nothing to set. `explore` has no
 *  button, no row action and no place in Schedule, so a model and a
 *  timeout for it set something that cannot be used; `deploy` is run by the
 *  server itself, with no model and no time limit. They are named here
 *  rather than simply left out, so that STEP_COVERAGE below still
 *  fails when a NEW step arrives with no group of its own. */
export const UNROWED_STEPS = ["explore", "deploy"] as const;

// Every step the queue can run is accounted for: in one of the two
// groups, or deliberately unrowed. Derived-and-checked rather than
// hand-picked, so a step added to
// workflow-steps.json cannot end up silently without a row.
const STEP_COVERAGE = [...SPEC_STEPS, ...OTHER_STEPS, ...UNROWED_STEPS];
if (
  STEP_COVERAGE.length !== WORKFLOW_STEPS.length ||
  !WORKFLOW_STEPS.every((step) => (STEP_COVERAGE as readonly string[]).includes(step))
) {
  throw new Error(
    `settings-page.ts groups every workflow step or names it unrowed: ` +
      `steps are ${JSON.stringify(WORKFLOW_STEPS)}, ` +
      `grouped are ${JSON.stringify(STEP_COVERAGE)}`,
  );
}

export const SETTINGS_STEPS = [...SPEC_STEPS, ...OTHER_STEPS] as const;

export interface SettingsPageOptions {
  modelChoices: { name: string; tool?: "claude" | "codex" | "opencode" | "fake-claude"; ranAs?: string; named?: { id: string; name: string } }[];
  defaultModels: Record<string, string>;
  /** The providers an AI choice lists, and the configured one per step. */
  providerChoices?: ProviderOption[];
  defaultProviders?: Record<string, string>;
  timeoutSec: Record<string, number>;
  script?: string;
  /** Where "← Back" goes — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. Settings is reachable
   *  from every page's "…" menu, so this is genuinely unbounded. */
  backHref?: string;
  /** Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
  /** Which tab is open, off `?tab=`: a group, or a tab inside AI.
   *  Absent opens AI on its models-per-phase table. */
  tab?: string;
  /** The providers the Providers tab lists, by key. */
  providers?: Record<string, Provider>;
  /** What was read of each provider when the Providers tab opened, by key. */
  providerStatuses?: Record<string, ProviderStatus>;
  /** The server's public key for push, which the Notifications tab's
   *  script subscribes a device with. */
  pushPublicKey?: string;
  /** What the Process tab shows. The `/settings` route always gives it;
   *  a caller that never opens Process may leave it out. */
  process?: ProcessSettings;
}

/** What a Settings row shows: the step's saved choice, else the default
 *  one, and the AI that choice belongs to. `models` is never empty here:
 *  a server with no choices draws no AI or Model column at all. */
export function settingsRowChoice(
  models: SettingsPageOptions["modelChoices"],
  defaultModels: Record<string, string>,
  step: string,
): { model: string; tool: string } {
  const model = resolveChosenModel(models, defaultModels[step] ?? defaultModels.default, undefined);
  return { model, tool: models.find((m) => m.name === model)?.tool ?? "claude" };
}

// The only other place this codebase already displays a timeout
// (render/job-state.ts:145) shows it in minutes, not seconds.
const toMinutes = (sec: number): number => Math.round(sec / 60);

/** What the page is, and what each choice on it decides. One "(?)" for
 *  the page rather than one per column: the three columns are read
 *  together on every row, and three popovers saying a third each is
 *  three things to open. Each paragraph is a bold lead and a body, both
 *  plain text in the catalogue; the markup is built here. */
const HELP_PARAGRAPHS = [
  "page", "onSpec", "offSpec", "default", "aiModel", "timeout",
] as const;

function pageHelp(lang: Language): string {
  return HELP_PARAGRAPHS.map((name) =>
    name === "default"
      ? esc(t(lang, "settings.help.default"))
      : `<strong>${esc(t(lang, `settings.help.${name}.lead`))}</strong> ${esc(t(lang, `settings.help.${name}.body`))}`,
  ).join("<br><br>");
}

export function renderSettingsPage(entries: NavEntry[], generatedAt: string, opts: SettingsPageOptions): string {
  const lang = opts.lang ?? "en";
  const models = opts.modelChoices;
  const back = backLink(
    opts.backHref ?? "/",
    t(lang, "shell.settings"),
    helpPopover(t(lang, "settings.help.page.title"), pageHelp(lang)),
    { keep: true, lang },
  );
  // timeoutSec is meaningful and already enforced (runner.ts) even on a
  // server with no modelChoices configured — only the AI/model columns
  // depend on a choice actually being offered.
  const renderRow = (step: (typeof SETTINGS_STEPS)[number]): string => {
    const timeout = opts.timeoutSec[step] ?? opts.timeoutSec.default ?? 1200;
    const timeoutCell = `<td><input type="number" min="1" max="360" aria-label="${esc(t(lang, "settings.row.timeoutAria", { step: stepLabel(step, lang) }))}" ` +
      `form="settings-form" name="timeoutSec.${step}" value="${toMinutes(timeout)}"></td>`;
    if (!models.length) {
      return `<tr data-step="${step}"><th scope="row">${esc(stepLabel(step, lang))}</th>${timeoutCell}</tr>`;
    }
    const configured = opts.defaultModels[step] ?? opts.defaultModels.default;
    const { model: chosen } = settingsRowChoice(models, opts.defaultModels, step);
    const providers = opts.providerChoices ?? [];
    const resting = resolveProvider({ modelChoices: models, providerChoices: providers, defaultProviders: opts.defaultProviders }, step, chosen, []);
    const ai = providers.map((p) => {
      const preferred = defaultModelForTool(models, p.tool, configured);
      return `<option value="${esc(p.key)}" data-tool="${esc(p.tool)}" data-default="${esc(preferred ?? "")}"${p.key === resting?.key ? " selected" : ""}>${esc(p.name)}</option>`;
    }).join("");
    return `<tr data-step="${step}"><th scope="row">${esc(stepLabel(step, lang))}</th>` +
      `<td>${providers.length ? `<select aria-label="${esc(t(lang, "settings.row.aiAria", { step: stepLabel(step, lang) }))}" form="settings-form" name="provider.${step}" data-ai="model.${step}">${ai}</select>` : ""}</td>` +
      `<td><select aria-label="${esc(t(lang, "settings.row.modelAria", { step: stepLabel(step, lang) }))}" form="settings-form" name="model.${step}">${modelOptions(models, chosen)}</select></td>` +
      `${timeoutCell}</tr>`;
  };
  const renderSideRow = (part: SidePart): string => {
    if (!models.length) return "";
    const { model: chosen } = settingsRowChoice(models, opts.defaultModels, part);
    const label = t(lang, `settings.side.${part}`);
    const providers = opts.providerChoices ?? [];
    const resting = resolveProvider({ modelChoices: models, providerChoices: providers, defaultProviders: opts.defaultProviders }, part, chosen, []);
    const ai = providers.map((provider) =>
      `<option value="${esc(provider.key)}" data-tool="${esc(provider.tool)}" data-default="${esc(defaultModelForTool(models, provider.tool, chosen) ?? "")}"${provider.key === resting?.key ? " selected" : ""}>${esc(provider.name)}</option>`,
    ).join("");
    const sideOptions = models.map((choice) => {
      const tool = choice.tool ?? "claude";
      return `<option value="${esc(choice.name)}" data-tool="${esc(tool)}"${choice.name === chosen ? " selected" : ""}>${esc(choice.name)}</option>`;
    }).join("");
    return `<tr data-side="${part}"><th scope="row">${esc(label)}</th>` +
      `<td><select aria-label="${esc(t(lang, "settings.row.aiAria", { step: label }))}" form="settings-form" name="provider.${part}" data-ai="model.${part}" data-side-picker>${ai}</select></td>` +
      `<td><select aria-label="${esc(t(lang, "settings.row.modelAria", { step: label }))}" form="settings-form" name="model.${part}" data-side-picker>${sideOptions}</select></td><td></td></tr>`;
  };
  // One <tbody> per group, which is what makes the grouping structural
  // rather than a styled blank row: a reader of the markup, and anything
  // that walks the table, sees two bodies rather than one run of rows.
  const columns = models.length ? 4 : 2;
  const group = (label: string, steps: readonly (typeof SETTINGS_STEPS)[number][]): string =>
    `<tbody><tr class="settingsgroup"><th scope="rowgroup" colspan="${columns}">${esc(label)}</th></tr>` +
    steps.flatMap((step) => step === "implement" ? [renderRow(step), ...SIDE_PARTS.map(renderSideRow)] : [renderRow(step)]).join("") +
    `</tbody>`;
  const rows =
    group(t(lang, "settings.group.onSpec"), SPEC_STEPS) +
    group(t(lang, "settings.group.offSpec"), OTHER_STEPS);
  const modelHeaders = models.length ? `<th>${esc(t(lang, "schedule.ai"))}</th><th>${esc(t(lang, "schedule.model"))}</th>` : "";
  const noModelsNote = models.length ? "" : `<p class="muted">${esc(t(lang, "settings.noModels"))}</p>`;
  const phasesPanel =
    `<form id="settings-form" class="settingsform" data-settings-form method="post" action="/api/queue/settings">` +
    messageSlot("refused", "failed") +
    messageSlot("notice", "info") +
    noModelsNote +
    `<table class="settingstable"><thead><tr><th>${esc(t(lang, "settings.col.phase"))}</th>${modelHeaders}<th>${esc(t(lang, "settings.col.timeout"))}</th></tr></thead>${rows}</table>` +
    `<div class="configactions">` +
    btn({ id: "settingsform-save", label: t(lang, "list.checksSave"), variant: "primary", pending: t(lang, "list.checksSaving") }) +
    btn({ id: "settingsform-cancel", label: t(lang, "dialog.cancel"), type: "button", disabled: true }) +
    `</div></form>`;
  const { group: openGroup, panel: open } = resolveSettingsTab(opts.tab);
  const top = tabBar(SETTINGS_GROUPS, SETTINGS_ROUTE, openGroup, {}, "", { lang });
  const aiRow = openGroup === "ai" ? tabBar(AI_TABS, SETTINGS_ROUTE, open as (typeof AI_TABS)[number], {}, "", { lang }) : "";
  const panel = open === "phases"
    ? phasesPanel
    : open === "providers"
      ? providersBlock(opts.providers, lang, opts.providerStatuses)
      : open === "notifications"
        ? notificationsPanel(opts.pushPublicKey, lang)
        : opts.process ? processPanel(opts.process, lang) : "";
  // `pageShell` wraps the body in `<main>`: a second one inside it takes
  // the frame's padding twice. Both rows sit directly in it, so page.css's
  // Settings rule centres them, and the panel after them, as it did one row.
  const body = `${back}${top}${aiRow}${panel}`;
  return pageShell("Settings", entries, SETTINGS_ROUTE, body, generatedAt, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
