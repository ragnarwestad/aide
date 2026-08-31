import { describe, expect, test } from "bun:test";
import { renderSettingsPage } from "../../../src/render.ts";

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
    for (const step of ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen"]) {
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

    for (const step of ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen"]) {
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

  // Spec 252, Criteria 3, 4, 7: the top-left "← Back" replaces the
  // bottom Cancel this page used to draw beside Save — one control, not
  // two, and it tracks wherever the reader opened Settings from.
  test("← Back tracks the given backHref, and there is no bottom Cancel", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
      backHref: "/projects/aide",
    });
    expect(html).toContain('<a class="backlink" href="/projects/aide">← Back</a>');
    expect(html).not.toContain(">Cancel<");
  });

  test("← Back falls back to / when no backHref was given (no Referer)", () => {
    const html = renderSettingsPage([{ label: "Projects", path: "/projects" }], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS,
      defaultModels: { default: "sonnet" },
      budgetUsd: 3, jobCapUsd: 10, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });
});
