// One function per page state the Norwegian page tests read. Each returns
// the page drawn with Norwegian chosen and the strings the fixture wrote
// itself — names, titles, paths, tool output — which the checker cuts out
// before it looks at the words. A name here shares no word with the pages'
// English, so a name never hides a word.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderAddProjectPage, renderNewSpecPage, renderProjectPage, renderProjectsPage, renderSchedulePage,
  renderScheduleDetailPage, renderScheduleNewPage, renderSchedulePromptPage, renderSettingsPage, TOOL_TABS,
  type ProjectView, type ToolCheck, type ToolModels, type ToolUsage,
} from "../../../../src/render";
import type { GitRunner } from "../../../../src/git/branch-status.ts";
import { assessProjectReadiness } from "../../../../src/project/project-admin/readiness.ts";
import { projectSettings } from "../../../../src/project/project-settings.ts";
import { CLAUDE_READING } from "../../../queue-routes/settings-models/fixtures.ts";

export interface PageState {
  /** What a failing test names: the page and its state. */
  page: string;
  html: string;
  /** The strings the fixture wrote itself. */
  data: string[];
}

const AT = "2026-11-03T08:00:00.000Z";
const NOW = "2026-11-03T08:05:00.000Z";
const nb = { lang: "nb" } as const;
const NAV = [
  { label: "Running", path: "/" }, { label: "Specs", path: "/specs" },
  { label: "Projects", path: "/projects" }, { label: "Schedule", path: "/schedule" },
];

// --- Settings ---------------------------------------------------------------

const MODELS = [
  { name: "kvikk", tool: "claude" as const },
  { name: "tung", tool: "claude" as const },
  { name: "raskkodex", tool: "codex" as const },
];
const DEFAULTS = { default: "kvikk" };
const TIMEOUTS = { default: 1200, implement: 5400 };

const READING: ToolModels = {
  ...CLAUDE_READING,
  named: [{ model: "planlegg", name: "Planlegg 1", id: "claude-planlegg-1" }],
};
const CODEX_READING: ToolModels = { tool: "codex", at: AT, offered: [{ model: "raskkodex", name: "Raskkodex" }, { model: "ukjent", name: "Ukjent" }] };
const USAGE: ToolUsage = {
  tool: "claude", at: AT,
  windows: [
    { name: "five_hour", usedPercent: 51, resetsAt: "2026-11-03T10:54:46.000Z" },
    { name: "seven_day", usedPercent: 8, resetsAt: "2026-11-03T09:10:17.000Z" },
    { name: "Dagens kvote", usedPercent: 24, resets: "Nov 3 at 11:20pm (Europe/Oslo)" },
  ],
};
const checkOf = (tool: ToolCheck["tool"]): ToolCheck => ({
  tool, at: AT, found: true,
  lines: ["funnet (2.1.273)", "   skills -> ~/.claude/skills/ ok"],
  commands: ["aide-preflight claude", "claude auth status"],
  extra: [
    { question: "Is it logged in?", ok: true, detail: "", answer: { key: "login.inWithAs", values: { method: "claude.ai", account: "noen@eksempel.no, Max" } } },
    { question: "Er den oppdatert?", ok: false, detail: "mangler" },
    { question: "Kan den nås?", ok: null, detail: "" },
  ],
});

const settings = (page: string, opts: Partial<Parameters<typeof renderSettingsPage>[2]>, data: string[] = []): PageState => ({
  page,
  html: renderSettingsPage(NAV, NOW, { modelChoices: MODELS, defaultModels: DEFAULTS, timeoutSec: TIMEOUTS, ...nb, ...opts }),
  data: [...data, ...MODELS.map((m) => m.name), "Planlegg 1", "claude-planlegg-1", "Raskkodex", "Ukjent"],
});

export function settingsStates(): PageState[] {
  const states: PageState[] = [
    settings("Settings › Models per phase", {}),
    settings("Settings › Models per phase, no model choices", { modelChoices: [] }),
    settings("Settings › Process", { tab: "process", process: { concurrency: 2, cores: 8, min: 1, max: 16 } }),
    settings("Settings › Notifications", { tab: "notifications", pushPublicKey: "nokkel" }),
  ];
  for (const tool of TOOL_TABS) {
    const reading = tool === "codex" ? CODEX_READING : { ...READING, tool };
    const usage = { ...USAGE, tool };
    for (const part of ["models", "subscription", "installation"]) {
      const base = { tab: tool, aiTab: part, choices: {}, ...(tool === "claude" ? {} : {}) };
      states.push(settings(`Settings › ${tool} › ${part}, before a reading`, base));
      states.push(
        settings(`Settings › ${tool} › ${part}, after a reading`, {
          ...base,
          checks: { [tool]: checkOf(tool) },
          usage: { [tool]: usage },
          models: { [tool]: reading },
        }, ["noen@eksempel.no, Max", "funnet (2.1.273)", "aide-preflight claude", "claude auth status", "mangler", "Er den oppdatert?", "Kan den nås?", "Dagens kvote", "Nov 3 at 11:20pm (Europe/Oslo)"]),
      );
    }
  }
  states.push(
    settings("Settings › copilot › subscription, nothing to read", {
      tab: "copilot", aiTab: "subscription",
      usage: { copilot: { tool: "copilot", at: AT, windows: [], noSource: true } },
      models: { copilot: { tool: "copilot", at: AT, offered: [], noSource: true } },
    }),
    settings("Settings › codex › subscription, no windows", {
      tab: "codex", aiTab: "subscription", usage: { codex: { tool: "codex", at: AT, windows: [] } },
    }),
    settings("Settings › claude › models, none offered", {
      tab: "claude", aiTab: "models", models: { claude: { tool: "claude", at: AT, offered: [] } },
    }),
  );
  return states;
}

