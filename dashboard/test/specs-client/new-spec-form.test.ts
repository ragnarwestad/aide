// Create's handlers are bound to whatever `NEW_SPEC_FORM` finds, so it must
// find the New-spec form and no other: every page-sized form drawn by the
// board, as its renderer draws it, is asked.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderAddProjectPage, renderNewSpecPage, renderProjectPage, type ProjectView } from "../../src/render";
import { descriptionPanel } from "../../src/render/pages/spec-page/panels.ts";
import { NEW_SPEC_FORM } from "../../src/specs-client/state.ts";
import { NOW, view } from "../render/pages/spec-page-fixtures.ts";

const NAV = [{ label: "Projects", path: "/projects" }];
const GENERATED = "2026-09-20T00:00:00Z";
const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };

/** The action of every form on the page `NEW_SPEC_FORM` matches. */
async function matched(html: string): Promise<string[]> {
  const win = new Window();
  win.document.write(html);
  const actions = [...win.document.querySelectorAll(NEW_SPEC_FORM)].map((f) => f.getAttribute("action") ?? "");
  await win.happyDOM.close();
  return actions;
}

describe("which forms the New-spec handler binds", () => {
  test("the New-spec form matches (AC-5)", async () => {
    expect(await matched(renderNewSpecPage(NAV, GENERATED, { createProjects: ["aide"] }))).toEqual([
      "/api/queue/create",
    ]);
  });

  test("the Add project form does not (AC-5)", async () => {
    expect(await matched(renderAddProjectPage(NAV, GENERATED, {}))).toEqual([]);
  });

  test("the project settings form, open for editing, does not (AC-5)", async () => {
    const html = renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, GENERATED, NAV, {
      worktreeLinkCandidates: [],
      editingGroup: "manifest",
      tab: "config",
      removable: true,
    });
    expect(html).toContain("/settings");
    expect(await matched(html)).toEqual([]);
  });

  test("a spec's Description tab form does not (AC-5)", async () => {
    const html = descriptionPanel(view(), NOW);
    expect(html).toContain("/save");
    expect(await matched(html)).toEqual([]);
  });
});
