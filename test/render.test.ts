// Criteria 1-5 of aide-dashboard/01: renderSite produces index.html +
// one slugged page per project (collisions suffixed, `index`
// reserved); every page carries the shared nav with exactly one
// class="current" anchor pointing at itself; the overview shows
// linked names, descriptions and normative counts but no spec
// tables; project pages carry the full manifest block and spec
// table; every page is self-contained.
import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueueRows,
  renderSite,
  type JobDetailView,
  type Page,
  type ProjectView,
  type QueueRowView,
} from "../src/render.ts";

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
      description: null,
      status: { progress: { percent: 50, done: 1, total: 2 }, phase: "Phase 2: GREEN" },
    },
    {
      folder: "02-archived-spec",
      dir: "/x/archive/02-archived-spec",
      archived: true,
      title: "Archived spec",
      description: null,
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
  test("a Projects label separates the overview entry from the project links", () => {
    for (const page of site) {
      expect(page.html).toContain('<li class="nav-label">Projects</li>');
    }
  });

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

  test("a Projects heading above the project rows", () => {
    expect(index).toContain("<h2>Projects</h2>");
  });

  test("intro text and an aggregate summary line", () => {
    expect(index).toContain("read-only overview");
    expect(index).toContain("2 projects · 1 active · 1 archived");
  });

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

// --- spec 02: a running job is a black box -----------------------------------

const NAV = [{ label: "Overview", path: "index.html" }];

const detail = (extra: Partial<JobDetailView> = {}): JobDetailView => ({
  id: "job-1234",
  project: "aide-dashboard",
  specFolder: "02-job-detail-view",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-08-16T10:00:00Z",
  results: [],
  ...extra,
});

// Criterion 12: the row a reader actually watches is the way in.
describe("the queue row links to the job (criterion 12)", () => {
  const row = (extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id: "job-1234",
    project: "aide",
    specFolder: "81-queue-and-runner",
    steps: ["analyze"],
    stepIndex: 0,
    state: "running",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T00:00:00Z",
    ...extra,
  });

  test("the spec cell links to /queue/<id>", () => {
    const html = renderQueueRows([row()], { runnerAvailable: true, targets: [] });
    expect(html).toContain('<a href="/queue/job-1234">81-queue-and-runner</a>');
  });

  test("an existing branch link stays beside it, never replaced by it", () => {
    const html = renderQueueRows([row({ branchUrl: "https://example.test/compare" })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(html).toContain('<a href="/queue/job-1234">81-queue-and-runner</a>');
    expect(html).toContain('href="https://example.test/compare"');
  });
});

// Criteria 1, 2, 4, 5: what the job IS, everything it has already run,
// and what it is doing right now.
describe("renderJobDetailPage", () => {
  test("shows the spec's title and description without leaving the dashboard (criterion 1)", () => {
    const html = renderJobDetailPage(
      detail({
        title: "A running job is a black box",
        description: "The queue shows state, step and cost — and <nothing> about what the job IS.",
      }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("A running job is a black box");
    expect(html).toContain("The queue shows state, step and cost");
    // Spec prose is arbitrary text from a file, not markup.
    expect(html).toContain("&lt;nothing&gt;");
    expect(html).not.toContain("<nothing>");
  });

  test("every finished step gets its own row, not just the current one (criterion 2)", () => {
    const html = renderJobDetailPage(
      detail({
        steps: ["analyze", "review-plan", "implement"],
        stepIndex: 2,
        results: [
          {
            step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
            terminalReason: "completed", at: "2026-08-16T10:01:00Z",
          },
          {
            step: "review-plan", ok: true, costUsd: 1.07, costMeasured: true,
            terminalReason: "completed", at: "2026-08-16T10:03:00Z",
          },
        ],
      }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "steps" },
    );
    expect(html).toContain("analyze");
    expect(html).toContain("review-plan");
    expect(html).toContain("$0.42");
    expect(html).toContain("$1.07");
  });

  test("a job with no finished steps says so rather than showing an empty table", () => {
    const html = renderJobDetailPage(detail(), "2026-08-16T10:05:00Z", NAV, { tab: "steps" });
    expect(html).toContain("No step has finished yet");
  });

  test("a live session shows state, subagents and cost so far (criterion 4)", () => {
    const html = renderJobDetailPage(
      detail({
        sessionId: "11111111-2222-4333-8444-555555555555",
        live: { state: "working", subagents: 7, costUsd: 1.25, enriched: true },
      }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("Live right now");
    expect(html).toContain("working");
    expect(html).toMatch(/Subagents<\/td><td[^>]*>7</);
    expect(html).toContain("$1.25");
  });

  test("an unreachable claude-usage says unknown and keeps the rest of the page (criterion 5)", () => {
    const html = renderJobDetailPage(
      detail({
        title: "A running job is a black box",
        sessionId: "11111111-2222-4333-8444-555555555555",
        live: { state: "unknown", subagents: null, costUsd: null, enriched: false },
      }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("unknown");
    expect(html).toContain("A running job is a black box");
    expect(html).toContain("</html>");
  });

  test("the activity list is rendered as the parser produced it, already escaped", () => {
    const html = renderJobDetailPage(
      detail({ activity: ["Bash <code>ls</code>".replace(/</g, "&lt;").replace(/>/g, "&gt;")] }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "activity" },
    );
    expect(html).toContain("&lt;code&gt;");
    expect(html).not.toContain("<code>ls</code>");
  });

  test("a job with no stream kept says so, rather than showing a blank panel", () => {
    const html = renderJobDetailPage(detail({ activity: [] }), "2026-08-16T10:05:00Z", NAV, {
      tab: "activity",
    });
    expect(html).toContain("Nothing has been captured");
  });

  test("the page is self-contained and carries the shared nav", () => {
    const html = renderJobDetailPage(detail(), "2026-08-16T10:05:00Z", NAV);
    expect(html).not.toContain("<script src");
    expect(html).not.toContain("<link ");
    // The job page belongs to /queue, so that nav entry is the current one.
    expect(html).toContain('<a class="current" href="/queue">Queue</a>');
  });

  test("a finished job shows no live panel — there is no session to follow", () => {
    const html = renderJobDetailPage(
      detail({ state: "done", sessionId: undefined, live: null }),
      "2026-08-16T10:05:00Z",
      NAV,
    );
    expect(html).not.toContain("Live right now");
  });
});

// The four things the page says — what the job is, what it is doing,
// what it has done — ran together under plain headings, so a reader
// scrolled past the one they came for. One tab each.
describe("the job page is split into tabs", () => {
  const withParts = (extra: Partial<JobDetailView> = {}): JobDetailView =>
    detail({
      title: "A running job is a black box",
      activity: ["Bash ls"],
      results: [
        {
          step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
          terminalReason: "completed", at: "2026-08-16T10:01:00Z",
        },
      ],
      ...extra,
    });

  test("every tab is offered as a link back to this job", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV);
    expect(html).toContain('href="/queue/job-1234?tab=overview"');
    expect(html).toContain('href="/queue/job-1234?tab=activity"');
    expect(html).toContain('href="/queue/job-1234?tab=steps"');
  });

  test("the open tab is marked, and it is the only one", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV, { tab: "activity" });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Activity/);
  });

  // While a step is running, what it is DOING is what you opened the
  // page for. A finished job has nothing running, so the facts open.
  test("a running job opens on the activity, without being asked", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV);
    expect(html).toMatch(/aria-current="page"[^>]*>Activity/);
    expect(html).toContain("Bash ls");
    expect(html).not.toContain("$0.42");
  });

  test("a job that is not running opens on the overview", () => {
    const html = renderJobDetailPage(
      withParts({ state: "done", live: null }),
      "2026-08-16T10:05:00Z",
      NAV,
    );
    expect(html).toMatch(/aria-current="page"[^>]*>Overview/);
    expect(html).toContain("A running job is a black box");
    expect(html).not.toContain("Bash ls");
    expect(html).not.toContain("$0.42");
  });

  test("the overview is still one click away while the job runs", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV, { tab: "overview" });
    expect(html).toMatch(/aria-current="page"[^>]*>Overview/);
    expect(html).not.toContain("Bash ls");
  });

  test("the activity tab shows the run's lines and nothing else", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV, { tab: "activity" });
    expect(html).toContain("Bash ls");
    expect(html).not.toContain("$0.42");
  });

  test("the steps tab shows every step that has run", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV, { tab: "steps" });
    expect(html).toContain("$0.42");
    expect(html).not.toContain("Bash ls");
  });

  test("a tab name nobody offers falls back to the default instead of a blank page", () => {
    const html = renderJobDetailPage(
      withParts({ state: "done", live: null }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "../secrets" },
    );
    expect(html).toContain("A running job is a black box");
    expect(html).toMatch(/aria-current="page"[^>]*>Overview/);
  });

  test("the live panel belongs to the overview — it is about what is happening now", () => {
    const job = withParts({
      sessionId: "11111111-2222-4333-8444-555555555555",
      live: { state: "working", subagents: 7, costUsd: 1.25, enriched: true },
    });
    expect(renderJobDetailPage(job, "2026-08-16T10:05:00Z", NAV, { tab: "overview" })).toContain(
      "Live right now",
    );
    expect(renderJobDetailPage(job, "2026-08-16T10:05:00Z", NAV, { tab: "steps" })).not.toContain(
      "Live right now",
    );
  });

  test("the tab says how much is behind it, so a reader knows before clicking", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV);
    expect(html).toMatch(/>Activity <span class="tabcount">1<\/span>/);
    expect(html).toMatch(/>Steps <span class="tabcount">1<\/span>/);
  });

  test("an empty tab is still offered, and says why it is empty", () => {
    const html = renderJobDetailPage(
      detail({ activity: [] }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "activity" },
    );
    expect(html).toContain('href="/queue/job-1234?tab=activity"');
    expect(html).toContain("Nothing has been captured");
  });
});
