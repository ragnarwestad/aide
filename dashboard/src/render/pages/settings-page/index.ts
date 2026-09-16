import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { esc } from "../../ui/html.ts";
import { backLink, btn, helpPopover } from "../../ui/components";
import { pickTab, tabBar } from "../../ui/tabs.ts";
import { TOOL_TABS, toolPanel } from "./tools.ts";
import type { CheckableTool, ToolCheck } from "./tools.ts";
import type { Language } from "../../../i18n";
import { defaultModelForTool, modelOptions, resolveChosenModel, TOOL_NAMES } from "../specs-list";
import { WORKFLOW_STEPS } from "../../../queue/steps.ts";

export const SETTINGS_ROUTE = "/settings";

/** The page's own tabs. "phases" is the table this page has always been;
 *  the other four are one AI each. They are a row INSIDE the page, not
 *  the application's own tab bar, which this page hides. */
export const SETTINGS_TABS = ["phases", ...TOOL_TABS] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The steps that act on a spec: what a reader presses on a row of the
 *  specs list. They are one group because that is the one thing they
 *  have in common, and it is the thing a reader is looking for. */
export const SPEC_STEPS = [
  "create", "analyze", "implement", "archive", "close", "reopen", "reset",
] as const;

/** The steps that do not act on a spec. `manifest` updates the
 *  project's manifest; `schedule` runs a job from a prompt file and
 *  names no spec at all. Their own group, below the first. */
export const OTHER_STEPS = ["manifest", "schedule"] as const;

/** A step the queue can run that nothing on the board starts. `explore`
 *  has no button, no row action and no place in Schedule, so a model
 *  and a timeout for it set something that cannot be used. It is named
 *  here rather than simply left out, so that STEP_COVERAGE below still
 *  fails when a NEW step arrives with no group of its own. */
export const UNROWED_STEPS = ["explore"] as const;

// Every step the queue can run is accounted for: in one of the two
// groups, or deliberately unrowed. Derived-and-checked rather than
// hand-picked (spec 420's own reason), so a step added to
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
// "default" is the fallback every un-rowed lookup already reads
// (parse-request.ts's perStep, runner-argv.ts's resolveStepModel) — its
// own row, not a workflow step, so it rides beside SETTINGS_STEPS
// rather than inside it.
export const SETTINGS_ROWS = [...SETTINGS_STEPS, "default"] as const;

export interface SettingsPageOptions {
  modelChoices: { name: string; tool?: "claude" | "codex" | "opencode" | "fake-claude" }[];
  defaultModels: Record<string, string>;
  timeoutSec: Record<string, number>;
  script?: string;
  error?: string;
  notice?: string;
  /** Where "← Back" goes (spec 252) — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. Settings is reachable
   *  from every page's "…" menu, so this is genuinely unbounded. */
  backHref?: string;
  /** Spec 408. Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
  /** Which tab is open, off `?tab=`. Absent opens the phases table,
   *  which is what this page was before it had tabs. */
  tab?: string;
  /** The last answer obtained for each tool, keyed by tool. A check runs
   *  only when its button is pressed, so a tool with no entry has simply
   *  not been asked about. */
  checks?: Partial<Record<CheckableTool, ToolCheck>>;
  /** The queue token a POST needs, when this server requires one. */
  token?: string;
}

const LABELS: Record<(typeof SETTINGS_STEPS)[number], string> = {
  create: "Create", analyze: "Analyze", implement: "Implement",
  archive: "Archive", close: "Close", reopen: "Reopen", reset: "Reset",
  manifest: "Manifest", schedule: "Schedule",
};
const rowLabel = (step: (typeof SETTINGS_ROWS)[number]): string =>
  step === "default" ? "Default" : LABELS[step];

// The only other place this codebase already displays a timeout
// (render/job-state.ts:145) shows it in minutes, not seconds.
const toMinutes = (sec: number): number => Math.round(sec / 60);

/** What the page is, and what each choice on it decides. One "(?)" for
 *  the page rather than one per column: the three columns are read
 *  together on every row, and three popovers saying a third each is
 *  three things to open. */
const PAGE_HELP =
  "<strong>What this page sets.</strong> Every step the queue can run has a row here, and a row " +
  "says what that step runs on and how long it may take. Nothing here starts anything; it is what " +
  "a run uses when nobody picked something else for that one spec." +
  "<br><br>" +
  "<strong>On a spec.</strong> Create writes the spec's folder. Analyze works out how to do it. " +
  "Implement writes the code and its tests. Archive merges the branch and moves the folder to " +
  "archive. Close ends a spec whose idea did not hold, without merging its code. Reopen brings an " +
  "archived spec back. Reset takes a spec back to an earlier phase." +
  "<br><br>" +
  "<strong>Not on a spec.</strong> Manifest updates the project's own manifest. Schedule runs a " +
  "job from a prompt file and names no spec at all." +
  "<br><br>" +
  "<strong>Default.</strong> Not a step. It is what a step with no row of its own falls back to." +
  "<br><br>" +
  "<strong>AI and Model.</strong> The AI is which command line runs the step; the model is which " +
  "model it is given. Picking an AI fills in that AI's own model, and the two always belong " +
  "together. Only AIs with a model configured on this server can be picked." +
  "<br><br>" +
  "<strong>Timeout.</strong> How long the step may run before it is stopped, in minutes. It is the " +
  "only limit on a runaway step, so a step that legitimately takes longer needs a larger number " +
  "here rather than a retry.";

