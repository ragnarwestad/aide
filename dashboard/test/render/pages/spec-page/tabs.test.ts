// documentTabNeedsEditor (spec 315, REQ-4): the one predicate both
// panels.ts (what to draw) and spec-edit.ts (whether to fetch the
// editor bundle at all) ask — mirroring documentPanel's own branching
// exactly, so the two can never again disagree.
import { describe, expect, test } from "bun:test";
import { documentTabNeedsEditor } from "../../../../src/render/pages/spec-page/tabs.ts";
import type { SpecPageView } from "../../../../src/render/pages/spec-page/types.ts";

const baseView = (overrides: Partial<SpecPageView> = {}): SpecPageView => ({
  project: "aide",
  specFolder: "81-queue-and-runner",
  files: [{ label: "1-description.md", text: "# Q\n" }],
  updateAction: "/update",
  saveAction: "/save",
  tickAction: "/tick",
  ...overrides,
});

describe("documentTabNeedsEditor", () => {
  test("true for an editable Description tab, active spec, no job running", () => {
    expect(documentTabNeedsEditor(baseView(), "description")).toBe(true);
  });

  // The description form always has a mount point, even with nothing
  // written yet — unlike the other three document tabs.
  test("true for the Description tab even when 1-description.md has never been written", () => {
    const view = baseView({ files: [] });
    expect(documentTabNeedsEditor(view, "description")).toBe(true);
  });

  test("false for an archived spec", () => {
    const view = baseView({ archived: true });
    expect(documentTabNeedsEditor(view, "description")).toBe(false);
  });

  test("false with a job queued", () => {
    const view = baseView({ lead: { state: "queued" } as SpecPageView["lead"] });
    expect(documentTabNeedsEditor(view, "description")).toBe(false);
  });

  test("false with a job running", () => {
    const view = baseView({ lead: { state: "running" } as SpecPageView["lead"] });
    expect(documentTabNeedsEditor(view, "description")).toBe(false);
  });

  test("true for an Analysis tab whose 2-analysis.md has been written, active spec, no job", () => {
    const view = baseView({
      files: [
        { label: "1-description.md", text: "# Q\n" },
        { label: "2-analysis.md", text: "Seven files.\n" },
      ],
    });
    expect(documentTabNeedsEditor(view, "analysis")).toBe(true);
  });

  test("false for an Analysis tab whose 2-analysis.md has never been written", () => {
    const view = baseView({ files: [{ label: "1-description.md", text: "# Q\n" }] });
    expect(documentTabNeedsEditor(view, "analysis")).toBe(false);
  });

  test("false for an Analysis tab whose file exists but has null text", () => {
    const view = baseView({ files: [{ label: "2-analysis.md", text: null }] });
    expect(documentTabNeedsEditor(view, "analysis")).toBe(false);
  });

  test("false for checks", () => {
    expect(documentTabNeedsEditor(baseView(), "checks")).toBe(false);
  });

  test("false for steps", () => {
    expect(documentTabNeedsEditor(baseView(), "steps")).toBe(false);
  });
});
