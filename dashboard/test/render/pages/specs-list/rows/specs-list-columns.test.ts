// The Specs list has no Time or Cost: it sorts by neither, and its row
// ends in the spec's state and its PDF.

import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type SpecTarget } from "../../../../../src/render";
import { SPECS_LIST_SORTS, sortGroups } from "../../../../../src/render/pages/specs-list/data-model";

const targets: SpecTarget[] = [
  { project: "aide", specFolder: "81-older", createdAt: "2026-10-01T10:00:00Z" },
  { project: "aide", specFolder: "82-newer", createdAt: "2026-10-05T10:00:00Z" },
];

describe("the Specs list's columns", () => {
  test("a sort by Cost, remembered from the Running tab, is the default order instead", () => {
    const groups = [
      { specFolder: "81-older", createdAt: "2026-10-01T10:00:00Z", spentUsd: 9, state: "done" },
      { specFolder: "82-newer", createdAt: "2026-10-05T10:00:00Z", spentUsd: 1, state: "done" },
    ] as Parameters<typeof sortGroups>[0];
    const folders = (f: { sort?: string }) => sortGroups(groups, f, SPECS_LIST_SORTS).map((g) => g.specFolder);
    expect(folders({ sort: "cost" })).toEqual(folders({}));
    expect(sortGroups(groups, { sort: "cost" }).map((g) => g.specFolder)).not.toEqual(folders({}));
  });

  test("a spec's row links to its PDF", () => {
    const html = renderSpecsRows([], { runnerAvailable: true, targets, openSpec: {} });
    expect(html).toContain('href="/specs/aide/81-older/pdf"');
  });

  test("a host without the PDF tool says why on the row", () => {
    const html = renderSpecsRows([], { runnerAvailable: true, targets, openSpec: {}, pdfAvailable: false });
    expect(html).not.toContain('href="/specs/aide/81-older/pdf"');
    expect(html).toContain("md-to-pdf is not installed on this host");
  });
});