// --- Projects ---------------------------------------------------------------

const view = (name: string, over: Partial<ProjectView> = {}): ProjectView => ({
  name, manifest: { ok: true, data: { name } }, specs: [], ...over,
});

const READY_GIT: GitRunner = async (at, args) => {
  const joined = args.join(" ");
  if (joined.startsWith("rev-parse --show-toplevel")) return { code: 0, stdout: `${at}\n` };
  if (joined.startsWith("symbolic-ref")) return { code: 0, stdout: "origin/main\n" };
  if (joined.startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "main\n" };
  if (joined.startsWith("show-ref")) return { code: 0, stdout: "" };
  return { code: 0, stdout: "" };
};

/** A checkout on disk, with the readiness answer and the settings table read from it. */
async function checkout(label: string, config: string, specs: boolean) {
  const dir = mkdtempSync(join(tmpdir(), `kvitsyl-${label}-`));
  mkdirSync(join(dir, ".aide"));
  writeFileSync(join(dir, ".aide", "config"), config);
  if (specs) mkdirSync(join(dir, "specs"));
  const readiness = await assessProjectReadiness(READY_GIT, dir);
  return { dir, readiness, settings: projectSettings(dir, readiness) };
}

const projectOpts = { worktreeLinkCandidates: ["node_modules", "dist"], editingGroup: null };

export async function projectStates(): Promise<PageState[]> {
  const proj = view("kvitsyl");
  const can = await checkout("klar", "AIDE_TEST_CMD=bun kjor\n", true);
  const cannot = await checkout("ikke", "AIDE_SPECS_PATH=/finnes/ikke/spesifikasjoner\nworktreeLinks=ukjent-mappe\n", false);
  const dirData = (c: { dir: string }) => [c.dir, `${c.dir}/specs`, "/finnes/ikke/spesifikasjoner", "ukjent-mappe", "bun kjor", "node_modules", "dist"];
  const page = (state: string, html: string, data: string[] = []): PageState => ({
    page: `Projects › ${state}`, html, data: [...data, "kvitsyl", "tunfisk", "torsk", "rutiner/tunfisk.md", "bun kjor"],
  });
  const config = (c: Awaited<ReturnType<typeof checkout>>, extra: Record<string, unknown> = {}) =>
    renderProjectPage(proj, c.settings, c.readiness, NOW, NAV, { ...projectOpts, ...nb, tab: "config", settingsHome: "project", ...extra });
  const entries = [
    { name: "tunfisk", cron: "0 3 * * *", prompt: "rutiner/tunfisk.md", enabled: true },
    { name: "torsk", cron: "30 6 * * 1", prompt: "rutiner/torsk.md", enabled: false },
  ];
  return [
    page("list", renderProjectsPage(
      [proj, view("sildefjord", { manifest: { ok: false, error: "feil i fila" } })], NOW, NAV,
      { ...nb, removable: (name) => name === "kvitsyl", readinessByProject: { kvitsyl: true, sildefjord: false } },
    ), ["sildefjord", "feil i fila"]),
    page("Add project", renderAddProjectPage(NAV, NOW, { ...nb, worktreeLinkCandidates: ["node_modules"] }), ["node_modules"]),
    page("project › Deploy, not yet checked", renderProjectPage(proj, can.settings, can.readiness, NOW, NAV, {
      ...projectOpts, ...nb, tab: "deploy", boardItself: true, drift: { behind: null, checkedAt: null },
      serving: { sha: "abc1234", checkoutHead: "def5678", current: false, newestSubject: "rett en feil", behindCount: 2 },
    }), ["abc1234", "def5678", "rett en feil"]),
    page("project › Deploy, behind origin", renderProjectPage(proj, can.settings, can.readiness, NOW, NAV, {
      ...projectOpts, ...nb, tab: "deploy", boardItself: true, drift: { behind: 3, checkedAt: Date.parse(NOW) - 60_000 },
      serving: { sha: "abc1234", checkoutHead: "abc1234", current: true },
      deployFailure: { step: "install", error: "ingen forbindelse" },
    }), ["abc1234", "ingen forbindelse"]),
    page("project › Deploy, matching origin", renderProjectPage(proj, can.settings, can.readiness, NOW, NAV, {
      ...projectOpts, ...nb, tab: "deploy", boardItself: true, drift: { behind: 0, checkedAt: Date.parse(NOW) - 60_000 },
      serving: { sha: "abc1234", checkoutHead: "abc1234", current: true },
    }), ["abc1234"]),
    page("project › Deploy, another project's", renderProjectPage(proj, can.settings, can.readiness, NOW, NAV, {
      ...projectOpts, ...nb, tab: "deploy",
    })),
    page("project › Config, a project that can run", config(can), dirData(can)),
    page("project › Config, a failing check", config(cannot), dirData(cannot)),
    page("project › Config, no config file", renderProjectPage(proj, { hasConfigFile: false, rows: [] }, null, NOW, NAV, {
      ...projectOpts, ...nb, tab: "config", settingsHome: "none",
    })),
    page("project › Config, the first table in edit", config(can, { editingGroup: "project" }), dirData(can)),
    page("project › Config, the second table in edit", config(can, { editingGroup: "dashboard" }), dirData(can)),
    page("project › Schedule", renderProjectPage(proj, can.settings, can.readiness, NOW, NAV, {
      ...projectOpts, ...nb, tab: "schedule", schedule: entries,
    })),
  ];
}

