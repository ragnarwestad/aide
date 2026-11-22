// The Add project form and the Config tab's two cards post the same
// settings, each card its own form posting only its own file's settings.
// Only the `name` attributes and the forms are read, which are what the
// routes and the page script read.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { projectSettings } from "../../../../src/project/project-settings.ts";
import { renderAddProjectPage } from "../../../../src/render";
import { unifiedSettingsTable } from "../../../../src/render/pages/projects-page/settings-table.ts";
import { t } from "../../../../src/i18n";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "aide-add-and-config-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".aide"));
  writeFileSync(join(dir, ".aide", "project.yaml"), "name: p\nicon: assets/logo.png\n");
  return dir;
};

const configTab = (dir: string) => {
  const window = new Window();
  window.document.body.innerHTML = unifiedSettingsTable(projectSettings(dir, null), "p", { worktreeLinkCandidates: [] });
  return window.document;
};

const namesIn = (form: { querySelectorAll(sel: string): Iterable<{ getAttribute(n: string): string | null }> }): string[] =>
  [...form.querySelectorAll("[name]")].map((el) => el.getAttribute("name")!).sort();

describe("Add project and the Config tab post the same settings", () => {
  test("the Add form's fields, less name and gitUrl, are the fields the two cards post (AC-19)", () => {
    const dir = project();
    const window = new Window();
    window.document.body.innerHTML = renderAddProjectPage([{ label: "Projects", path: "/projects" }], "2026-10-09T00:00:00Z", {});
    const add = namesIn(window.document.querySelector("form.addprojectform")!).filter((n) => n !== "name" && n !== "gitUrl");
    const config = [...configTab(dir).querySelectorAll("form.projectsettingsform")].flatMap((f) => namesIn(f)).sort();
    expect(add).toEqual(config);
    expect(add).toEqual([
      "acPrefix", "codeLanding", "description", "icon", "installCmd", "previewCmd", "previewFrom", "specsPath", "testCmd", "worktreeLinks", "worktreeSetup",
    ]);
  });
});

describe("the Config tab's cards", () => {
  test("one form per settings file, each posting only its own file's settings (AC-4, AC-6)", () => {
    const forms = [...configTab(project()).querySelectorAll("form.projectsettingsform")];
    expect(forms.map((f) => f.getAttribute("action"))).toEqual(["/api/queue/projects/p/settings", "/api/queue/projects/p/settings"]);
    expect(forms.map((f) => namesIn(f))).toEqual([
      ["installCmd", "specsPath"],
      ["acPrefix", "codeLanding", "description", "icon", "previewCmd", "previewFrom", "testCmd", "worktreeLinks", "worktreeSetup"],
    ]);
  });

  test("each setting's row carries its name, its key and its explanation (AC-4)", () => {
    const doc = configTab(project());
    const text = doc.querySelector("form.projectsettingsform")!.textContent!;
    for (const key of ["AIDE_SPECS_PATH", "AIDE_INSTALL_CMD"] as const) {
      expect(text).toContain(t("en", `setting.label.${key}`));
      expect(text).toContain(key);
      expect(text).toContain(t("en", `setting.purpose.${key}`));
    }
  });

  test("offers no Edit and no disabled field: every field is editable as the tab opens, icon's holding its value (AC-5, AC-19)", () => {
    const doc = configTab(project());
    expect(doc.querySelectorAll('a[href*="edit="]').length).toBe(0);
    expect(doc.querySelectorAll("[name][disabled], [name][readonly]").length).toBe(0);
    expect((doc.querySelector('[name="icon"]') as unknown as HTMLTextAreaElement).value).toBe("assets/logo.png");
  });

  test("each card has its own Save, named for the page script that waits on a change, and a Cancel that puts its fields back", () => {
    const forms = [...configTab(project()).querySelectorAll("form.projectsettingsform")];
    for (const form of forms) {
      const id = form.getAttribute("data-actions-id")!;
      expect(form.querySelector(`#${id}-save`)?.getAttribute("type")).toBe("submit");
      expect(form.querySelector(`#${id}-cancel`)?.getAttribute("type")).toBe("reset");
    }
    expect(new Set(forms.map((f) => f.getAttribute("data-actions-id"))).size).toBe(2);
  });
});
