// The collapsed row on the Specs list says when the spec was created, in
// the server's own time, to the minute — what the Created sort orders by.

import { describe, expect, test } from "bun:test";
import { renderSpecsRows } from "../../../../../src/render";
import { createdLabel } from "../../../../../src/render/pages/specs-list/cell-helpers.ts";

describe("the created stamp", () => {
  test("is the date and the time to the minute, in local time", () => {
    expect(createdLabel(new Date(2026, 9, 11, 14, 42, 59).toISOString())).toBe("2026-10-11 14:42");
  });

  test("pads a single-digit month, day, hour and minute", () => {
    expect(createdLabel(new Date(2026, 0, 5, 7, 3).toISOString())).toBe("2026-01-05 07:03");
  });

  test("a spec git cannot date has no stamp", () => {
    expect(createdLabel(undefined)).toBe("");
    expect(createdLabel("not a date")).toBe("");
  });
});

// The Specs list says when; the Running tab keeps its pips instead.
describe("the cell under a spec's title", () => {
  const createdAt = new Date(2026, 9, 11, 14, 42).toISOString();
  const draw = (specsList: boolean) =>
    renderSpecsRows([], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-x", createdAt }],
      ...(specsList ? { openSpec: {} } : {}),
    });

  test("on the Specs list it holds the created stamp", () => {
    expect(draw(true)).toContain("2026-10-11 14:42");
  });

  test("on the Running tab it does not", () => {
    expect(draw(false)).not.toContain("2026-10-11 14:42");
  });
});
