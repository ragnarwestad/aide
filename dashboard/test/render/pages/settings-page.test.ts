import { describe, expect, test } from "bun:test";
import { OTHER_STEPS, renderSettingsPage, SETTINGS_STEPS, SPEC_STEPS, UNROWED_STEPS } from "../../../src/render";
import { WORKFLOW_STEPS } from "../../../src/queue/steps.ts";

const MODELS = [
  { name: "sonnet", tool: "claude" as const },
  { name: "opus", tool: "claude" as const },
  { name: "codex-fast", tool: "codex" as const },
];

const TIMEOUT_SEC = { default: 1200, implement: 5400 };

describe("Settings page", () => {
  test("keeps the form with no model choices, but drops the AI/model columns", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain("No model choices are configured");
    expect(html).toContain('action="/api/queue/settings"');
    expect(html).not.toContain('name="budgetUsd"');
    expect(html).not.toContain('name="jobCapUsd"');
    for (const step of SETTINGS_STEPS) {
      expect(html).toContain(`name="timeoutSec.${step}"`);
    }
    expect(html).not.toContain('name="model.explore"');
    expect(html).not.toContain('name="timeoutSec.explore"');
  });

  test("renders every workflow step with its resolved model, matching AI and timeout", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet", implement: "codex-fast" },
      timeoutSec: TIMEOUT_SEC,
    });

    for (const step of SETTINGS_STEPS) {
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
      timeoutSec: TIMEOUT_SEC,
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

  test("the rows sit in three bodies: on a spec, not on a spec, fallback", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
    });
    const bodies = html.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? [];
    expect(bodies.length).toBe(3);
    expect(bodies[0]).toContain("On a spec");
    expect(bodies[1]).toContain("Not on a spec");
    expect(bodies[2]).toContain("Fallback");
    // A step belongs to one group only, and Default is not in either.
    expect(bodies[0]).toContain('data-step="implement"');
    expect(bodies[0]).not.toContain('data-step="manifest"');
    expect(bodies[1]).toContain('data-step="manifest"');
    expect(bodies[1]).toContain('data-step="schedule"');
    expect(bodies[1]).not.toContain('data-step="default"');
    expect(bodies[2]).toContain('data-step="default"');
  });

  test("the header line carries one '(?)' explaining the page", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
    });
    expect(html.match(/<details class="intro">/g)?.length ?? 0).toBe(1);
    const head = html.match(/<div class="backhead">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(head).toContain('<details class="intro">');
    // It explains the three things a row decides, and what Default is.
    const help = html.match(/<details class="intro">[\s\S]*?<\/details>/)?.[0] ?? "";
    for (const word of ["Timeout", "Default", "Model", "Manifest", "Schedule"]) {
      expect(help).toContain(word);
    }
  });

  // `pageShell()` is told `hideHeading: true`, and the page's own
  // `backLink()` call carries "Settings" as its title, drawing the one
  // <h1> inside .backhead, right after ← Back (spec 296) — the same
  // shape every other subpage's title now takes.
  test("has exactly one <h1>Settings</h1>, inside .backhead right after ← Back, with no model choices", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
    });
    expect(html.match(/<h1>Settings<\/h1>/g)?.length ?? 0).toBe(1);
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/">← Back</a><h1>Settings</h1><span class="headend">',
    );
  });

  test("has exactly one <h1>Settings</h1>, inside .backhead right after ← Back, with model choices", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
    });
    expect(html.match(/<h1>Settings<\/h1>/g)?.length ?? 0).toBe(1);
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/">← Back</a><h1>Settings</h1><span class="headend">',
    );
  });

  // Spec 252, Criteria 3, 4, 7: the top-left "← Back" tracks wherever
  // the reader opened Settings from — unchanged by spec 409, which put
  // a bottom Cancel back beside Save (REQ-8).
  test("← Back tracks the given backHref", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
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
      timeoutSec: TIMEOUT_SEC,
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
      timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toMatch(/<form[^>]*class="settingsform"/);
  });

  test("← Back falls back to / when no backHref was given (no Referer)", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });

  // Spec 408, REQ-2/REQ-6: Settings belongs to none of the tabs the
  // APPLICATION's bar offers, so that bar is not drawn, regardless of
  // language. The page's own tabs are a different row, marked
  // `subtabs`, exactly as every other tabbed subpage's are.
  test("draws no application tab bar, in English and Norwegian", () => {
    for (const lang of ["en", "nb"] as const) {
      const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
        modelChoices: [], defaultModels: { default: "sonnet" },
        timeoutSec: TIMEOUT_SEC,
        lang,
      });
      expect(html).not.toContain('<nav class="tabbar">');
      expect(html).toContain('<nav class="tabbar subtabs">');
    }
  });

  test("the page's own tabs are the phases table and one per AI", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
    });
    const bar = html.match(/<nav class="tabbar subtabs">[\s\S]*?<\/nav>/)?.[0] ?? "";
    for (const [tab, label] of [
      ["phases", "Phases"], ["claude", "Claude Code"], ["codex", "Codex"],
      ["copilot", "Copilot"], ["opencode", "OpenCode"],
    ]) {
      expect(bar).toContain(`href="/settings?tab=${tab}"`);
      expect(bar).toContain(`>${label}<`);
    }
    // The tools spell themselves: capitalising the key alone would give
    // "Claude" and "Opencode".
    expect(bar).not.toContain(">Opencode<");
  });

  test("the phases table is what an address with no tab opens", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain('<table class="settingstable">');
    expect(html).toContain('href="/settings?tab=phases" aria-current="page"');
  });

  test("an AI tab shows that tool's panel and not the phases table", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
      tab: "opencode",
    });
    expect(html).toContain('data-tool="opencode"');
    expect(html).not.toContain('<table class="settingstable">');
    expect(html).toContain('action="/api/queue/settings/check"');
    expect(html).toContain('name="tool" value="opencode"');
    expect(html).toContain("Not checked yet.");
  });

  test("a tab name that is not one of the tabs opens the phases table", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
      tab: "../../etc/passwd",
    });
    expect(html).toContain('<table class="settingstable">');
  });

  test("a tool whose models cannot be listed says so rather than showing a result", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
      tab: "claude",
    });
    expect(html).toContain("cannot tell you");
    expect(html).toContain("no command that lists them");
  });

  test("a check that has been made is shown with the moment it was made", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
      tab: "opencode",
      checks: {
        opencode: {
          tool: "opencode",
          at: "2026-09-16T08:30:00.000Z",
          found: true,
          lines: ["OpenCode found (1.18.31)"],
          extra: [
            { question: "Is a provider logged in?", ok: true, detail: "1 credentials" },
            { question: "Do the configured models still exist?", ok: false, detail: "Not listed any more: opencode/gone" },
          ],
        },
      },
    });
    expect(html).toContain("2026-09-16 08:30:00 UTC");
    expect(html).toContain("OpenCode found (1.18.31)");
    expect(html).toContain("Not listed any more: opencode/gone");
    expect(html).not.toContain("Not checked yet.");
  });

  // Spec 408, REQ-1: the frame around Settings' own form is threaded the
  // same `lang` every other page now takes.
  test("lang: \"nb\" renders <html lang=\"nb\"> and a Norwegian header string", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
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
      timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain("<th>Phase</th>");
    expect(html).not.toContain("<th>Step</th>");
  });

  test("REQ-5: the table has a close row, labelled Close", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
    });
    const row = html.match(/<tr[^>]*data-step="close"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(row).toContain(">Close<");
    expect(html).toContain('name="timeoutSec.close"');
  });

  test("REQ-6: the header carries separate AI and Model columns, never one combined header", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain("<th>AI</th>");
    expect(html).toContain("<th>Model</th>");
    expect(html).not.toContain("Default AI and model");
  });

  test("REQ-6: each row's AI and Model selects sit in their own <td>", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
    });
    const row = html.match(/<tr[^>]*data-step="analyze"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(row).toMatch(/<td><select[^>]*data-ai="model\.analyze"[\s\S]*?<\/select><\/td>/);
    expect(row).toMatch(/<td><select[^>]*name="model\.analyze"[\s\S]*?<\/select><\/td>/);
  });

  test("REQ-7: the table carries the settingstable class, sized to its own content", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
      timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toMatch(/<table class="settingstable">/);
  });
});

// The AI column had its own copy of the tool names — `codex ? "Codex" :
// "Claude Code"` — so a third tool arrived on this page under Claude
// Code's name. Fake-Claude exists precisely so a run it did is not
// mistaken for a real Claude run, and this page is where a reader picks.
describe("the AI column names the tool it is actually offering", () => {
  const settings = (modelChoices: { name: string; tool?: "claude" | "codex" | "fake-claude" }[]) =>
    renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices,
      defaultModels: { default: modelChoices[0]!.name },
      timeoutSec: TIMEOUT_SEC,
    });

  const aiSelect = (html: string): string =>
    html.match(/<select aria-label="AI for Default"[\s\S]*?<\/select>/)?.[0] ?? "";

  test("the scripted stand-in is offered as Fake-Claude, never as Claude Code", () => {
    const ai = aiSelect(settings([{ name: "script", tool: "fake-claude" }]));
    expect(ai).toContain(">Fake-Claude<");
    expect(ai).not.toContain(">Claude Code<");
  });

  test("a choice that names no tool is still offered as Claude Code", () => {
    expect(aiSelect(settings([{ name: "sonnet" }]))).toContain(">Claude Code<");
  });
});
