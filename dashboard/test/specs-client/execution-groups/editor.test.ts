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

test("members keep the order they are selected, including after removing and adding again", () => {
  const window = new Window();
  window.document.write(`<form data-execution-group-editor><select name="project"><option value="aide">aide</option></select>
    <p data-group-project="aide"><input name="member" type="checkbox" value="1-first"><input name="position" type="hidden"></p>
    <p data-group-project="aide"><input name="member" type="checkbox" value="2-second"><input name="position" type="hidden"></p></form>`);
  const form = window.document.querySelector("form") as unknown as HTMLFormElement;
  const members = [...form.querySelectorAll<HTMLInputElement>('input[name="member"]')];
  const positions = () => [...form.querySelectorAll<HTMLInputElement>('input[name="position"]')].map((input) => input.value);
  members[1]!.checked = true;
  updateExecutionGroupEditor(form);
  members[0]!.checked = true;
  updateExecutionGroupEditor(form);
  expect(positions()).toEqual(["2", "1"]);
  members[1]!.checked = false;
  updateExecutionGroupEditor(form);
  members[1]!.checked = true;
  updateExecutionGroupEditor(form);
  expect(positions()).toEqual(["1", "2"]);
});

test("removing an unlocked member before a locked member closes the position gap (AC-4, AC-5)", () => {
  const window = new Window();
  window.document.write(`<form data-execution-group-editor><select name="project"><option value="aide">aide</option></select>
    <p data-group-project="aide"><input name="member" type="checkbox" value="1-first"><input name="position" value="1"></p>
    <p data-group-project="aide" data-group-locked><input type="checkbox" checked disabled><input name="member" type="hidden" value="2-locked"><input name="position" value="2" readonly></p>
    <p data-group-project="aide"><input name="member" type="checkbox" value="3-third" checked><input name="position" value="3"></p></form>`);
  const form = window.document.querySelector("form") as unknown as HTMLFormElement;
  updateExecutionGroupEditor(form);
  expect([...form.querySelectorAll<HTMLInputElement>('input[name="position"]')].map((input) => input.value)).toEqual(["", "1", "2"]);
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

test("a project with fewer than two specs to group says so and cannot be saved; one with two can", () => {
  const window = new Window();
  window.document.body.innerHTML = executionGroupEditor({
    projects: ["aide", "atlas"],
    candidates: [
      { project: "aide", specFolder: "1-first" },
      { project: "atlas", specFolder: "2-second" },
      { project: "atlas", specFolder: "3-third" },
    ],
  });
  const form = window.document.querySelector("form[data-execution-group-editor]") as unknown as HTMLFormElement;
  const project = form.querySelector('select[name="project"]') as unknown as HTMLSelectElement;
  const save = form.querySelector('button[id$="-save"]') as unknown as HTMLButtonElement;
  const none = form.querySelector("[data-group-none]") as unknown as HTMLElement;

  updateExecutionGroupEditor(form);
  expect([save.disabled, none.hidden]).toEqual([true, false]);

  project.value = "atlas";
  updateExecutionGroupEditor(form);
  expect([save.disabled, none.hidden]).toEqual([false, true]);
});

test("Run members keep checkbox click order and reset it (A810 AC-4)", () => {
  const window = new Window();
  window.document.body.innerHTML = `<dialog><form data-run-group><p><input name="member" value="2-second" type="checkbox"><input name="position" type="hidden" disabled></p><p><input name="member" value="3-third" type="checkbox"><input name="position" type="hidden" disabled></p></form></dialog>`;
  const form = window.document.querySelector("form") as unknown as HTMLFormElement;
  const members = [...form.querySelectorAll<HTMLInputElement>('input[name="member"]')];
  members[1]!.checked = true;
  changeExecutionGroupEditor({ target: members[1] } as unknown as Event);
  members[0]!.checked = true;
  changeExecutionGroupEditor({ target: members[0] } as unknown as Event);
  expect([...form.querySelectorAll<HTMLInputElement>('input[name="position"]')].map((input) => [input.value, input.disabled])).toEqual([["2", false], ["1", false]]);
  expect(closeExecutionGroupEditor({ target: form.closest("dialog") } as unknown as Event)).toBe(true);
  expect(members.map((member) => member.checked)).toEqual([false, false]);
});

test("Run requires and submits a group name only while peers are selected, and clears it on close", () => {
  const window = new Window();
  window.document.body.innerHTML = `<dialog><form data-run-group><label data-run-group-name hidden><input name="groupName" required disabled></label><label><input name="member" type="checkbox" value="2-next"><input name="position" type="hidden" disabled></label></form></dialog>`;
  const form = window.document.querySelector("form") as unknown as HTMLFormElement;
  const name = form.querySelector<HTMLInputElement>('input[name="groupName"]')!;
  const member = form.querySelector<HTMLInputElement>('input[name="member"]')!;
  member.checked = true;
  changeExecutionGroupEditor({ target: member } as unknown as Event);
  expect(name.disabled).toBe(false);
  expect(form.checkValidity()).toBe(false);
  name.value = "Release";
  expect(form.checkValidity()).toBe(true);
  member.checked = false;
  changeExecutionGroupEditor({ target: member } as unknown as Event);
  expect(name.disabled).toBe(true);
  expect(form.checkValidity()).toBe(true);
  member.checked = true;
  changeExecutionGroupEditor({ target: member } as unknown as Event);
  expect(name.value).toBe("Release");
  closeExecutionGroupEditor({ target: form.closest("dialog") } as unknown as Event);
  expect(name.value).toBe("");
  expect(name.disabled).toBe(true);
});