// --- Schedule ---------------------------------------------------------------

const ENTRY = { name: "tunfisk", cron: "0 3 * * *", prompt: "rutiner/tunfisk.md", enabled: true, model: "kvikk" };
const DATA = ["kvitsyl", "tunfisk", "torsk", "rutiner/tunfisk.md", "kvikk", "raskkodex", "tung", "utdata"];
const row = (name: string, extra: Record<string, unknown> = {}) => ({
  project: "kvitsyl",
  entry: { ...ENTRY, name },
  projectScheduleHref: "/projects/kvitsyl?tab=schedule",
  ...extra,
});

export function scheduleStates(): PageState[] {
  const page = (state: string, html: string, data: string[] = []): PageState => ({
    page: `Schedule › ${state}`, html, data: [...data, ...DATA],
  });
  const detail = (tab: string, extra: Record<string, unknown> = {}) =>
    renderScheduleDetailPage(NAV, NOW, {
      project: "kvitsyl", entry: ENTRY, tab, runs: [], ...nb, modelChoices: MODELS, defaultModels: DEFAULTS, ...extra,
    });
  return [
    page("list, an entry that never ran and one that did", renderSchedulePage(NAV, NOW, {
      ...nb, modelNames: ["kvikk"],
      rows: [row("tunfisk"), row("torsk", { lastState: "done", lastRunAt: AT, outputHref: "/schedule/kvitsyl/torsk/utdata" })],
    })),
    page("list, no entries", renderSchedulePage(NAV, NOW, { ...nb, rows: [] })),
    page("list, a search that matches none", renderSchedulePage(NAV, NOW, {
      ...nb, rows: [row("tunfisk")], filter: { q: "ingenting" },
    }), ["ingenting"]),
    page("entry › Report", detail("report")),
    page("entry › Settings", detail("settings")),
    page("entry › Settings, in edit", detail("settings", { editing: true })),
    page("new entry", renderScheduleNewPage(NAV, NOW, {
      project: "kvitsyl", backHref: "/projects/kvitsyl?tab=schedule", values: { name: "", cron: "0 7 * * *", prompt: "" },
      ...nb, modelChoices: MODELS, defaultModels: DEFAULTS,
    })),
    page("prompt, readable", renderSchedulePromptPage(NAV, NOW, {
      project: "kvitsyl", entry: ENTRY, text: "Gjor ingenting.", viewerSrc: "/viewer.js", lang: "nb",
    }), ["Gjor ingenting."]),
    page("prompt, unreadable", renderSchedulePromptPage(NAV, NOW, {
      project: "kvitsyl", entry: ENTRY, text: null, viewerSrc: "/viewer.js", lang: "nb",
    })),
  ];
}

// --- New spec ---------------------------------------------------------------

export function newSpecStates(): PageState[] {
  const targets = [
    { project: "kvitsyl", specFolder: "12-sildefangst", title: "Sildefangst" },
    { project: "kvitsyl", specFolder: "13-torskefiske", title: "Torskefiske" },
  ];
  const data = ["kvitsyl", "12-sildefangst", "13-torskefiske", "Sildefangst", "Torskefiske", ...MODELS.map((m) => m.name)];
  const page = (state: string, html: string): PageState => ({ page: `New spec › ${state}`, html, data });
  const opts = { createProjects: ["kvitsyl"], targets, modelChoices: MODELS, defaultModels: DEFAULTS, ...nb };
  return [
    page("Options tab", renderNewSpecPage(NAV, NOW, { ...opts, tab: "options" })),
    page("Spec tab", renderNewSpecPage(NAV, NOW, opts)),
    page("no project", renderNewSpecPage(NAV, NOW, { ...nb })),
  ];
}
