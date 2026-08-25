import { describe, expect, test } from "bun:test";
import { renderSettingsPage } from "../src/render.ts";
import { CSS } from "../src/render/css.ts";

const MODELS = [
  { name: "sonnet", budgetUsd: 3, tool: "claude" as const },
  { name: "opus", budgetUsd: 8, tool: "claude" as const },
  { name: "codex-fast", budgetUsd: 5, tool: "codex" as const },
];

describe("Settings page", () => {
  test("explains when the server offers no models", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
    });
    expect(html).toContain("No model choices are configured");
    expect(html).not.toContain('action="/api/queue/settings"');
  });

  test("renders every workflow step with its resolved model and matching AI", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet", implement: "codex-fast" },
    });

    for (const step of ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen"]) {
      expect(html).toContain(`name="model.${step}"`);
      expect(html).toContain(`data-ai="model.${step}"`);
    }
    const implement = html.match(/<tr[^>]*data-step="implement"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(implement).toContain('value="codex-fast"');
    expect(implement).toMatch(/value="codex"[^>]* selected/);
    expect(html).toContain('action="/api/queue/settings"');
    expect(html).toContain('href="/"');
  });

  // Spec 243: `pageShell()` draws its own pagehead ("<h1>Settings</h1>")
  // unless told not to, and the page's own body also opened with a
  // hardcoded one — two on the same page. Both branches share the bug.
  test("has exactly one <h1>Settings</h1>, with no model choices", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: [], defaultModels: { default: "sonnet" },
    });
    expect(html.match(/<h1>Settings<\/h1>/g)?.length ?? 0).toBe(1);
  });

  test("has exactly one <h1>Settings</h1>, with model choices", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
    });
    expect(html.match(/<h1>Settings<\/h1>/g)?.length ?? 0).toBe(1);
  });

  // Spec 243: `.factions` (Save/Cancel) carries no gap rule scoped to
  // this page anywhere in css.ts — every existing home is scoped under
  // a different parent class.
  test("Save and Cancel have a visible gap", () => {
    const body = CSS.match(/#settings-form \.factions\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toContain("display: flex");
    expect(body).toContain("gap:");
  });
});
