// The settings table's editable fields: one-line textareas that wrap,
// in cells the width rule can reach.
import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render";
import type { ProjectView } from "../../../../src/render";
import type { SettingsGroupFile } from "../../../../src/project/project-settings.ts";

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

const page = (editingGroup: SettingsGroupFile | null, candidates: string[] = []) =>
  renderProjectPage(project(), { hasConfigFile: true, rows: ROWS }, null, "2026-08-31T00:00:00Z", NAV, {
    worktreeLinkCandidates: candidates,
    editingGroup,
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
  test("editing .aide/config: its two fields are textareas, the manifest's three stay plain text (AC-1, AC-3)", () => {
    const html = table(page(".aide/config"));
    for (const [name, content] of [
      ["specsPath", "/repos/specs/aide"],
      ["installCmd", "bun install"],
    ]) {
      expect(html).toContain(`<td data-col="setting-value"><textarea name="${name}" data-oneline rows="1" maxlength="300"`);
      expect(html).toMatch(new RegExp(`name="${name}"[^>]*>${content.replace("/", "\\/")}</textarea>`));
    }
    for (const [, content] of [["worktreeLinks", "node_modules"], ["previewCmd", "bun run dev"], ["testCmd", "make test"]]) {
      expect(html).toContain(content);
    }
    expect(html).not.toContain('name="worktreeLinks"');
    expect(html).not.toContain('name="previewCmd"');
    expect(html).not.toContain('name="testCmd"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain('<input type="text"');
  });

  test("editing the manifest: its three fields (and Code landing) are inputs, the .aide/config pair stays plain text (AC-1, AC-3)", () => {
    const html = table(page("manifest"));
    for (const [name, content] of [
      ["worktreeLinks", "node_modules"],
      ["previewCmd", "bun run dev"],
      ["testCmd", "make test"],
    ]) {
      expect(html).toContain(`<td data-col="setting-value"><textarea name="${name}" data-oneline rows="1" maxlength="300"`);
      expect(html).toMatch(new RegExp(`name="${name}"[^>]*>${content.replace("/", "\\/")}</textarea>`));
    }
    expect(html).toContain('<td data-col="setting-value"><select name="codeLanding">');
    for (const content of ["/repos/specs/aide", "bun install"]) expect(html).toContain(content);
    expect(html).not.toContain('name="specsPath"');
    expect(html).not.toContain('name="installCmd"');
    expect(html).not.toContain('<input type="text"');
  });

  test("Worktree links suggestions are text under the field, never a datalist (AC-2)", () => {
    const html = page("manifest", ["node_modules", ".venv"]);
    expect(html).toContain("Suggested from the checkout's .gitignore: node_modules .venv");
    expect(html).not.toContain("<datalist");
    expect(html).not.toContain(' list="');
    expect(page("manifest", [])).not.toContain("Suggested from");
  });

  test("a worked-out test command is a placeholder, never the field's content (AC-1)", () => {
    const rows = [row("AIDE_TEST_CMD", "pnpm test", "derived")];
    const html = renderProjectPage(project(), { hasConfigFile: true, rows }, null, "x", NAV, {
      worktreeLinkCandidates: [],
      editingGroup: "manifest",
    });
    expect(html).toContain('<textarea name="testCmd" data-oneline rows="1" maxlength="300" placeholder="pnpm test"></textarea>');
  });
});

describe("the settings table in reading mode", () => {
  test("holds no control, and each value is text (AC-5)", () => {
    const html = table(page(null));
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<select");
    expect(html).toContain("/repos/specs/aide");
    expect(html).toContain("Merge into");
  });
});

// AC-1, AC-4, AC-5: each table's own Edit, and the other one's while a
// table is being edited.
describe("each table's own Edit (AC-1, AC-4, AC-5)", () => {
  test("nothing being edited: both tables' own Edit is present and enabled", () => {
    const html = page(null);
    expect((html.match(/<a class="btn primary" href="[^"]*\?edit=(config|manifest)">Edit<\/a>/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/Edit[^<]*<\/button>/);
  });

  test("one table being edited: the OTHER table's Edit is present, but disabled", () => {
    const html = page(".aide/config");
    // The table being edited shows Save/Cancel, not a link to Edit.
    expect(html).not.toContain('href="/projects/aide?edit=config">Edit</a>');
    expect(html).not.toContain('href="/projects/aide?edit=manifest">Edit</a>');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Edit<\/button>/);
  });

  test("Cancel or a successful Save returns both tables to read view with both Edit enabled (AC-5)", () => {
    const html = page(null);
    expect((html.match(/<button[^>]*disabled[^>]*>Edit<\/button>/g) ?? []).length).toBe(0);
  });
});

// Spec 549: one table per file, and no row or sentence names a file
// any more.
describe("the Config tab is split into one table per file (spec 549)", () => {
  test("exactly two tables, headed .aide/config and the manifest's file (AC-1)", () => {
    const html = page(null);
    expect((html.match(/<table class="list">/g) ?? []).length).toBe(2);
    expect(html).toContain("<h3>.aide/config</h3>");
    expect(html).toContain("<h3>.aide/project.yaml</h3>");
  });

  test("Specs path and Install command are in the .aide/config table; the rest and Code landing in the manifest's (AC-1)", () => {
    const html = page(null);
    const configTable = html.slice(html.indexOf("<h3>.aide/config</h3>"), html.indexOf("<h3>.aide/project.yaml</h3>"));
    const manifestTable = html.slice(html.indexOf("<h3>.aide/project.yaml</h3>"));
    for (const text of ["/repos/specs/aide", "bun install"]) expect(configTable).toContain(text);
    for (const text of ["node_modules", "bun run dev", "make test", "Code landing"]) {
      expect(manifestTable).toContain(text);
      expect(configTable).not.toContain(text);
    }
  });

  test("no row's Comment names a file, and no sentence sits above the tables (AC-2)", () => {
    const html = page(null);
    expect(html).not.toMatch(/from \.aide\/config/);
    expect(html).not.toMatch(/from \.aide\/project\.yaml/);
    expect(html).not.toMatch(/from the dashboard's settings\.yaml/);
    expect(html).not.toContain('data-settings-home=');
  });
});
