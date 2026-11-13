import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { syncSpecGroups, toggleSpecGroup } from "../../../src/specs-client/spec-groups";

const windows: Window[] = [];
afterEach(async () => { await Promise.all(windows.splice(0).map((win) => win.happyDOM.close())); });

/** A group's card as the list draws it: one row, its own table inside, with
 *  state and action holders in its fixed second line and foldable members. */
const card = (key: string, members: string, action = true, openFor?: string) =>
  `<tr data-spec-group="${key}"${openFor ? ` data-group-open="${openFor}"` : ""}><td><table><tbody><tr><td>` +
  `<button data-group-toggle="${key}" aria-expanded="false">Release</button></td></tr>` +
  `<tr><td><span data-group-state>Prepared</span>` +
  (action ? `<span data-group-action hidden>Start</span>` : "") +
  `</td></tr></tbody>` +
  `<tbody data-group-members data-group-body hidden>${members}</tbody></table></td></tr>`;

test("a group opens and closes its second line and members and keeps its choice across updates", () => {
  const win = new Window();
  windows.push(win);
  const doc = win.document as unknown as Document;
  const rows = () => `<table><tbody>${card("fold-test", '<tr class="spechead"><td>First</td></tr>')}` +
    '<tr class="spechead" id="other"><td>Unrelated</td></tr></tbody></table>';
  const parts = () => Array.from(doc.querySelectorAll<HTMLElement>("[data-group-body]")).map((el) => el.hidden);
  const press = () => toggleSpecGroup({ target: doc.querySelector("button"), preventDefault() {} } as unknown as MouseEvent);
  doc.body.innerHTML = rows();
  syncSpecGroups(doc);
  expect(parts()).toEqual([true]);
  press();
  expect(parts()).toEqual([false]);
  doc.body.innerHTML = rows();
  syncSpecGroups(doc);
  expect(parts()).toEqual([false]);
  press();
  expect(parts()).toEqual([true]);
  expect((doc.getElementById("other") as HTMLElement).hidden).toBe(false);
});

test("an action replaces the state only while its group is open (AC-1, AC-3)", () => {
  const win = new Window();
  windows.push(win);
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = `<table><tbody>${card("with-action", "")}</tbody></table>`;
  const state = doc.querySelector<HTMLElement>("[data-group-state]")!;
  const action = doc.querySelector<HTMLElement>("[data-group-action]")!;
  const press = () => toggleSpecGroup({ target: doc.querySelector("button"), preventDefault() {} } as unknown as MouseEvent);

  syncSpecGroups(doc);
  expect([state.hidden, action.hidden]).toEqual([false, true]);
  press();
  expect([state.hidden, action.hidden]).toEqual([true, false]);
  press();
  expect([state.hidden, action.hidden]).toEqual([false, true]);
});

test("an open group without an action keeps its state visible (AC-2)", () => {
  const win = new Window();
  windows.push(win);
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = `<table><tbody>${card("without-action", "", false)}</tbody></table>`;

  syncSpecGroups(doc);
  toggleSpecGroup({ target: doc.querySelector("button"), preventDefault() {} } as unknown as MouseEvent);
  expect((doc.querySelector("[data-group-state]") as HTMLElement).hidden).toBe(false);
});

test("opening a spec's address also opens its group", () => {
  const win = new Window();
  windows.push(win);
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = `<table><tbody>${card("open-address",
    '<tr class="spechead"><td>First</td></tr><tr data-spec-detail="p/first"><td>Spec</td></tr>')}</tbody></table>`;
  syncSpecGroups(doc);
  expect(doc.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  expect((doc.querySelector("[data-group-members]") as HTMLElement).hidden).toBe(false);
});

test("a card marked for a chosen state opens; a reader's choice holds under that state and goes when it changes (AC-4)", () => {
  const win = new Window();
  windows.push(win);
  const doc = win.document as unknown as Document;
  const draw = (openFor?: string) => {
    doc.body.innerHTML = `<table><tbody>${card("state-chosen", '<tr class="spechead"><td>First</td></tr>', true, openFor)}</tbody></table>`;
    syncSpecGroups(doc);
  };
  const shut = () => (doc.querySelector("[data-group-body]") as HTMLElement).hidden;
  const press = () => toggleSpecGroup({ target: doc.querySelector("button"), preventDefault() {} } as unknown as MouseEvent);

  draw("waiting");
  expect(shut()).toBe(false);
  press();
  expect(shut()).toBe(true);
  draw("waiting");
  expect(shut()).toBe(true);
  draw("failed");
  expect(shut()).toBe(false);
  draw();
  expect(shut()).toBe(true);
  press();
  draw();
  expect(shut()).toBe(false);
  draw("waiting");
  draw();
  expect(shut()).toBe(true);
});
