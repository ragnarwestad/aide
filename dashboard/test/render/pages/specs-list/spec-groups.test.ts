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

test("Specs renders group members as independent rows without a group fold (AC-10, AC-16)", () => {
  const html = renderSpecsRows([], {
    targets: [
      { project: "p", specFolder: "2-second", group: { name: "Release", position: 2 } },
      { project: "p", specFolder: "1-first", group: { name: "Release", position: 1 } },
    ],
    providers: [],
    archived: [],
  } as never);
  expect(html).not.toContain("data-spec-group=");
  expect(html).toContain("1-first");
  expect(html).toContain("2-second");
});

test("grouped children have no Archive action (AC-5)", () => {
  const html = renderSpecsRows([], {
    targets: [{ project: "p", specFolder: "1-first", group: { name: "Release", position: 1 }, done: ["create", "analyze", "implement"] }],
    providers: [], archived: [],
  } as never);
  expect(html).not.toContain('value="archive"');
});
