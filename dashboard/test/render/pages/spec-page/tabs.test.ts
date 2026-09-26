// documentTabScript (spec 333, extending spec 315's REQ-4): the one
// predicate both panels.ts (what to draw) and spec-edit.ts (which
// bundle, if any, to fetch) ask — mirroring documentPanel's own
// branching exactly, so the two can never again disagree. Returns which
// of the two bundles a tab needs, not just whether one is needed: a
// locked tab with real text needs the viewer, never nothing.
import { describe, expect, test } from "bun:test";
import { documentTabScript, TAB_HELP } from "../../../../src/render/pages/spec-page/tabs.ts";
import type { SpecPageView } from "../../../../src/render";

const baseView = (overrides: Partial<SpecPageView> = {}): SpecPageView => ({
  project: "aide",
  specFolder: "81-queue-and-runner",
  files: [{ label: "1-description.md", text: "# Q\n" }],
  updateAction: "/update",
  saveAction: "/save",
  tickAction: "/tick",
  trackingAction: "/tracking",
  ...overrides,
});

describe("documentTabScript", () => {
  test("editor for an editable Description tab, active spec, no job running", () => {
    expect(documentTabScript(baseView(), "description")).toBe("editor");
  });

  // The description form always has a mount point, even with nothing
  // written yet — unlike the other three document tabs.
  test("editor for the Description tab even when 1-description.md has never been written", () => {
    const view = baseView({ files: [] });
    expect(documentTabScript(view, "description")).toBe("editor");
  });

  test("viewer for an archived spec's Description tab, which always has text", () => {
    const view = baseView({ archived: true });
    expect(documentTabScript(view, "description")).toBe("viewer");
  });

  test("viewer with a job queued", () => {
    const view = baseView({ lead: { state: "queued" } as SpecPageView["lead"] });
    expect(documentTabScript(view, "description")).toBe("viewer");
  });

  test("viewer with a job running", () => {
    const view = baseView({ lead: { state: "running" } as SpecPageView["lead"] });
    expect(documentTabScript(view, "description")).toBe("viewer");
  });

  test("editor for an Analysis tab whose 2-analysis.md has been written, active spec, no job", () => {
    const view = baseView({
      files: [
        { label: "1-description.md", text: "# Q\n" },
        { label: "2-analysis.md", text: "Seven files.\n" },
      ],
    });
    expect(documentTabScript(view, "analysis")).toBe("editor");
  });

  test("viewer for an archived spec's Analysis tab whose 2-analysis.md has been written", () => {
    const view = baseView({
      archived: true,
      files: [
        { label: "1-description.md", text: "# Q\n" },
        { label: "2-analysis.md", text: "Seven files.\n" },
      ],
    });
    expect(documentTabScript(view, "analysis")).toBe("viewer");
  });

  test("undefined for an Analysis tab whose 2-analysis.md has never been written", () => {
    const view = baseView({ files: [{ label: "1-description.md", text: "# Q\n" }] });
    expect(documentTabScript(view, "analysis")).toBeUndefined();
  });

  test("undefined for an archived spec's Analysis tab whose 2-analysis.md has never been written", () => {
    const view = baseView({ archived: true, files: [{ label: "1-description.md", text: "# Q\n" }] });
    expect(documentTabScript(view, "analysis")).toBeUndefined();
  });

  test("undefined for an Analysis tab whose file exists but has null text", () => {
    const view = baseView({ files: [{ label: "2-analysis.md", text: null }] });
    expect(documentTabScript(view, "analysis")).toBeUndefined();
  });

  const statusView = (overrides: Partial<SpecPageView> = {}): SpecPageView =>
    baseView({ files: [{ label: "4-status.md", text: "# S\n" }], ...overrides });

  test("viewer for the Status tab of an active spec, never the editor (AC-9)", () => {
    expect(documentTabScript(statusView(), "status")).toBe("viewer");
  });

  test("viewer for the Status tab of an archived spec and of one with a job in flight (AC-9)", () => {
    expect(documentTabScript(statusView({ archived: true }), "status")).toBe("viewer");
    expect(
      documentTabScript(statusView({ lead: { state: "running" } as SpecPageView["lead"] }), "status"),
    ).toBe("viewer");
  });

  test("undefined for a Status tab whose file has no text (AC-9)", () => {
    expect(documentTabScript(baseView(), "status")).toBeUndefined();
  });

  test("undefined for steps", () => {
    expect(documentTabScript(baseView(), "steps")).toBeUndefined();
  });
});

describe("the Status tab's help (AC-1)", () => {
  test("the Status tab's help names ticking and says only the acceptance criteria hold the archive back (AC-1)", () => {
    expect(TAB_HELP.status).toContain("Acceptance criteria");
    expect(TAB_HELP.status).toContain("archive");
    expect(TAB_HELP.status).not.toContain("Save here rewrites");
  });
});