export function renderSettingsPage(entries: NavEntry[], generatedAt: string, opts: SettingsPageOptions): string {
  const models = opts.modelChoices;
  const back = backLink(
    opts.backHref ?? "/",
    "Settings",
    helpPopover("what this page sets", PAGE_HELP),
  );
  // timeoutSec is meaningful and already enforced (runner.ts) even on a
  // server with no modelChoices configured — only the AI/model columns
  // depend on a choice actually being offered.
  const renderRow = (step: (typeof SETTINGS_ROWS)[number]): string => {
    const timeout = opts.timeoutSec[step] ?? opts.timeoutSec.default ?? 1200;
    const timeoutCell = `<td><input type="number" min="1" max="360" aria-label="Timeout in minutes for ${rowLabel(step)}" ` +
      `form="settings-form" name="timeoutSec.${step}" value="${toMinutes(timeout)}"></td>`;
    if (!models.length) {
      return `<tr data-step="${step}"><th scope="row">${rowLabel(step)}</th>${timeoutCell}</tr>`;
    }
    const configured = opts.defaultModels[step] ?? opts.defaultModels.default;
    const chosen = resolveChosenModel(models, configured, undefined);
    const tool = models.find((model) => model.name === chosen)?.tool ?? "claude";
    const tools = [...new Set(models.map((model) => model.tool ?? "claude"))];
    const ai = tools.map((name) => {
      // `TOOL_NAMES` is where a tool's own name lives. This line used to
      // spell two of them out — `codex ? "Codex" : "Claude Code"` — so a
      // third tool arrived on this page under Claude Code's name, which
      // is exactly what Fake-Claude exists not to be mistaken for.
      const label = TOOL_NAMES[name] ?? name;
      const preferred = defaultModelForTool(models, name, configured);
      return `<option value="${name}" data-default="${esc(preferred ?? "")}"${name === tool ? " selected" : ""}>${label}</option>`;
    }).join("");
    return `<tr data-step="${step}"><th scope="row">${rowLabel(step)}</th>` +
      `<td><select aria-label="AI for ${rowLabel(step)}" form="settings-form" data-ai="model.${step}">${ai}</select></td>` +
      `<td><select aria-label="Model for ${rowLabel(step)}" form="settings-form" name="model.${step}">${modelOptions(models, chosen)}</select></td>` +
      `${timeoutCell}</tr>`;
  };
  // One <tbody> per group, which is what makes the grouping structural
  // rather than a styled blank row: a reader of the markup, and anything
  // that walks the table, sees three bodies rather than one run of rows.
  const columns = models.length ? 4 : 2;
  const group = (label: string, steps: readonly (typeof SETTINGS_ROWS)[number][]): string =>
    `<tbody><tr class="settingsgroup"><th scope="rowgroup" colspan="${columns}">${esc(label)}</th></tr>` +
    steps.map(renderRow).join("") +
    `</tbody>`;
  const rows =
    group("On a spec", SPEC_STEPS) +
    group("Not on a spec", OTHER_STEPS) +
    group("Fallback", ["default"]);
  const message = opts.error ?? opts.notice ?? "";
  const modelHeaders = models.length ? "<th>AI</th><th>Model</th>" : "";
  const noModelsNote = models.length ? "" : `<p class="muted">No model choices are configured on this server.</p>`;
  const phasesPanel =
    `<form id="settings-form" class="settingsform" data-settings-form method="post" action="/api/queue/settings">` +
    `<p class="refused${opts.error ? " rowmsg failed" : ""}" aria-live="polite">${esc(message)}</p>` +
    noModelsNote +
    `<table class="settingstable"><thead><tr><th>Phase</th>${modelHeaders}<th>Timeout (min)</th></tr></thead>${rows}</table>` +
    `<div class="configactions">` +
    btn({ id: "settingsform-save", label: "Save", variant: "primary", pending: "saving…" }) +
    btn({ id: "settingsform-cancel", label: "Cancel", type: "button", disabled: true }) +
    `</div></form>`;
  const current = pickTab(SETTINGS_TABS, opts.tab, "phases");
  const bar = tabBar(SETTINGS_TABS, SETTINGS_ROUTE, current, {});
  const panel = current === "phases"
    ? phasesPanel
    : toolPanel(current as CheckableTool, opts.checks?.[current as CheckableTool], opts.token);
  const body = `<main>${back}${bar}${panel}</main>`;
  return pageShell("Settings", entries, SETTINGS_ROUTE, body, generatedAt, undefined, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
