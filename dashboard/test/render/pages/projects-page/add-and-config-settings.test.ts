// The Add project form and the Config tab's two tables post the same
// settings: a setting offered on one and not the other is the gap this holds
// shut. Only the `name` attributes are read, which are what the routes read.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { projectSettings, SETTING_GROUPS } from "../../../../src/project/project-settings.ts";
import { renderAddProjectPage } from "../../../../src/render";
import { unifiedSettingsTable } from "../../../../src/render/pages/projects-page/settings-table.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const namesIn = (html: string, scope: string): Set<string> => {
  const window = new Window();
  window.document.body.innerHTML = html;
  const form = window.document.querySelector(scope)!;
  return new Set([...form.querySelectorAll("[name]")].map((el) => el.getAttribute("name")!));
};

describe("Add project and the Config tab post the same settings (AC-2, AC-3)", () => {
  test("the Add form's fields, less name and gitUrl, are the fields the two tables post in edit mode (AC-2, AC-3)", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-add-and-config-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".aide"));
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: p\n");

    const add = namesIn(
      renderAddProjectPage([{ label: "Projects", path: "/projects" }], "2026-10-09T00:00:00Z", {}),
      "form.addprojectform",
    );
    add.delete("name");
    add.delete("gitUrl");

    const config = new Set<string>();
    const view = projectSettings(dir, null);
    for (const { file } of SETTING_GROUPS) {
      const html = unifiedSettingsTable(view, "p", file, { worktreeLinkCandidates: [], editingGroup: file });
      for (const name of namesIn(html, "form.projectsettingsform")) config.add(name);
    }

    expect([...add].sort()).toEqual([...config].sort());
    expect([...add].sort()).toEqual([
      "codeLanding", "description", "installCmd", "previewCmd", "previewFrom", "specsPath", "testCmd", "worktreeLinks",
    ]);
  });
});
