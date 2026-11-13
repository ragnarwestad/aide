import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { executionGroupEditor, NEW_GROUP_DIALOG } from "../../../../src/render/pages/jobs-page/execution-group-editor.ts";

const candidates = [
  { project: "aide", specFolder: "765-long", title: "Create and order groups" },
  { project: "aide", specFolder: "766-next", title: "Run a group" },
];

const formOf = (html: string): HTMLFormElement => {
  const win = new Window();
  win.document.body.innerHTML = html;
  return win.document.querySelector("form[data-execution-group-editor]") as unknown as HTMLFormElement;
};

test("the New group form posts a project, a name, and a member and a position for each eligible spec (AC-2)", () => {
  const html = executionGroupEditor({ projects: ["aide"], candidates });
  const form = formOf(html);
  expect(form.getAttribute("action")).toBe("/api/queue/groups");
  expect(form.querySelector('select[name="project"] option')?.getAttribute("value")).toBe("aide");
  expect(form.querySelector('input[name="name"]')).not.toBeNull();
  expect([...form.querySelectorAll('input[name="member"]')].map((box) => box.getAttribute("value"))).toEqual(["765-long", "766-next"]);
  expect(form.querySelectorAll('input[name="position"]')).toHaveLength(2);
  expect(html).toContain("Create and order groups");
});

test("the New group form stands in the form dialog its button names (AC-6)", () => {
  const form = formOf(executionGroupEditor({ projects: ["aide"], candidates: [] }));
  expect(form.closest("dialog.formdialog")?.id).toBe(NEW_GROUP_DIALOG);
});

test("Edit draws the saved group before New group candidates and locks fixed members (AC-3, AC-4, AC-6)", () => {
  const html = executionGroupEditor({ projects: ["aide"], candidates, group: { id: "group 1", anchor: "group-group-1", project: "aide", name: "Release", members: [{ specFolder: "1-first", title: "First", locked: true }, { specFolder: "2-second", title: "Second", locked: false }] } });
  const form = formOf(html);
  expect(form.getAttribute("action")).toBe("/api/queue/groups/group%201");
  expect((form.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("Release");
  expect([...form.querySelectorAll('input[name="member"]')].map((box) => box.getAttribute("value"))).toEqual(["1-first", "2-second", "765-long", "766-next"]);
  expect(form.querySelector('[data-group-locked] input[name="position"]')?.hasAttribute("readonly")).toBe(true);
  expect(form.closest("dialog")?.id).toBe("edit-group-group-group-1");
});
