import { expect, test } from "bun:test";
import { renderSpecsRows } from "../../../../src/render/pages/specs-list";
import { groupActionState } from "../../../../src/render/pages/specs-list/row-state.ts";
import type { SpecGroup } from "../../../../src/render/pages/specs-list/data-model";

test("an archived group waiting for its PR has no further run action", () => {
  const members = [1, 2, 3].map(() => ({
    state: "archived-unlanded", done: ["create", "analyze", "implement", "archive"],
    archive: { notLanded: true, prOpen: true },
  } as unknown as SpecGroup));
  expect(groupActionState(members)).toBeUndefined();
});

test("active groups keep Start until every member is ready for Archive", () => {
  const member = { state: "not-started", done: ["create"] } as SpecGroup;
  const implemented = { ...member, done: ["create", "analyze", "implement"] };
  expect(groupActionState([member, implemented])).toBe("start");
  expect(groupActionState([implemented, implemented])).toBe("archive");
  expect(groupActionState([implemented, { ...implemented, acceptanceOpen: true }])).toBe("start");
});

test("a group is one parent with children in persisted order and progress (A757 AC-4, A757 AC-5, A757 AC-6, A757 AC-10)", () => {
  const html = renderSpecsRows([], {
    targets: [
      { project: "p", specFolder: "2-second", group: { name: "Release", position: 2 } },
      { project: "p", specFolder: "1-first", group: { name: "Release", position: 1 } },
    ],
    providers: [],
    archived: [],
  } as never);
  expect(html.match(/data-spec-group=/g)).toHaveLength(1);
  expect(html.indexOf("1-first")).toBeLessThan(html.indexOf("2-second"));
  expect(html).toContain("0 of 2 done");
});

test("the Specs list's open row contains the group editor (A757 AC-1, A757 AC-11)", () => {
  const html = renderSpecsRows([], {
    targets: [{ project: "p", specFolder: "1-first", group: { name: "Release", position: 1 }, done: ["create"] }],
    providers: [],
    archived: [],
    openSpec: { key: "p/1-first" },
  } as never);
  expect(html).toContain('name="group" value="Release"');
  expect(html).toContain('<option value="Release"></option>');
  expect(html).toContain('name="removeGroup"');
});

test("archived members stay in their group and count as done (A757 AC-4, A757 AC-5)", () => {
  const html = renderSpecsRows([], {
    targets: [{ project: "p", specFolder: "2-next", group: { name: "Release", position: 2 } }],
    providers: [],
    archived: ["p/1-first"],
    archivedSpecs: [{
      project: "p", folder: "1-first", group: { name: "Release", position: 1 }, done: ["archive"],
      models: {}, phaseOutcomes: {}, closed: false,
    }],
  } as never);
  expect(html.match(/data-spec-group=/g)).toHaveLength(1);
  expect(html).toContain("1 of 2 done");
  expect(html.indexOf("1-first")).toBeLessThan(html.indexOf("2-next"));
});

test("Active keeps archived members in the group progress while hiding their rows (A757 AC-5)", () => {
  const html = renderSpecsRows([], {
    targets: [{ project: "p", specFolder: "2-next", group: { name: "Release", position: 2 } }],
    providers: [],
    archived: ["p/1-first"],
    archivedSpecs: [{
      project: "p", folder: "1-first", group: { name: "Release", position: 1 }, done: ["archive"],
      models: {}, phaseOutcomes: {}, closed: false,
    }],
    filter: { state: "not-archived" },
  } as never);
  expect(html).toContain("1 of 2 done");
  expect(html).not.toContain("data-folder=\"1-first\"");
});

test("grouped children have no Archive action (AC-5)", () => {
  const html = renderSpecsRows([], {
    targets: [{ project: "p", specFolder: "1-first", group: { name: "Release", position: 1 }, done: ["create", "analyze", "implement"] }],
    providers: [], archived: [],
  } as never);
  expect(html).not.toContain('value="archive"');
});
