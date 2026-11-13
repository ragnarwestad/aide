import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { addToGroupDialog, executionGroupEditor, NEW_GROUP_DIALOG } from "../../../../src/render/pages/jobs-page/execution-group-editor.ts";

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

test("the Add spec form posts one chosen member to the group's route (AC-2)", () => {
  const html = addToGroupDialog({ id: "add-spec-group-1", group: { id: "group 1", name: "Release" }, candidates });
  const win = new Window();
  win.document.body.innerHTML = html;
  const form = win.document.querySelector("form[data-group-add]")!;
  expect(form.getAttribute("action")).toBe("/api/queue/groups/group%201/members");
  expect([...form.querySelectorAll('input[type="radio"][name="member"]')].map((radio) => radio.getAttribute("value"))).toEqual(["765-long", "766-next"]);
  expect(form.querySelector("button[disabled]")).toBeNull();
});

test("the Add spec form with no spec to offer cannot be sent (AC-2)", () => {
  const win = new Window();
  win.document.body.innerHTML = addToGroupDialog({ id: "add-spec-group-1", group: { id: "group-1", name: "Release" }, candidates: [] });
  const form = win.document.querySelector("form[data-group-add]")!;
  expect(form.querySelectorAll('input[name="member"]')).toHaveLength(0);
  expect(form.querySelector("#add-spec-group-1-form-save")?.hasAttribute("disabled")).toBe(true);
});
