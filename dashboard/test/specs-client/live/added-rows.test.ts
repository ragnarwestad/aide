import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { addedRowKeys, NOTICED_MS, scrollBlock, showAddedRow } from "../../../src/specs-client/row-swap/added-rows.ts";

const split = (...keys: string[]) => ({ prefix: "", suffix: "", groups: keys.map((key) => ({ key, html: "" })) });

test("a redraw's new rows are the keys the list did not have, top first; a moved or changed row is not one", () => {
  expect(addedRowKeys(split("spec-a", "spec-b"), split("spec-c", "spec-b", "spec-e", "spec-a"))).toEqual(["spec-c", "spec-e"]);
  expect(addedRowKeys(split("spec-a", "spec-b"), split("spec-b", "spec-a"))).toEqual([]);
  expect(addedRowKeys(null, split("spec-a"))).toEqual([]);
});

test("older jobs the list takes in at its foot when rows are removed are not new", () => {
  expect(addedRowKeys(split("spec-a", "spec-b", "spec-c", "spec-d"), split("spec-a", "spec-d", "spec-old1", "spec-old2"))).toEqual([]);
  expect(addedRowKeys(split("spec-a", "spec-b"), split("spec-new", "spec-a", "spec-old"))).toEqual(["spec-new"]);
});

/** A list whose rows stand at the given tops, 40px tall, in a window 600px high. */
const page = (list: string, tops: Record<string, number> = { "spec-a": 10, "spec-new": 900 }) => {
  const window = new Window({ height: 600 });
  const rows = Object.keys(tops).map((id) => `<tr id="${id}"></tr><tr class="specstate"></tr><tr class="specgap"></tr>`).join("");
  window.document.body.innerHTML = `<div id="jobrows"><table class="speclist" data-list="${list}"><tbody>${rows}</tbody></table></div>`;
  const scrolled: string[] = [];
  const blocks: string[] = [];
  for (const row of window.document.querySelectorAll("tr[id]")) {
    const r = row as unknown as { scrollIntoView: (o?: { block?: string }) => void; getBoundingClientRect: () => { top: number; bottom: number } };
    r.scrollIntoView = (o) => { scrolled.push(row.id); blocks.push(o?.block ?? ""); };
    r.getBoundingClientRect = () => ({ top: tops[row.id]!, bottom: tops[row.id]! + 40 });
  }
  const body = window.document.getElementById("jobrows") as unknown as Element;
  const marked = () => [...window.document.querySelectorAll("tr.noticed")].map((r) => r.id || r.className.replace(" noticed", ""));
  return { window, body, scrolled, blocks, marked };
};

test("a new row is brought to the middle of what is in sight, or its top to the top when it is taller than half", () => {
  const view = { top: 0, bottom: 600 };
  expect(scrollBlock({ top: 900, bottom: 940 }, view)).toBe("center");
  expect(scrollBlock({ top: 900, bottom: 1200 }, view)).toBe("center");
  expect(scrollBlock({ top: 900, bottom: 1201 }, view)).toBe("start");
});

test("the Jobs list scrolls to the topmost new row, to the middle, and the Specs list does not move", () => {
  const jobs = page("jobs");
  // Long before the other tests' clocks, so its marks are over by then.
  showAddedRow(jobs.body, ["spec-new", "spec-a"], -1_000_000);
  expect(jobs.scrolled).toEqual(["spec-new"]);
  expect(jobs.blocks).toEqual(["center"]);
  const specs = page("specs");
  showAddedRow(specs.body, ["spec-new"], -1_000_000);
  expect(specs.scrolled).toEqual([]);
});

test("every new row is marked with the lines under it; one already in sight is marked where it stands", () => {
  const away = page("jobs");
  showAddedRow(away.body, ["spec-new"], 1000);
  expect(away.marked()).toEqual(["spec-new", "specstate"]);
  const near = page("jobs", { "spec-a": 10, "spec-near": 100 });
  showAddedRow(near.body, ["spec-near", "spec-a"], 1000);
  expect(near.scrolled).toEqual([]);
  expect(near.marked()).toEqual(["spec-a", "specstate", "spec-near", "specstate"]);
});

test("a redraw puts the mark back on a row drawn afresh until its time is up", () => {
  const first = page("jobs", { "spec-x": 900 });
  showAddedRow(first.body, ["spec-x"], 10_000);
  const again = page("jobs", { "spec-x": 10 });
  showAddedRow(again.body, [], 10_000 + NOTICED_MS - 1);
  expect(again.marked()).toEqual(["spec-x", "specstate"]);
  const later = page("jobs", { "spec-x": 10 });
  showAddedRow(later.body, [], 10_000 + NOTICED_MS);
  expect(later.marked()).toEqual([]);
});
