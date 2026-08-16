// Criteria 1-5 of aide-dashboard/01: renderSite produces index.html +
// one slugged page per project (collisions suffixed, `index`
// reserved); every page carries the shared nav with exactly one
// class="current" anchor pointing at itself; the overview shows
// linked names, descriptions and normative counts but no spec
// tables; project pages carry the full manifest block and spec
// table; every page is self-contained.
import { describe, expect, test } from "bun:test";
import { renderSite, type Page, type ProjectView } from "../src/render.ts";

function project(name: string, overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    name,
    manifest: { ok: true, data: { name } },
    specs: [],
    ...overrides,
  };
}

const healthy: ProjectView = {
  name: "goodproj",
  manifest: {
    ok: true,
    data: {
      name: "goodproj",
      description: "A healthy project",
      stack: { frontend: "TypeScript" },
      deployment: { url: "https://goodproj.example.com" },
      statistics: ["https://stats.example.com"],
      docs: ["README.md"],
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
};

const broken: ProjectView = {
  name: "brokenproj",
  manifest: { ok: false, error: "YAML parse error at line 3" },
  specs: [],
};

const generatedAt = "2026-08-16T12:00:00+02:00";

const site = renderSite([healthy, broken], generatedAt);
const byPath = new Map(site.map((p: Page) => [p.path, p.html]));

describe("slugs and filenames (criterion 1)", () => {
  test("collisions and the reserved index name get numeric suffixes", () => {
    const tricky = renderSite(
      [project("My Proj"), project("my-proj"), project("index"), project("Claude Certified Architect")],
      generatedAt,
    );
    expect(tricky.map((p) => p.path).sort()).toEqual([
      "claude-certified-architect.html",
      "index-2.html",
      "index.html",
      "my-proj-2.html",
      "my-proj.html",
    ]);
  });

  test("normal names slug to lowercase hyphenated filenames", () => {
    expect(byPath.has("goodproj.html")).toBe(true);
    expect(byPath.has("brokenproj.html")).toBe(true);
    expect(byPath.has("index.html")).toBe(true);
  });
});

describe("nav (criterion 2)", () => {
  test("every page links to the overview and every project page", () => {
    for (const page of site) {
      expect(page.html).toContain('href="index.html"');
      expect(page.html).toContain('href="goodproj.html"');
      expect(page.html).toContain('href="brokenproj.html"');
    }
  });

  test("exactly one current anchor, pointing at the page itself", () => {
    for (const page of site) {
      const currents = [...page.html.matchAll(/<a class="current" href="([^"]+)"/g)];
      expect(currents).toHaveLength(1);
      expect(currents[0][1]).toBe(page.path);
    }
  });
});

describe("overview (criterion 3)", () => {
  const index = byPath.get("index.html")!;

  test("linked name, description and normative counts per project", () => {
    expect(index).toContain('href="goodproj.html"');
    expect(index).toContain("A healthy project");
    expect(index).toContain("1 active · 1 archived");
  });

  test("broken project marked as error with the parse error text", () => {
    expect(index).toMatch(/class="[^"]*error[^"]*"/);
    expect(index).toContain("YAML parse error at line 3");
  });

  test("generated-at stamp, and no tables on the overview", () => {
    expect(index).toContain(generatedAt);
    expect(index).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(index).not.toContain("<table");
  });
});

describe("project pages (criterion 4)", () => {
  test("every populated manifest key of the fixture appears", () => {
    const page = byPath.get("goodproj.html")!;
    expect(page).toContain("A healthy project");
    expect(page).toContain("TypeScript");
    expect(page).toContain("https://goodproj.example.com");
    expect(page).toContain("https://stats.example.com");
    expect(page).toContain("README.md");
  });

  test("spec table with phase, progress and archived row", () => {
    const page = byPath.get("goodproj.html")!;
    expect(page).toContain("<table");
    expect(page).toContain("Active spec");
    expect(page).toContain("Archived spec");
    expect(page).toContain("Phase 2: GREEN");
    expect(page).toContain("50%");
  });

  test("broken project's page shows the parse error", () => {
    expect(byPath.get("brokenproj.html")!).toContain("YAML parse error at line 3");
  });
});

describe("self-contained (criterion 5)", () => {
  test("no external references on any page", () => {
    for (const page of site) {
      expect(page.html).not.toContain("<script src");
      expect(page.html).not.toContain("<link ");
      expect(page.html).not.toMatch(/<img[^>]+src="https?:/);
    }
  });
});
