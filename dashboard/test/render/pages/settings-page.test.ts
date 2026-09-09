import { describe, expect, test } from "bun:test";
import { renderSettingsPage, SETTINGS_STEPS } from "../../../src/render.ts";
import { WORKFLOW_STEPS } from "../../../src/queue/steps.ts";

const MODELS = [
  { name: "sonnet", budgetUsd: 3, tool: "claude" as const },
  { name: "opus", budgetUsd: 8, tool: "claude" as const },
  { name: "codex-fast", budgetUsd: 5, tool: "codex" as const },
];

const TIMEOUT_SEC = { default: 1200, implement: 5400 };

describe("Settings page", () => {
  test("keeps the form with no model choices, but drops the AI/model columns", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain("No model choices are configured");
    expect(html).toContain('action="/api/queue/settings"');
    expect(html).toContain('name="budgetUsd"');
    expect(html).toContain('name="jobCapUsd"');
    for (const step of ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen", "reset", "schedule"]) {
      expect(html).toContain(`name="timeoutSec.${step}"`);
    }
    expect(html).not.toContain('name="model.explore"');
  });

  test("renders every workflow step with its resolved model, matching AI and timeout", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet", implement: "codex-fast" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });

    for (const step of ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen", "reset", "schedule"]) {
      expect(html).toContain(`name="model.${step}"`);
      expect(html).toContain(`data-ai="model.${step}"`);
      expect(html).toContain(`name="timeoutSec.${step}"`);
    }
    const implement = html.match(/<tr[^>]*data-step="implement"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(implement).toContain('value="codex-fast"');
    expect(implement).toMatch(/value="codex"[^>]* selected/);
    // 5400s -> 90 minutes, matching the display convention already used
    // at render/job-state.ts:145.
    expect(implement).toContain('name="timeoutSec.implement" value="90"');
    const analyze = html.match(/<tr[^>]*data-step="analyze"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(analyze).toContain('name="timeoutSec.analyze" value="20"');
    expect(html).toContain('name="budgetUsd" value="3"');
    expect(html).toContain('name="jobCapUsd" value="10"');
    expect(html).toContain('action="/api/queue/settings"');
    expect(html).toContain('href="/"');
  });

  // Spec 420, REQ-2, criterion 3: the fallback every un-rowed lookup
  // reads (`table[step] ?? table.default`) gets its own row too, so it
  // is visible and editable rather than only reachable by hand-editing
  // queue-config.json.
  test("REQ-2: a Default row shows and edits the fallback AI, model and timeout", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet", implement: "codex-fast" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    const row = html.match(/<tr[^>]*data-step="default"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(row).toContain('data-ai="model.default"');
    expect(row).toContain('name="model.default"');
    expect(row).toContain('name="timeoutSec.default"');
    expect(row).toContain(">Default<");
    expect(row).toContain('value="sonnet"');
    // TIMEOUT_SEC.default is 1200s -> 20 minutes.
    expect(row).toContain('name="timeoutSec.default" value="20"');
  });

  // Spec 420, REQ-3, criterion 5: the settings rows come FROM the
  // canonical step list rather than a hand-picked copy of it, so a step
  // this codebase adds to workflow-steps.json cannot end up without one.
  test("REQ-3: SETTINGS_STEPS is WORKFLOW_STEPS", () => {
    expect(SETTINGS_STEPS).toBe(WORKFLOW_STEPS);
  });

  // `pageShell()` is told `hideHeading: true`, and the page's own
  // `backLink()` call carries "Settings" as its title, drawing the one
  // <h1> inside .backhead, right after ← Back (spec 296) — the same
  // shape every other subpage's title now takes.
  test("has exactly one <h1>Settings</h1>, inside .backhead right after ← Back, with no model choices", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html.match(/<h1>Settings<\/h1>/g)?.length ?? 0).toBe(1);
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/">← Back</a><h1>Settings</h1></div>',
    );
  });

  test("has exactly one <h1>Settings</h1>, inside .backhead right after ← Back, with model choices", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html.match(/<h1>Settings<\/h1>/g)?.length ?? 0).toBe(1);
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/">← Back</a><h1>Settings</h1></div>',
    );
  });

  // Spec 252, Criteria 3, 4, 7: the top-left "← Back" tracks wherever
  // the reader opened Settings from — unchanged by spec 409, which put
  // a bottom Cancel back beside Save (REQ-8).
  test("← Back tracks the given backHref", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
      backHref: "/projects/aide",
    });
    expect(html).toContain('<a class="backlink" href="/projects/aide">← Back</a>');
  });

  // Spec 409, REQ-8: Save gets a Cancel to its right, inside the same
  // `.configactions` wrapper the per-project Settings tab already uses
  // for this exact shape — reversing spec 252's removal of a bottom
  // Cancel on this one page.
  test("REQ-8: Cancel sits beside Save inside .configactions", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    const actions = html.match(/<div class="configactions">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(actions).toContain('id="settingsform-save"');
    expect(actions).toContain('id="settingsform-cancel"');
    expect(actions).toContain(">Save<");
    expect(actions).toContain(">Cancel<");
  });

  // Spec 409, REQ-9: the form itself carries the "settingsform" prefix
  // spec-form-actions.ts's bind() loop needs to find it.
  test("REQ-9: the form carries class=\"settingsform\"", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toMatch(/<form[^>]*class="settingsform"/);
  });

  test("← Back falls back to / when no backHref was given (no Referer)", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });

  // Spec 408, REQ-2/REQ-6: Settings belongs to none of the tabs the bar
  // offers, so it draws no tab bar at all, regardless of language.
  test("draws no <nav class=\"tabbar\">, in English and Norwegian", () => {
    for (const lang of ["en", "nb"] as const) {
      const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
        modelChoices: [], defaultModels: { default: "sonnet" },
        budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
        lang,
      });
      expect(html).not.toContain('<nav class="tabbar');
    }
  });

  // Spec 408, REQ-1: the frame around Settings' own form is threaded the
  // same `lang` every other page now takes.
  test("lang: \"nb\" renders <html lang=\"nb\"> and a Norwegian header string", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
      lang: "nb",
    });
    expect(html).toContain('<html lang="nb">');
    expect(html).toContain('aria-label="Tema"');
  });
});

