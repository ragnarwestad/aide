import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { syncSpecGroups, toggleSpecGroup } from "../../../src/specs-client/spec-groups";

const windows: Window[] = [];
afterEach(async () => { await Promise.all(windows.splice(0).map((win) => win.happyDOM.close())); });

test("a group opens and closes its members and keeps its choice across updates", () => {
  const win = new Window();
  windows.push(win);
  const doc = win.document as unknown as Document;
  const rows = () => '<table><tbody><tr data-spec-group="fold-test"><td>' +
    '<button data-group-toggle="fold-test" aria-expanded="false">Release</button></td></tr>' +
    '<tr data-spec-group-member="fold-test"><td>First</td></tr><tr><td>State</td></tr>' +
    '<tr class="spechead"><td>Unrelated</td></tr></tbody></table>';
  doc.body.innerHTML = rows();
  syncSpecGroups(doc);
  const member = () => doc.querySelector("[data-spec-group-member]") as HTMLElement;
  expect(member().hidden).toBe(true);
  toggleSpecGroup({ target: doc.querySelector("button"), preventDefault() {} } as unknown as MouseEvent);
  expect(member().hidden).toBe(false);
  doc.body.innerHTML = rows();
  syncSpecGroups(doc);
  expect(member().hidden).toBe(false);
  toggleSpecGroup({ target: doc.querySelector("button"), preventDefault() {} } as unknown as MouseEvent);
  expect(member().hidden).toBe(true);
  expect((doc.querySelector(".spechead") as HTMLElement).hidden).toBe(false);
});

test("opening a spec's address also opens its group", () => {
  const win = new Window();
  windows.push(win);
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = '<table><tbody><tr data-spec-group="open-address"><td>' +
    '<button data-group-toggle="open-address" aria-expanded="false">Release</button></td></tr>' +
    '<tr class="spechead" data-spec-group-member="open-address"><td>First</td></tr>' +
    '<tr data-spec-detail="p/first"><td>Spec</td></tr></tbody></table>';
  syncSpecGroups(doc);
  expect(doc.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  expect((doc.querySelector("[data-spec-detail]") as HTMLElement).hidden).toBe(false);
});
