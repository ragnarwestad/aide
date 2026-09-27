// Spec 512: the project's page says where its settings are kept, in one
// of four states — since spec 549, in the manifest table's own heading,
// not a sentence above a single table.

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
    tab: "config",
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

  test("the manifest table is headed settings.yaml when the dashboard keeps them (AC-6)", () => {
    const html = page("dashboard");
    expect(html).toContain("<h3>the dashboard's settings.yaml</h3>");
    expect(html).toContain("<h3>.aide/config</h3>");
  });

  test("the manifest table is headed .aide/project.yaml when it is tracked (AC-6)", () => {
    const html = page("project");
    expect(html).toContain("<h3>.aide/project.yaml</h3>");
    expect(html).toContain("<h3>.aide/config</h3>");
    expect(html).not.toContain("settings.yaml");
  });

  test("the manifest table is headed .aide/project.yaml even when the dashboard's copy is shadowed (AC-6)", () => {
    expect(page("shadowed")).toContain("<h3>.aide/project.yaml</h3>");
  });

  test("the manifest table is headed .aide/project.yaml when neither file exists yet (AC-6)", () => {
    expect(page("none")).toContain("<h3>.aide/project.yaml</h3>");
  });
});