// Spec 409.
describe("Settings page wording and layout (spec 409)", () => {
  test("REQ-4: the first header column reads Phase, never Step", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain("<th>Phase</th>");
    expect(html).not.toContain("<th>Step</th>");
  });

  test("REQ-5: the table has a close row, labelled Close", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    const row = html.match(/<tr[^>]*data-step="close"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(row).toContain(">Close<");
    expect(html).toContain('name="timeoutSec.close"');
  });

  test("REQ-6: the header carries separate AI and Model columns, never one combined header", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain("<th>AI</th>");
    expect(html).toContain("<th>Model</th>");
    expect(html).not.toContain("Default AI and model");
  });

  test("REQ-6: each row's AI and Model selects sit in their own <td>", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    const explore = html.match(/<tr[^>]*data-step="explore"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(explore).toMatch(/<td><select[^>]*data-ai="model\.explore"[\s\S]*?<\/select><\/td>/);
    expect(explore).toMatch(/<td><select[^>]*name="model\.explore"[\s\S]*?<\/select><\/td>/);
  });

  test("REQ-7: the table carries the settingstable class, sized to its own content", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toMatch(/<table class="settingstable">/);
  });

  // Spec 414, REQ-1/REQ-3: Units moved from after the form to a literal
  // descendant of it, directly after Job cap and before the AI settings
  // table — the radios' own markup (name/value/data-unit-choice/checked)
  // is unchanged, only their position moved.
  test("REQ-1: Units sits inside the form, directly after Job cap and before the AI settings table", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toMatch(/<input type="radio" name="unit" value="usd" data-unit-choice="usd" checked>/);
    expect(html).toMatch(/<input type="radio" name="unit" value="tokens" data-unit-choice="tokens">/);
    const jobCapIdx = html.indexOf('name="jobCapUsd"');
    const unitsIdx = html.indexOf('<span class="lbl">Units</span>');
    const tableIdx = html.indexOf('<table class="settingstable">');
    expect(jobCapIdx).toBeGreaterThan(-1);
    expect(unitsIdx).toBeGreaterThan(jobCapIdx);
    expect(tableIdx).toBeGreaterThan(unitsIdx);
  });

  // Regression guard for the spec-409 assertion this replaces: that test
  // asserted no radio appears between the form tags on purpose. REQ-1
  // now requires the opposite.
  test("REQ-1 (regression guard): a radio input now appears between the form's own tags", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    const formOpen = html.indexOf('<form id="settings-form"');
    const formClose = html.indexOf("</form>", formOpen) + "</form>".length;
    const between = html.slice(formOpen, formClose);
    expect(between).toContain('type="radio"');
  });

  // Spec 414, REQ-2: Budget per job and Job cap adopt the same .row/.lbl
  // shape Units already used, so all three rows line up.
  test("REQ-2: Budget per job, Job cap and Units are each a .row with a .lbl label", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toMatch(
      /<p class="row"><label class="lbl" for="budgetUsd">Budget per job \(USD\)<\/label><input id="budgetUsd"[^>]*name="budgetUsd"[^>]*><\/p>/,
    );
    expect(html).toMatch(
      /<p class="row"><label class="lbl" for="jobCapUsd">Job cap \(USD\)<\/label><input id="jobCapUsd"[^>]*name="jobCapUsd"[^>]*><\/p>/,
    );
    expect(html).toMatch(/<p class="row"><span class="lbl">Units<\/span>/);
  });
});

// The AI column had its own copy of the tool names — `codex ? "Codex" :
// "Claude Code"` — so a third tool arrived on this page under Claude
// Code's name. Fake-Claude exists precisely so a run it did is not
// mistaken for a real Claude run, and this page is where a reader picks.
describe("the AI column names the tool it is actually offering", () => {
  const settings = (modelChoices: { name: string; budgetUsd: number; tool?: "claude" | "codex" | "fake-claude" }[]) =>
    renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices,
      defaultModels: { default: modelChoices[0]!.name },
      budgetUsd: 3,
      jobCapUsd: 10,
      timeoutSec: TIMEOUT_SEC,
    });

  const aiSelect = (html: string): string =>
    html.match(/<select aria-label="AI for Default"[\s\S]*?<\/select>/)?.[0] ?? "";

  test("the scripted stand-in is offered as Fake-Claude, never as Claude Code", () => {
    const ai = aiSelect(settings([{ name: "script", budgetUsd: 1, tool: "fake-claude" }]));
    expect(ai).toContain(">Fake-Claude<");
    expect(ai).not.toContain(">Claude Code<");
  });

  test("a choice that names no tool is still offered as Claude Code", () => {
    expect(aiSelect(settings([{ name: "sonnet", budgetUsd: 3 }]))).toContain(">Claude Code<");
  });
});
