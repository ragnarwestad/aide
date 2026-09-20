import { describe, expect, test } from "bun:test";
import { renderNewSpecPage } from "../../../../src/render";
import { DESCRIPTION_MAX, TITLE_MAX } from "../../../../src/queue/parse-request.ts";

const html = renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-09-20T00:00:00Z", {
  createProjects: ["aide"],
  targets: [],
});

describe("the New-spec page as the server draws it", () => {
  test("Title and Description carry the bounds the server holds them to (AC-5)", () => {
    expect(html).toContain(`name="title" maxlength="${TITLE_MAX}"`);
    expect(html).toContain(`name="description" rows="10" maxlength="${DESCRIPTION_MAX}"`);
    expect([TITLE_MAX, DESCRIPTION_MAX]).toEqual([120, 5000]);
  });

  test("no count and no discarded-text line is drawn without the script (AC-5)", () => {
    // The stylesheet names the markers; no element may carry one.
    expect(html).not.toMatch(/<[a-z]+ [^>]*data-limit/);
  });
});
