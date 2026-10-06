import { describe, expect, test } from "bun:test";
import {
  AI_TABS, OTHER_STEPS, renderSettingsPage, resolveSettingsTab, settingsRowChoice, SETTINGS_GROUPS, SETTINGS_STEPS,
  SPEC_STEPS, TOOL_PARTS, toolPanel, toolPart, UNROWED_STEPS,
} from "../../../src/render";
import { t } from "../../../src/i18n";
import { tabLabel } from "../../../src/render/ui/tabs.ts";
import { WORKFLOW_STEPS } from "../../../src/queue/steps.ts";
import { mergeQueueDefaults } from "../../../src/queue/queue.ts";
import { QUEUE_DEFAULTS } from "../../../src/serve/serve-helpers";
import { settingsAnswer } from "../../../src/specs-client/forms.ts";
import { Window } from "happy-dom";

const MODELS = [
  { name: "sonnet", tool: "claude" as const },
  { name: "opus", tool: "claude" as const },
  { name: "codex-fast", tool: "codex" as const },
];

const TIMEOUT_SEC = { default: 1200, implement: 5400 };

describe("Settings page", () => {
  // The rows still come FROM the canonical step list rather than a
  // hand-picked copy of it — but now through two groups plus a named
  // set of steps that deliberately get no row, so a step added to
  // workflow-steps.json still cannot end up silently without one.
  test("every workflow step is grouped or named unrowed", () => {
    const covered = [...SPEC_STEPS, ...OTHER_STEPS, ...UNROWED_STEPS];
    expect([...covered].sort()).toEqual([...WORKFLOW_STEPS].sort());
  });

  test("the two groups are exactly the rows, in order", () => {
    expect(SETTINGS_STEPS).toEqual([...SPEC_STEPS, ...OTHER_STEPS]);
  });

  test("explore gets no row: nothing on the board starts it", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).not.toContain('data-step="explore"');
  });

  test("the rows are the steps and nothing else: no Fallback row (AC-2)", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
    });
    const rows = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual([...SETTINGS_STEPS]);
  });
});

describe("what a Settings row shows", () => {
  // As the page receives them from the serving host: capitalised, and not
  // with Opus first, so a name that fails to match shows up as Fable.
  const HOST_MODELS = [
    { name: "Fable", tool: "claude" as const },
    { name: "Opus", tool: "claude" as const },
    { name: "Sonnet", tool: "claude" as const },
    { name: "codex-fast", tool: "codex" as const },
  ];
  const listed = { Fable: {}, Opus: {}, Sonnet: {}, "codex-fast": { tool: "codex" } };

  test("a row nothing was saved for shows Claude Code and Opus (AC-3)", () => {
    const { model } = mergeQueueDefaults(QUEUE_DEFAULTS, { modelChoices: listed });
    for (const step of SETTINGS_STEPS) {
      expect(settingsRowChoice(HOST_MODELS, model, step)).toEqual({ model: "Opus", tool: "claude" });
    }
  });

  test("a step's own saved choice is what its row shows (AC-4)", () => {
    const { model } = mergeQueueDefaults(QUEUE_DEFAULTS, {
      modelChoices: listed, model: { implement: "codex-fast" },
    });
    expect(settingsRowChoice(HOST_MODELS, model, "implement")).toEqual({ model: "codex-fast", tool: "codex" });
    expect(settingsRowChoice(HOST_MODELS, model, "analyze")).toEqual({ model: "Opus", tool: "claude" });
  });
});

