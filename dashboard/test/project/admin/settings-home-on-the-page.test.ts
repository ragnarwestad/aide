// Spec 512: the project's page says where its settings are kept, in one
// of four states, and the settings-table row says which file a value came
// from.

import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../src/render";
import type { ProjectView } from "../../../src/render";
import { settingsHome } from "../../../src/project/project-admin";

const NAV = [{ label: "Projects", path: "/projects" }];
const view: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
const page = (home: "project" | "dashboard" | "shadowed" | "none") =>
  renderProjectPage(view, { hasConfigFile: false, rows: [] }, null, "2026-09-20T00:00:00Z", NAV, {
    worktreeLinkCandidates: [],
    editing: false,
    settingsHome: home,
  });

describe("where the settings are kept", () => {
  test.each([
    [false, true, "dashboard"],
    [true, false, "project"],
    [true, true, "shadowed"],
    [false, false, "none"],
    [null, false, "none"],
  ] as const)("tracked=%p, settings file=%p is %p (AC-6)", (tracked, exists, expected) => {
    expect(settingsHome(tracked, exists)).toBe(expected);
  });

  test("the page names settings.yaml when the dashboard keeps them (AC-6)", () => {
    const html = page("dashboard");
    expect(html).toContain('data-settings-home="dashboard"');
    expect(html).toContain("kept in the dashboard");
    expect(html).toContain("settings.yaml");
  });

  test("the page names the project's own manifest when it is tracked (AC-6)", () => {
    const html = page("project");
    expect(html).toContain("kept in the project's own");
    expect(html).not.toContain("settings.yaml");
  });

  test("the page says the dashboard's copy is not used when both exist (AC-6)", () => {
    expect(page("shadowed")).toContain("is not used");
  });

  test("the page says nothing is stored yet when neither exists (AC-6)", () => {
    expect(page("none")).toContain("No settings are stored yet.");
  });

  // Spec 531 (AC-7): in edit mode the sentence stays above the table,
  // full width, instead of squeezed beside it as a flex sibling.
  test("in edit mode, the sentence sits before the table, each in its own .frow (AC-7)", () => {
    const html = renderProjectPage(view, { hasConfigFile: false, rows: [] }, null, "2026-09-20T00:00:00Z", NAV, {
      worktreeLinkCandidates: [],
      editing: true,
      settingsHome: "dashboard",
    });
    const homeIndex = html.indexOf("data-settings-home");
    const tableIndex = html.indexOf('class="tablewrap"');
    expect(homeIndex).toBeGreaterThan(-1);
    expect(tableIndex).toBeGreaterThan(-1);
    expect(homeIndex).toBeLessThan(tableIndex);
    const tableFrowStart = html.lastIndexOf('<span class="frow">', tableIndex);
    expect(tableFrowStart).toBeGreaterThan(-1);
    // The table's own frow holds only the table — the sentence sits
    // outside it, in a frow of its own.
    expect(html.slice(tableFrowStart, tableIndex)).not.toContain("data-settings-home");
  });
});
