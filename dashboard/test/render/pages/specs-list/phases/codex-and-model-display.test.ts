import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type SpecsPageOptions, type SpecTarget } from "../../../../../src/render";
import { TOOL_ICONS } from "../../../../../src/render/ui/components/icons.ts";
import { openKeys } from "../../fixtures.ts";

// The compact button a phone shows for a phase line: the provider's tool
// icon and short name, then the model.
describe("the compact button names the provider by its icon and short name", () => {
  const targets: SpecTarget[] = [{ project: "aide", specFolder: "795-faces" }];
  const PERSONAL = { key: "personal", name: "Claude Personal", short: "CP", tool: "claude" as const };
  const CODEX = { key: "codex", name: "Codex", short: "CO", tool: "codex" as const };
  const rows = (opts: Partial<SpecsPageOptions>) =>
    renderSpecsRows([], {
      runnerAvailable: true, targets, providerChoices: [PERSONAL, CODEX], filter: { open: openKeys([], targets) }, ...opts,
    }, Date.parse("2026-11-13T12:00:00Z"));
  const button = (html: string, step: string) =>
    html.match(new RegExp(`<label class="aimodelnow" for="aim-aide/795-faces-${step}"[^>]*>[\\s\\S]*?</label>`))?.[0] ?? "";

  test("the button leads with the provider's tool icon and short name, then the model, the full name in its title (AC-8)", () => {
    const now = button(rows({ modelChoices: [{ name: "sonnet" }, { name: "gpt-fast", tool: "codex" }] }), "analyze");
    expect(now).toContain(TOOL_ICONS.claude);
    expect(now).toContain(">CP<");
    expect(now.indexOf(">CP<")).toBeLessThan(now.indexOf(">sonnet<"));
    expect(now).toContain('title="Claude Personal · sonnet"');
    expect(now).not.toContain("Claude Personal ·</");
  });

  test("a stand-in model is shown with Claude Code's icon (AC-8)", () => {
    const now = button(rows({ modelChoices: [{ name: "scripted", tool: "fake-claude" }] }), "analyze");
    expect(now).toContain(TOOL_ICONS.claude);
    expect(now).toContain(">CP<");
  });

  test("a line on a Codex model leads with Codex's icon and its short name (AC-8)", () => {
    const now = button(rows({ modelChoices: [{ name: "gpt-fast", tool: "codex" }] }), "implement");
    expect(now).toContain(TOOL_ICONS.codex);
    expect(now).toContain(">CO<");
  });
});
