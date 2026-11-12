import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { executionGroupEditor, NEW_GROUP_DIALOG } from "../../../src/render/pages/jobs-page/execution-group-editor.ts";
import { changeExecutionGroupEditor, closeExecutionGroupEditor, updateExecutionGroupEditor } from "../../../src/specs-client/execution-groups/editor.ts";

test("filters by project and assigns consecutive saved order (AC-2, AC-4, AC-6)", () => {
  const window = new Window();
  window.document.write(`<form data-execution-group-editor><select name="project"><option value="aide" selected>aide</option></select>
    <p data-group-project="aide"><input name="member" type="checkbox" checked><input name="position"></p>
    <p data-group-project="atlas"><input name="member" type="checkbox" checked><input name="position"></p>
    <p data-group-project="aide"><input name="member" type="checkbox" checked><input name="position"></p></form>`);
  const form = window.document.querySelector("form") as unknown as HTMLFormElement;
  updateExecutionGroupEditor(form);
  const lines = [...form.querySelectorAll<HTMLElement>("p")];
  expect(lines[1]?.hidden).toBe(true);
  expect([...form.querySelectorAll<HTMLInputElement>('input[name="position"]')].map((input) => [input.value, input.disabled])).toEqual([["1", false], ["", true], ["2", false]]);
});

test("changing the name does not replace the order the user entered (AC-1, AC-2)", () => {
  const window = new Window();
  window.document.write(`<form data-execution-group-editor><input name="name"><p data-group-project="aide"><input name="member" type="checkbox" checked><input name="position" value="2"></p><p data-group-project="aide"><input name="member" type="checkbox" checked><input name="position" value="1"></p></form>`);
  const name = window.document.querySelector('input[name="name"]') as unknown as HTMLInputElement;
  changeExecutionGroupEditor({ target: name } as unknown as Event);
  const positions = [...window.document.querySelectorAll('input[name="position"]')] as unknown as HTMLInputElement[];
  expect(positions.map((input) => input.value)).toEqual(["2", "1"]);
});

test("a closed New group dialog is empty: no name, no tick, no order and no reason (AC-3)", () => {
  const window = new Window();
  window.document.body.innerHTML = `<dialog id="other"></dialog>` + executionGroupEditor({
    projects: ["aide"],
    candidates: [{ project: "aide", specFolder: "1-first" }, { project: "aide", specFolder: "2-second" }],
  });
  const dialog = window.document.getElementById(NEW_GROUP_DIALOG) as unknown as HTMLDialogElement;
  const form = dialog.querySelector("form[data-execution-group-editor]") as unknown as HTMLFormElement;
  const name = form.querySelector('input[name="name"]') as unknown as HTMLInputElement;
  const members = [...form.querySelectorAll('input[name="member"]')] as unknown as HTMLInputElement[];
  const reason = form.querySelector(".refused span")!;
  name.value = "Release";
  for (const member of members) member.checked = true;
  updateExecutionGroupEditor(form);
  reason.textContent = "An execution group needs at least two specs";

  expect(closeExecutionGroupEditor({ target: window.document.getElementById("other") } as unknown as Event)).toBe(false);
  expect(name.value).toBe("Release");
  expect(closeExecutionGroupEditor({ target: dialog } as unknown as Event)).toBe(true);
  expect(name.value).toBe("");
  expect(members.map((member) => member.checked)).toEqual([false, false]);
  expect([...form.querySelectorAll<HTMLInputElement>('input[name="position"]')].map((input) => [input.value, input.disabled])).toEqual([["", true], ["", true]]);
  expect(reason.textContent).toBe("");
});
