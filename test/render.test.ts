// Criterion 5: ONE self-contained file (no external references), a
// card per project with an error card for invalid YAML while the rest
// render fully, a row per spec including archived ones, and a
// generated-at stamp matching an ISO date-time pattern.
import { describe, expect, test } from "bun:test";
import { renderPage, type ProjectView } from "../src/render.ts";

const projects: ProjectView[] = [
  {
    name: "goodproj",
    manifest: {
      ok: true,
      data: {
        name: "goodproj",
        description: "A healthy project",
        deployment: { url: "https://goodproj.example.com" },
        statistics: ["https://stats.example.com"],
      },
    },
    specs: [
      {
        folder: "01-active-spec",
        dir: "/x/01-active-spec",
        archived: false,
        title: "Active spec",
        status: { progress: { percent: 50, done: 1, total: 2 }, phase: "Phase 2: GREEN" },
      },
      {
        folder: "02-archived-spec",
        dir: "/x/archive/02-archived-spec",
        archived: true,
        title: "Archived spec",
        status: { progress: { percent: 100, done: 4, total: 4 }, phase: "done" },
      },
    ],
  },
  {
    name: "brokenproj",
    manifest: { ok: false, error: "YAML parse error at line 3" },
    specs: [],
  },
];

const generatedAt = "2026-08-16T12:00:00+02:00";
const html = renderPage(projects, generatedAt);

describe("renderPage", () => {
  test("self-contained: no external references", () => {
    expect(html).not.toContain("<script src");
    expect(html).not.toContain("<link ");
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });

  test("a card per project, error card for the broken one", () => {
    expect(html).toContain("goodproj");
    expect(html).toContain("A healthy project");
    expect(html).toContain("https://goodproj.example.com");
    expect(html).toContain("brokenproj");
    expect(html).toContain("YAML parse error at line 3");
  });

  test("a row per spec, archived included, with phase and progress", () => {
    expect(html).toContain("Active spec");
    expect(html).toContain("Archived spec");
    expect(html).toContain("Phase 2: GREEN");
    expect(html).toContain("50%");
  });

  test("generated-at stamp in ISO date-time form", () => {
    expect(html).toContain(generatedAt);
    expect(html).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});
