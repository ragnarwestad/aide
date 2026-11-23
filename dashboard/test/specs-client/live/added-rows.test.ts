import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { addedRowKeys, showAddedRow } from "../../../src/specs-client/row-swap/added-rows.ts";

const split = (...keys: string[]) => ({ prefix: "", suffix: "", groups: keys.map((key) => ({ key, html: "" })) });

test("a redraw's new rows are the keys the list did not have, top first; a moved or changed row is not one", () => {
  expect(addedRowKeys(split("spec-a", "spec-b"), split("spec-c", "spec-b", "spec-a", "spec-d"))).toEqual(["spec-c", "spec-d"]);
  expect(addedRowKeys(split("spec-a", "spec-b"), split("spec-b", "spec-a"))).toEqual([]);
  expect(addedRowKeys(null, split("spec-a"))).toEqual([]);
});

const page = (list: string) => {
  const window = new Window();
  window.document.body.innerHTML = `<div id="jobrows"><table class="speclist" data-list="${list}"><tbody>` +
    `<tr id="spec-a"></tr><tr id="spec-new"></tr></tbody></table></div>`;
  const scrolled: string[] = [];
  for (const row of window.document.querySelectorAll("tr")) (row as unknown as { scrollIntoView: () => void }).scrollIntoView = () => void scrolled.push(row.id);
  return { body: window.document.getElementById("jobrows") as unknown as Element, scrolled };
};

test("the Jobs list scrolls to the topmost new row, and the Specs list does not move", () => {
  const jobs = page("jobs");
  showAddedRow(jobs.body, ["spec-new", "spec-a"]);
  expect(jobs.scrolled).toEqual(["spec-new"]);
  const specs = page("specs");
  showAddedRow(specs.body, ["spec-new"]);
  expect(specs.scrolled).toEqual([]);
});