describe("the Settings tabs", () => {
  const render = (tab: string) =>
    renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC, tab,
    });
  /** The keys the page links to, and the ones marked as open. A link that
   *  also names a tab inside an AI's tab belongs to that inner row. */
  const links = (html: string) => {
    const all = [...html.matchAll(/href="\/settings\?tab=([^"&]+)"([^>]*)>/g)];
    return {
      keys: new Set(all.map((m) => m[1])),
      current: new Set(all.filter((m) => m[2]!.includes("aria-current")).map((m) => m[1])),
    };
  };

  test("the top row is AI, Process and Notifications (AC-1)", () => {
    expect([...SETTINGS_GROUPS]).toEqual(["ai", "process", "notifications"]);
    expect(SETTINGS_GROUPS.map(tabLabel)).toEqual(["AI", "Process", "Notifications"]);
  });

  test("AI's row is the models table, then one tab per AI (AC-2)", () => {
    expect([...AI_TABS]).toEqual(["phases", "claude", "codex", "copilot", "opencode"]);
    expect(AI_TABS.map(tabLabel)).toEqual(["Models per phase", "Claude Code", "Codex", "Copilot", "OpenCode"]);
  });

  test("AI opens on Models per phase, as does no tab or an unknown one (AC-2)", () => {
    for (const raw of ["ai", undefined, "nope"]) {
      expect(resolveSettingsTab(raw)).toEqual({ group: "ai", panel: "phases" });
    }
  });

  test("every old tab opens its own panel in its new place (AC-4)", () => {
    for (const old of AI_TABS) {
      expect(resolveSettingsTab(old)).toEqual({ group: "ai", panel: old });
    }
    expect(resolveSettingsTab("notifications")).toEqual({ group: "notifications", panel: "notifications" });
    for (const raw of [...AI_TABS, ...SETTINGS_GROUPS, undefined, "nope"]) {
      expect(SETTINGS_GROUPS as readonly string[]).toContain(resolveSettingsTab(raw).group);
    }
  });

  test("the page offers the AI row only under AI (AC-1, AC-2)", () => {
    const claude = links(render("claude"));
    expect(claude.keys).toEqual(new Set([...SETTINGS_GROUPS, ...AI_TABS]));
    expect(claude.current).toEqual(new Set(["ai", "claude"]));
    const notifications = links(render("notifications"));
    expect(notifications.keys).toEqual(new Set(SETTINGS_GROUPS));
    expect(notifications.current).toEqual(new Set(["notifications"]));
  });

  test("Process is its own group (AC-5)", () => {
    expect(resolveSettingsTab("process")).toEqual({ group: "process", panel: "process" });
  });
});

describe("the tabs inside an AI's tab", () => {
  /** Each inner tab the panel links to, as its address and its words. */
  const innerTabs = (html: string) =>
    [...html.matchAll(/<a [^>]*href="([^"]*aitab=[^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({
      href: m[1]!.replaceAll("&amp;", "&"),
      label: m[2],
    }));

  test("they are Models, Usage and Installation, in that order, each a link of its own (AC-1)", () => {
    expect([...TOOL_PARTS]).toEqual(["models", "subscription", "installation"]);
    for (const tool of ["claude", "codex", "copilot", "opencode"] as const) {
      expect(innerTabs(toolPanel(tool, undefined))).toEqual(TOOL_PARTS.map((part) => ({
        href: `/settings?tab=${tool}&aitab=${part}`,
        label: t("en", `settings.part.${part}`),
      })));
    }
  });

  test("an AI's tab opens on Models, as does an unknown inner tab (AC-2)", () => {
    for (const raw of [undefined, "", "nope", "Models"]) expect(toolPart(raw)).toBe("models");
  });

  test("a named inner tab opens that tab, not Models (AC-2)", () => {
    expect(toolPart("installation")).toBe("installation");
    expect(toolPart("subscription")).toBe("subscription");
  });
});

describe("the Settings answer lines", () => {
  const PROCESS = { concurrency: 2, cores: 8, min: 1, max: 16 };
  const render = (tab: string) =>
    renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC, tab, process: PROCESS,
    });
  /** The tab's Settings form, parsed, as the page's script finds it. */
  const settingsForm = (html: string): HTMLFormElement => {
    const window = new Window();
    window.document.body.innerHTML = html;
    return window.document.querySelector("form[data-settings-form]") as unknown as HTMLFormElement;
  };
  const words = (f: HTMLFormElement, hook: string): string => f.querySelector(`.${hook} span`)?.textContent ?? "?";

  // A refusal and "Defaults saved" each have a line of their own, so the
  // script never has to turn one kind into the other, and each answer
  // empties the other kind's line.
  test("Models per phase and Process each hold a line for a save's answer and one for its refusal, each emptying the other (AC-3)", () => {
    for (const tab of ["phases", "process"]) {
      const f = settingsForm(render(tab));
      settingsAnswer(f, "timeout must be a number", false);
      const refused = { notice: words(f, "notice"), refused: words(f, "refused") };
      settingsAnswer(f, "Defaults saved", true);
      const saved = { notice: words(f, "notice"), refused: words(f, "refused") };
      settingsAnswer(f, "timeout must be a number", false);
      const refusedAgain = { notice: words(f, "notice"), refused: words(f, "refused") };
      expect({ tab, refused, saved, refusedAgain }).toEqual({
        tab,
        refused: { notice: "", refused: "Timeout must be a number" },
        saved: { notice: "Defaults saved", refused: "" },
        refusedAgain: { notice: "", refused: "Timeout must be a number" },
      });
    }
  });
});
