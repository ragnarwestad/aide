// The Specs list has Time and Cost on a spec's second line and sorts by
// them; the spec's PDF is among the open spec's actions.

import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { page, view } from "../../spec-page-fixtures.ts";

const targets: SpecTarget[] = [
  { project: "aide", specFolder: "81-cheap", createdAt: "2026-10-05T10:00:00Z" },
  { project: "aide", specFolder: "82-dear", createdAt: "2026-10-01T10:00:00Z" },
];
const ran = (specFolder: string, spentUsd: number): QueueRowView => ({
  id: specFolder, project: "aide", specFolder, steps: ["analyze"], stepIndex: 0, state: "done",
  spentUsd, timeoutSec: 600, createdAt: "2026-10-06T10:00:00Z", results: [],
}) as QueueRowView;

describe("the Specs list's columns", () => {
  test("a sort by Cost orders the Specs list by what each spec cost", () => {
    const html = renderSpecsRows([ran("81-cheap", 1), ran("82-dear", 9)], {
      runnerAvailable: true, targets, openSpec: {}, filter: { sort: "cost", dir: "desc" },
    });
    expect(html.indexOf('data-folder="82-dear"')).toBeLessThan(html.indexOf('data-folder="81-cheap"'));
  });
});

describe("the spec's PDF, among the open spec's actions", () => {
  test("links to the spec's PDF", () => {
    expect(page(view())).toContain('href="/specs/aide/150-one-page-shows-the-whole-spec/pdf"');
  });

  test("a host without the PDF tool says why", () => {
    const html = page(view({ pdfUnavailableReason: "md-to-pdf is not installed on this host" }));
    expect(html).not.toContain('href="/specs/aide/150-one-page-shows-the-whole-spec/pdf"');
    expect(html).toContain("md-to-pdf is not installed on this host");
  });
});
