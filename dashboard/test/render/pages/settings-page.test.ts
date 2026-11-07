import { describe, expect, test } from "bun:test";
import {
  CHECKABLE_TOOLS, OTHER_STEPS, renderSettingsPage, resolveSettingsTab, settingsRowChoice, SETTINGS_PANELS, SETTINGS_STEPS,
  SPEC_STEPS, UNROWED_STEPS,
} from "../../../src/render";
import { PROVIDER_TABS, providerDetail, providerTab, providerTabPath } from "../../../src/render/pages/settings-page/provider-detail.ts";
import { toolWhere } from "../../../src/render/pages/settings-page/tools.ts";
import { INSTALL_TARGETS, placesOf } from "../../../src/render/pages/settings-page/places.ts";
import { esc } from "../../../src/render/ui/html.ts";
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
  test("Review and Verify offer every model and select their setting or the default (AC-1, AC-2)", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: [...MODELS, { name: "pickle", tool: "opencode" as const }],
      providerChoices: [
        { key: "Claude", name: "Claude", tool: "claude" },
        { key: "Codex", name: "Codex", tool: "codex" },
        { key: "OpenCode", name: "OpenCode", tool: "opencode" },
      ],
      defaultModels: { default: "sonnet", review: "codex-fast" }, timeoutSec: TIMEOUT_SEC,
    });
    for (const part of ["review", "verify"]) {
      expect(html).toContain(`name="provider.${part}"`);
      expect(html).toContain(`name="model.${part}"`);
      expect(html).not.toContain(`name="timeoutSec.${part}"`);
    }
    for (const part of ["review", "verify"]) {
      const row = html.match(new RegExp(`<tr data-side="${part}">[\\s\\S]*?<\\/tr>`))?.[0] ?? "";
      expect(row).not.toContain("Same as Implement");
      expect(row).not.toContain('<option value="">Off</option>');
      for (const model of ["sonnet", "opus", "codex-fast", "pickle"]) expect(row).toContain(`value="${model}"`);
      expect(row).toMatch(new RegExp(`<option value="${part === "review" ? "codex-fast" : "sonnet"}"[^>]*selected`));
      expect(row).not.toContain("hidden disabled");
    }
  });

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

  test("the rows are the steps and nothing else: no Fallback row", () => {
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

  test("a row nothing was saved for shows Claude Code and Opus", () => {
    const { model } = mergeQueueDefaults(QUEUE_DEFAULTS, { modelChoices: listed });
    for (const step of SETTINGS_STEPS) {
      expect(settingsRowChoice(HOST_MODELS, model, step)).toEqual({ model: "Opus", tool: "claude" });
    }
  });

  test("a step's own saved choice is what its row shows", () => {
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

  test("the one row is Models per phase, Providers, Process and Notifications", () => {
    expect([...SETTINGS_PANELS]).toEqual(["phases", "providers", "process", "notifications"]);
    expect(SETTINGS_PANELS.map(tabLabel)).toEqual(["Models per phase", "Providers", "Process", "Notifications"]);
    expect([...CHECKABLE_TOOLS]).toEqual(["claude", "codex", "opencode"]);
  });

  test("the page opens on Models per phase, as do the AI tab it had, no tab and an unknown one", () => {
    for (const raw of ["ai", undefined, "nope"]) expect(resolveSettingsTab(raw)).toBe("phases");
  });

  test("every tab opens its own panel, and a removed tool tab opens Providers (AC-2)", () => {
    for (const tab of SETTINGS_PANELS) expect(resolveSettingsTab(tab)).toBe(tab);
    for (const old of ["claude", "codex", "copilot", "opencode"]) expect(resolveSettingsTab(old)).toBe("providers");
  });

  test("the page links the four tabs and marks the open one", () => {
    const claude = links(render("claude"));
    expect(claude.keys).toEqual(new Set(SETTINGS_PANELS));
    expect(claude.current).toEqual(new Set(["providers"]));
  });
});

describe("the tabs of a provider's page", () => {
  const PROVIDER = { name: "Claude", tool: "claude" as const };
  const STATUS = { key: "Claude", at: "2026-11-05T09:00:00.000Z", installed: true, version: "2.1.318 (Claude Code)" };
  const USAGE = { tool: "claude" as const, at: "2026-11-05T09:00:00.000Z", windows: [{ name: "Window of Claude", usedPercent: 7 }] };
  const READING = "<p>what the tab read</p>";
  const draw = (aiTab?: string, tool: "claude" | "codex" | "opencode" = "claude") =>
    providerDetail({ key: "Claude", provider: { ...PROVIDER, tool }, status: STATUS, usage: USAGE, reading: READING, aiTab }, Date.parse(STATUS.at), "en");
  /** Each tab the page links to, as its address and its words. */
  const tabs = (html: string) =>
    [...html.matchAll(/<a [^>]*href="([^"]*aitab=[^"]*)"([^>]*)>([^<]*)<\/a>/g)].map((m) => ({
      href: m[1]!.replaceAll("&amp;", "&"), label: m[3], current: m[2]!.includes("aria-current"),
    }));

  test("they are Config, Usage, Models and Installation, in that order, each a link to the provider's page", () => {
    expect([...PROVIDER_TABS]).toEqual(["config", "usage", "models", "installation"]);
    expect(tabs(draw()).map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/settings?tab=providers&provider=Claude&aitab=config", label: "Config" },
      { href: "/settings?tab=providers&provider=Claude&aitab=usage", label: "Usage" },
      { href: "/settings?tab=providers&provider=Claude&aitab=models", label: t("en", "settings.part.models") },
      { href: "/settings?tab=providers&provider=Claude&aitab=installation", label: t("en", "settings.part.installation") },
    ]);
    expect(providerTabPath("Claude", "models")).toBe("/settings?tab=providers&provider=Claude&aitab=models");
  });

  test("the page opens on Config, as does an absent, empty or unknown tab, and the old Overview", () => {
    for (const raw of [undefined, "", "nope", "Models", "overview"]) expect(providerTab(raw)).toBe("config");
    expect(tabs(draw()).filter((x) => x.current).map((x) => x.label)).toEqual(["Config"]);
  });

  test("a named tab opens that tab", () => {
    for (const tab of PROVIDER_TABS) {
      expect(providerTab(tab)).toBe(tab);
      expect(tabs(draw(tab)).filter((x) => x.current).map((x) => x.href.split("aitab=")[1])).toEqual([tab]);
    }
  });

  test("Usage holds the login and the usage, and neither the version nor the form", () => {
    const html = draw("usage");
    expect(html).toContain("Window of Claude");
    expect(html).not.toContain(STATUS.version);
    expect(html).not.toContain('id="provider-form"');
  });

  test("Config holds the form, whose Save and Cancel come back to Config, and no status or usage", () => {
    const html = draw("config");
    const here = providerTabPath("Claude", "config");
    expect(html).toContain('id="provider-form"');
    expect(html).toContain(`data-done="${here.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`data-cancel-href="${here.replaceAll("&", "&amp;")}"`);
    expect(html).not.toContain("Window of Claude");
    expect(html).not.toContain(READING);
    expect(html).not.toContain(t("en", "settings.providers.status"));
  });

  test("Models holds what the server read for it, and nothing for the page's script to fill", () => {
    const html = draw("models");
    expect(html).toContain(READING);
    expect(html).not.toContain("data-read-from");
    expect(html).not.toContain('id="provider-form"');
    expect(html).not.toContain("Window of Claude");
  });

  test.each(["claude", "codex", "opencode"] as const)("%s's Installation tab holds the sentence naming where aide installs, and what the server read for it", (tool) => {
    const html = draw("installation", tool);
    expect(html).toContain(READING);
    expect(html).not.toContain("data-read-from");
    expect(html).toContain(esc(toolWhere("en", tool, placesOf(INSTALL_TARGETS, tool))));
  });

  test("every tab has the line Remove's refusal is written into, exactly once", () => {
    for (const tab of PROVIDER_TABS) expect(draw(tab).split('id="provider-refused"').length - 1).toBe(1);
  });

  test("no tab draws a Check, its form or its (?) (AC-6)", () => {
    for (const tab of PROVIDER_TABS) {
      const html = draw(tab);
      expect(html).not.toContain("/api/queue/settings/check");
      expect(html).not.toContain("check-provider");
    }
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
  test("Models per phase and Process each hold a line for a save's answer and one for its refusal, each emptying the other", () => {
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
