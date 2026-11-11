import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { changeExecutionGroupEditor, updateExecutionGroupEditor } from "../../../src/specs-client/execution-groups/editor.ts";

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
