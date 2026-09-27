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
    tab: "config",
    codeLanding: "merge",
  });

/** Both settings tables (spec 549 split the Config tab into one per
 *  file): the page around them has its own selects. */
const table = (html: string) => {
  const from = html.indexOf('<col data-col="setting-name"');
  const to = html.lastIndexOf("</table>") + "</table>".length;
  return html.slice(from, to);
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

// Spec 549: one table per file, and no row or sentence names a file
// any more.
describe("the Config tab is split into one table per file (spec 549)", () => {
  test("exactly two tables, headed .aide/config and the manifest's file (AC-1)", () => {
    const html = page(false);
    expect((html.match(/<table class="list">/g) ?? []).length).toBe(2);
    expect(html).toContain("<h3>.aide/config</h3>");
    expect(html).toContain("<h3>.aide/project.yaml</h3>");
  });

  test("Specs path and Install command are in the .aide/config table; the rest and Code landing in the manifest's (AC-1)", () => {
    const html = page(false);
    const configTable = html.slice(html.indexOf("<h3>.aide/config</h3>"), html.indexOf("<h3>.aide/project.yaml</h3>"));
    const manifestTable = html.slice(html.indexOf("<h3>.aide/project.yaml</h3>"));
    for (const text of ["/repos/specs/aide", "bun install"]) expect(configTable).toContain(text);
    for (const text of ["node_modules", "bun run dev", "make test", "Code landing"]) {
      expect(manifestTable).toContain(text);
      expect(configTable).not.toContain(text);
    }
  });

  test("no row's Comment names a file, and no sentence sits above the tables (AC-2)", () => {
    const html = page(false);
    expect(html).not.toMatch(/from \.aide\/config/);
    expect(html).not.toMatch(/from \.aide\/project\.yaml/);
    expect(html).not.toMatch(/from the dashboard's settings\.yaml/);
    expect(html).not.toContain('data-settings-home=');
  });
});
