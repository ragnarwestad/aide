// The settings table's editable fields: one-line textareas that wrap,
// in cells the width rule can reach.
import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render";
import type { ProjectView } from "../../../../src/render";

const NAV = { specs: 0, running: 0 } as never;
const project = (): ProjectView =>
  ({ name: "aide", path: "/p/aide", description: "", specs: [], manifest: { ok: false, error: "no manifest" } }) as never;

const row = (key: string, value: string | null, origin = "configured") =>
  ({ key, purpose: "p", value, origin }) as never;

const ROWS = [
  row("AIDE_SPECS_PATH", "/repos/specs/aide"),
  row("AIDE_WORKTREE_LINKS", "node_modules"),
  row("AIDE_INSTALL_CMD", "bun install"),
  row("AIDE_PREVIEW_CMD", "bun run dev"),
  row("AIDE_TEST_CMD", "make test"),
];

const page = (editing: boolean, candidates: string[] = []) =>
  renderProjectPage(project(), { hasConfigFile: true, rows: ROWS }, null, "2026-08-31T00:00:00Z", NAV, {
    worktreeLinkCandidates: candidates,
    editing,
    codeLanding: "merge",
  });

/** Only the settings table: the page around it has its own selects. */
const table = (html: string) => {
  const from = html.indexOf('<col data-col="setting-name"');
  return html.slice(from, html.indexOf("</table>", from));
};

describe("the settings table in edit mode", () => {
  test("each text setting is a one-row textarea in a marked Value cell, and no text input is left (AC-1)", () => {
    const html = table(page(true));
    for (const [name, content] of [
      ["specsPath", "/repos/specs/aide"],
      ["worktreeLinks", "node_modules"],
      ["installCmd", "bun install"],
      ["previewCmd", "bun run dev"],
      ["testCmd", "make test"],
    ]) {
      expect(html).toContain(`<td data-col="setting-value"><textarea name="${name}" data-oneline rows="1" maxlength="300"`);
      expect(html).toMatch(new RegExp(`name="${name}"[^>]*>${content.replace("/", "\\/")}</textarea>`));
    }
    expect(html).toContain('<td data-col="setting-value"><select name="codeLanding">');
    expect(html).not.toContain('<input type="text" name="specsPath"');
    expect(html).not.toContain('<input type="text"');
  });

  test("Worktree links suggestions are text under the field, never a datalist (AC-2)", () => {
    const html = page(true, ["node_modules", ".venv"]);
    expect(html).toContain("Suggested from the checkout's .gitignore: node_modules .venv");
    expect(html).not.toContain("<datalist");
    expect(html).not.toContain(' list="');
    expect(page(true, [])).not.toContain("Suggested from");
  });

  test("a worked-out test command is a placeholder, never the field's content (AC-1)", () => {
    const rows = [row("AIDE_TEST_CMD", "pnpm test", "derived")];
    const html = renderProjectPage(project(), { hasConfigFile: true, rows }, null, "x", NAV, {
      worktreeLinkCandidates: [],
      editing: true,
    });
    expect(html).toContain('<textarea name="testCmd" data-oneline rows="1" maxlength="300" placeholder="pnpm test"></textarea>');
  });
});

describe("the settings table in reading mode", () => {
  test("holds no control, and each value is text (AC-5)", () => {
    const html = table(page(false));
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<select");
    expect(html).toContain("/repos/specs/aide");
    expect(html).toContain("Merge into");
  });
});
