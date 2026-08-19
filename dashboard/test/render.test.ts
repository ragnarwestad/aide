// Criteria 1-5 of aide-dashboard/01: renderSite produces projects.html +
// one slugged page per project (collisions suffixed, `projects` and
// `index` reserved); every page carries the shared nav with exactly one
// class="current" anchor pointing at itself; the overview shows
// linked names, descriptions and normative counts but no spec
// tables; project pages carry the full manifest block and spec
// table; every page is self-contained.
import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueuePage,
  renderQueueRows,
  renderSite,
  type JobDetailView,
  type Page,
  type ProjectView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
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
  test("collisions and the reserved names get numeric suffixes", () => {
    const tricky = renderSite(
      [project("My Proj"), project("my-proj"), project("index"), project("About"),
       project("Claude Certified Architect")],
      generatedAt,
    );
    // `about` and `projects` are reserved like `index`: each names a
    // page the nav links to, so a project called any of them gets
    // suffixed instead of overwriting it.
    expect(tricky.map((p) => p.path).sort()).toEqual([
      "about-2.html",
      "about.html",
      "claude-certified-architect.html",
      "index-2.html",
      "my-proj-2.html",
      "my-proj.html",
      "projects.html",
    ]);
  });

  // Spec 100 criterion 8: the overview moved off `/` and needs a real
  // filename of its own, so `projects` joins the reserved set — a
  // project literally called that must not overwrite the overview.
  test("the overview is projects.html; no index.html is produced", () => {
    expect(site.map((p) => p.path)).toContain("projects.html");
    expect(site.map((p) => p.path)).not.toContain("index.html");
  });

  test("a project named Projects is suffixed, not allowed over the overview", () => {
    const pages = renderSite([project("Projects")], generatedAt);
    const overview = pages.find((p) => p.path === "projects.html")!;
    expect(overview.html).toContain("<h2>Projects</h2>");
    expect(pages.map((p) => p.path)).toContain("projects-2.html");
  });

  test("normal names slug to lowercase hyphenated filenames", () => {
    expect(byPath.has("goodproj.html")).toBe(true);
    expect(byPath.has("brokenproj.html")).toBe(true);
    expect(byPath.has("projects.html")).toBe(true);
  });
});

describe("nav (criterion 2)", () => {
  // The project pages are reached from the Projects page, not from the
  // nav: two lists of the same projects were one too many.
  test("the nav lists no project pages, and no Projects label", () => {
    for (const page of site) {
      expect(page.html).not.toContain('<li class="lbl">Projects</li>');
      expect(page.html).toContain('href="projects.html"');
      expect(page.html).not.toMatch(/<nav>[\s\S]*href="goodproj.html"[\s\S]*<\/nav>/);
    }
  });

  test("the Projects page links to every project page", () => {
    const html = byPath.get("projects.html")!;
    expect(html).toContain('href="goodproj.html"');
    expect(html).toContain('href="brokenproj.html"');
  });

  // The spec list is the front page (spec 100) and the wordmark is the
  // way home, so the nav is exactly Projects and About: nothing points
  // at `/`, and the project pages are the Projects page's business.
  test("the nav is Projects and About — the wordmark is home", () => {
    for (const page of site) {
      const navHtml = page.html.match(/<nav>[\s\S]*?<\/nav>/)![0];
      const links = [...navHtml.matchAll(/<li><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a><\/li>/g)].map(
        (m) => [m[2], m[1]],
      );
      expect(links).toEqual([["Projects", "projects.html"], ["About", "about.html"]]);
      expect(page.html).toContain('<a class="brand" href="/">');
    }
  });

  test("exactly one current anchor: the page itself, or Projects on a project page", () => {
    for (const page of site) {
      const currents = [...page.html.matchAll(/<a class="current" href="([^"]+)"/g)];
      expect(currents).toHaveLength(1);
      const expected = page.path === "about.html" ? "about.html" : "projects.html";
      expect(currents[0][1]).toBe(expected);
    }
  });
});

describe("overview (criterion 3)", () => {
  const index = byPath.get("projects.html")!;

  test("a Projects heading above the project rows", () => {
    expect(index).toContain("<h2>Projects</h2>");
  });

  // Read on a phone, the explanation filled the screen before anything
  // the reader came for. It is documentation, not status: the counts
  // belong here, the rest belongs on its own page in the menu.
  test("the counts are here; the explanation is not", () => {
    expect(index).toContain("2 projects · 1 active · 1 archived");
    expect(index).not.toContain("read-only overview");
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

describe("the About page", () => {
  test("it is generated, and holds the explanation the front page lost", () => {
    const page = byPath.get("about.html");
    expect(page).toBeDefined();
    expect(page!).toContain("read-only overview");
    expect(page!).toContain("make publish");
  });

  test("every page links to it from the menu", () => {
    for (const p of site) {
      expect(p.html).toContain('href="about.html"');
    }
  });

  test("it carries the shared nav and marks itself current", () => {
    const page = byPath.get("about.html")!;
    expect(page).toContain('<a href="projects.html">Projects</a>');
    expect(page).toContain('<a class="current" href="about.html">About</a>');
  });

  // The nav lists one entry per PROJECT page. About is a page too, and
  // the server's fallback nav reads the site directory — so it must not
  // be mistaken for a project.
  test("it is not listed under Projects", () => {
    const page = byPath.get("about.html")!;
    const projects = page.slice(page.indexOf('class="nav-label"'));
    expect(projects).not.toContain('href="about.html"');
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
      // The favicons are data URIs, so a <link> is fine — what this
      // test is about is a reference that needs a second request.
      expect(page.html).not.toMatch(/<link[^>]+href="(?!data:)/);
      expect(page.html).not.toMatch(/<img[^>]+src="https?:/);
    }
  });
});

// --- spec 02: a running job is a black box -----------------------------------

const NAV = [{ label: "Overview", path: "projects.html" }];

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

/** Since spec 103 a row is COLLAPSED unless the view names it: the
 *  phase lines, the run control and the "more" line come with opening
 *  it. A block that is about what an expanded row holds says so by
 *  opening every spec it renders. */
const openKeys = (
  list: { project?: string; specFolder: string }[],
  targets: { project: string; specFolder: string }[] = [],
): string =>
  [
    ...new Set([
      ...list.map((r) => `${r.project ?? "aide"}/${r.specFolder}`),
      ...targets.map((t) => `${t.project}/${t.specFolder}`),
    ]),
  ].join(",");

// Criterion 12: the row a reader actually watches is the way in.
describe("the queue row links to the job (criterion 12)", () => {
  test("the spec cell links to /specs/<id>", () => {
    const html = renderQueueRows([row()], { runnerAvailable: true, targets: [] });
    expect(html).toContain('<a href="/specs/job-1234">81-queue-and-runner</a>');
  });

  test("an existing branch link stays beside it, never replaced by it", () => {
    const html = renderQueueRows(
      [row({ branchUrls: [{ label: "aide", url: "https://example.test/compare", merged: false }] })],
      { runnerAvailable: true, targets: [] },
    );
    expect(html).toContain('<a href="/specs/job-1234">81-queue-and-runner</a>');
    expect(html).toContain('href="https://example.test/compare"');
  });
});

// --- spec 04: a finished job does not say its work is unmerged ---------------

// Criteria 1-4: the branch link alone says where the work IS, never
// whether it landed. A reader who sees only the link reads a finished
// job as a delivered one.
//
// Spec 96 (criteria 1, 3, 9): "not merged" was a fact about the BRANCH
// that read as a verdict on the spec — shown in the same amber whether
// the job that made the branch had finished or was still writing to it.
// A branch whose job is still going now says what that job is DOING; one
// whose job has stopped says the work is ready.
describe("the unmerged badge (criteria 1-4)", () => {
  const BRANCH = "https://example.test/compare";
  // Spec 89: one entry per repo. A one-repo spec — `paceup`,
  // `atlasaurus`, and every job before this field existed — is a list
  // of one, through the same code a two-repo spec uses.
  const at = (merged: boolean) => [{ label: "aide", url: BRANCH, merged }];
  const queueRows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row(extra)], { runnerAvailable: true, targets: [] });
  const jobPage = (extra: Partial<JobDetailView>) =>
    renderJobDetailPage(detail(extra), "2026-08-17T10:00:00Z", NAV, { tab: "overview" });

  test("a branch whose job is still going says what the job is doing (criterion 1)", () => {
    const html = queueRows({ branchUrls: at(false), state: "running" });
    expect(html).toContain("analyze running");
    expect(html).not.toContain("ready to merge");
    // The link a reader already uses is untouched beside it.
    expect(html).toContain(`href="${BRANCH}"`);
  });

  test("a branch whose job has stopped is ready to merge (criterion 3)", () => {
    const html = queueRows({ branchUrls: at(false), state: "done" });
    expect(html).toContain("ready to merge");
    expect(html).not.toContain('class="chip running"');
    expect(html).toContain(`href="${BRANCH}"`);
  });

  test("once the branch lands the caveat goes, and the link stays (criterion 2)", () => {
    for (const state of ["running", "done"] as const) {
      const html = queueRows({ branchUrls: at(true), state });
      expect(html).not.toContain("ready to merge");
      expect(html).not.toContain('class="chip running"');
      expect(html).toContain(`href="${BRANCH}"`);
    }
  });

  // Criterion 9: the two pages sharing one word choice is the whole
  // reason job-state.ts exists, and until spec 96 it was not exercised
  // for this particular piece of wording.
  test("the job page's Work row says the same thing (criteria 3, 9)", () => {
    expect(jobPage({ branchUrls: at(false), state: "running" })).toContain("analyze running");
    expect(jobPage({ branchUrls: at(false), state: "done" })).toContain("ready to merge");
    expect(jobPage({ branchUrls: at(true), state: "done" })).not.toContain("ready to merge");
  });

  test("no branch, no badge — on either page (criterion 4)", () => {
    for (const html of [
      queueRows({ branchUrls: [] }),
      queueRows({}),
      jobPage({ branchUrls: [] }),
      jobPage({}),
    ]) {
      expect(html).not.toContain("ready to merge");
      expect(html).not.toContain('class="chip running"');
    }
  });

  // Spec 89: the two branches share a NAME and nothing else. One badge
  // over both was the blind spot — the project's landed, the specs
  // repo's did not, and the page said nothing.
  test("two repos get two links and two independent badges", () => {
    const html = queueRows({
      state: "done",
      branchUrls: [
        { label: "aide", url: "https://example.test/aide", merged: true },
        { label: "aide-specs", url: "https://example.test/aide-specs", merged: false },
      ],
    });
    expect(html.match(/ready to merge/g)).toHaveLength(1);
    expect(html).toContain("https://example.test/aide-specs");
    expect(html).toContain("aide-specs");
  });
});

// --- spec 95: where the branch can be TRIED ----------------------------------

// The compare link says where the work is; for a web app the link that
// matters more is "try it". A project whose host builds every branch has
// one address per branch, and until now a reader had to know the host's
// naming rule and paste it together by hand.
describe("the preview link beside the compare link (criteria 1-4)", () => {
  const PREVIEW = "https://aide-95-preview.example.pages.dev";
  const queueRows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row(extra)], { runnerAvailable: true, targets: [] });
  const jobPage = (extra: Partial<JobDetailView>) =>
    renderJobDetailPage(detail(extra), "2026-08-17T10:00:00Z", NAV, { tab: "overview" });
  const withPreview = [
    { label: "aide", url: "https://example.test/aide", merged: false, previewUrl: PREVIEW },
  ];

  test("the row shows it next to the compare link, never instead of it (criterion 1)", () => {
    const html = queueRows({ branchUrls: withPreview, state: "done" });
    expect(html).toContain(`href="${PREVIEW}"`);
    expect(html).toContain('href="https://example.test/aide"');
    expect(html).toContain(">preview</a>");
  });

  test("the job page's Work line shows the same link (criterion 2)", () => {
    const html = jobPage({ branchUrls: withPreview, state: "done" });
    expect(html).toContain(`href="${PREVIEW}"`);
    expect(html).toContain('href="https://example.test/aide"');
  });

  // A project with no `deployment.preview` — aide itself, PaceUp — must
  // render exactly as it did before this field existed.
  test("no previewUrl, nothing new on either page (criterion 3)", () => {
    const bare = [{ label: "aide", url: "https://example.test/aide", merged: false }];
    for (const html of [queueRows({ branchUrls: bare }), jobPage({ branchUrls: bare })]) {
      expect(html).not.toContain(">preview</a>");
      expect(html).toContain('href="https://example.test/aide"');
    }
  });

  // The specs repo holds a plan. There is nothing to try in it, whatever
  // the project's manifest says.
  test("only the repo that carries the preview link gets one (criterion 4)", () => {
    const html = queueRows({
      state: "done",
      branchUrls: [
        { label: "aide", url: "https://example.test/aide", merged: false, previewUrl: PREVIEW },
        { label: "aide-specs", url: "https://example.test/aide-specs", merged: false },
      ],
    });
    expect(html.match(/>preview<\/a>/g)).toHaveLength(1);
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
    expect(html).toContain("review");
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

  // A run refused by aide-run-spec never starts claude, so there is no
  // transcript to keep — and "nothing has been captured" reads as a
  // lost transcript rather than a run that never began. The reader is
  // on this tab precisely because they want to know what happened.
  test("a run refused before it started says THAT, not that nothing was captured", () => {
    const html = renderJobDetailPage(
      detail({
        state: "failed",
        activity: [],
        error: "cannot fast-forward main in /x/develop/aide",
        results: [
          {
            step: "archive", ok: false, costUsd: 0, costMeasured: false,
            terminalReason: "refused", at: "2026-08-17T10:00:00Z",
          },
        ],
      }),
      "2026-08-17T10:05:00Z",
      NAV,
      { tab: "activity" },
    );
    expect(html).toContain("refused before it started");
    expect(html).toContain("cannot fast-forward main");
    expect(html).not.toContain("Nothing has been captured");
  });

  test("a refusal with no error text still says the run never started", () => {
    const html = renderJobDetailPage(
      detail({
        state: "failed",
        activity: [],
        results: [
          {
            step: "archive", ok: false, costUsd: 0, costMeasured: false,
            terminalReason: "refused", at: "2026-08-17T10:00:00Z",
          },
        ],
      }),
      "2026-08-17T10:05:00Z",
      NAV,
      { tab: "activity" },
    );
    expect(html).toContain("refused before it started");
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
    expect(html).not.toMatch(/<link[^>]+href="(?!data:)/);
    // The job page belongs to the spec list at `/`; the way there is
    // the wordmark, since the list has no nav entry of its own.
    expect(html).toContain('<a class="brand" href="/">');
    expect(html).not.toContain(">Specs</a>");
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
    expect(html).toContain('href="/specs/job-1234?tab=overview"');
    expect(html).toContain('href="/specs/job-1234?tab=activity"');
    expect(html).toContain('href="/specs/job-1234?tab=steps"');
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
    expect(html).toMatch(/>Activity · 1</);
    expect(html).toMatch(/>Steps · 1</);
  });

  test("an empty tab is still offered, and says why it is empty", () => {
    const html = renderJobDetailPage(
      detail({ activity: [] }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "activity" },
    );
    expect(html).toContain('href="/specs/job-1234?tab=activity"');
    expect(html).toContain("Nothing has been captured");
  });
});

// --- spec 86: one row per spec, with its phases beneath ----------------------

// A spec taken through analyze, review-plan, implement and archive as
// four separate jobs used to occupy four rows, repeating its own name on
// every one. It is ONE spec, and how far it has got should read without
// counting rows.
describe("the queue list groups by spec (criteria 1-7, 12)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "86-grouped", steps: [step], stepIndex: 0, state: "done", ...extra });

  // Every spec open: this block is about what an expanded row holds —
  // its phase lines, its action cell — which is what every row held
  // before spec 103 made collapsed the default.
  const rows = (list: QueueRowView[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets: [], filter: { open: openKeys(list) } },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const heads = (html: string) => html.match(/<tr class="[^"]*spechead/g) ?? [];
  // The cell for one phase, from its name to the end of the row.
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  test("two jobs for one spec make one header row, not two (criterion 1)", () => {
    const html = rows([
      job("j1", "analyze", { startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    expect(heads(html)).toHaveLength(1);
  });

  test("a phase that never ran keeps its place in the order (criterion 2)", () => {
    const html = rows([job("j1", "analyze"), job("j2", "implement")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["analyze", "review-plan", "implement", "archive"]);
    expect(subRow(html, "review-plan")).toContain("not run yet");
  });

  test("a phase run twice shows the latest attempt and the count (criterion 3)", () => {
    const html = rows([
      job("older", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("newer", "analyze", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain('href="/specs/newer"');
    expect(analyze).not.toContain('href="/specs/older"');
    expect(analyze).toContain("2 attempts");
    expect(html.match(/data-step="analyze"/g)).toHaveLength(1);
  });

  test("the header shows what is in flight, not what finished (criterion 4)", () => {
    const html = rows([
      job("j1", "analyze", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
      job("j2", "implement", { state: "running", startedAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(heads(html)[0]).toBeDefined();
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain('class="badge b-running"');
    expect(head).not.toContain('class="badge b-done"');
  });

  test("with nothing in flight the header shows the latest outcome (criterion 5)", () => {
    const html = rows([
      job("j1", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain('class="badge b-done"');
    expect(head).not.toContain('class="badge b-refused"');
  });

  test("the header's cost is the whole spec's, not one job's (criterion 6)", () => {
    const html = rows([
      job("j1", "analyze", { spentUsd: 1.2 }),
      job("j2", "implement", { spentUsd: 0.8 }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain("$2.00");
  });

  test("the unmerged badge appears once, on the header (criterion 7)", () => {
    const html = rows([
      job("j1", "analyze", {
        startedAt: "2026-08-16T09:00:00Z",
        branchUrls: [{ label: "aide", url: "https://example.test/old", merged: false }],
      }),
      job("j2", "implement", {
        startedAt: "2026-08-16T11:00:00Z",
        branchUrls: [{ label: "aide", url: "https://example.test/compare", merged: false }],
      }),
    ]);
    expect(html.match(/ready to merge/g)).toHaveLength(1);
    // The link comes from the most recently active job, not an older one.
    expect(html).toContain("https://example.test/compare");
    expect(html).not.toContain("https://example.test/old");
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain("ready to merge");
  });

  test("the action sits once on the header, never on a phase line (criterion 12)", () => {
    const html = rows([
      job("j1", "analyze", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "running", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    expect(html.match(/<form method="post" action="\/api\/queue\/j2\/cancel"/g)).toHaveLength(1);
    // Approve/cancel is the SPEC's one action and belongs on the header —
    // as, since spec 94, does the form that runs the spec's phases. A
    // phase line is read-only.
    for (const phase of ["analyze", "review-plan", "implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("/cancel");
      expect(subRow(html, phase)).not.toContain("/approve");
    }
  });

  test("two different specs keep their own header rows", () => {
    const html = rows([job("j1", "analyze"), job("j2", "analyze", { specFolder: "87-other" })]);
    expect(heads(html)).toHaveLength(2);
  });

  test("a step outside the four is still shown, never silently dropped", () => {
    const html = rows([job("j1", "analyze"), job("j2", "create")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["analyze", "review-plan", "implement", "archive", "create"]);
    expect(subRow(html, "create")).toContain('href="/specs/j2"');
  });
});

// --- a job that ran several steps belongs on all of them ---------------------

// Measured 2026-08-17 on spec 90: one job ran `analyze` and then
// `review-plan`, finished, and appeared ONLY on the review-plan line —
// because a job was placed by `steps[stepIndex]`, which is a single
// step. The analyze line was left showing an older attempt that had
// failed on `unknown spec`, so a finished analysis read as failed.
describe("a multi-step job is shown on every step it ran", () => {
  const rows = (list: QueueRowView[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets: [], filter: { open: openKeys(list) } },
      Date.parse("2026-08-17T12:00:00Z"),
    );
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  const twoStep = (extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({
      id: "both",
      specFolder: "90-grouped",
      steps: ["analyze", "review-plan"],
      stepIndex: 1,
      state: "done",
      spentUsd: 18.68,
      startedAt: "2026-08-17T11:00:00Z",
      results: [
        { step: "analyze", ok: true, costUsd: 5.95 },
        { step: "review-plan", ok: true, costUsd: 12.73 },
      ],
      ...extra,
    });

  test("both of its steps link to it", () => {
    const html = rows([twoStep()]);
    expect(subRow(html, "analyze")).toContain('href="/specs/both"');
    expect(subRow(html, "review-plan")).toContain('href="/specs/both"');
  });

  test("an older failed attempt does not speak for a step that has since passed", () => {
    const html = rows([
      row({
        id: "old",
        specFolder: "90-grouped",
        steps: ["analyze"],
        stepIndex: 0,
        state: "failed",
        error: "unknown spec",
        startedAt: "2026-08-17T09:00:00Z",
      }),
      twoStep(),
    ]);
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain('href="/specs/both"');
    expect(analyze).toContain("b-done");
    expect(analyze).not.toContain("unknown spec");
    expect(analyze).toContain("2 attempts");
  });

  test("each step carries its own cost, so the two do not both show the total", () => {
    const html = rows([twoStep()]);
    expect(subRow(html, "analyze")).toContain("$5.95");
    expect(subRow(html, "review-plan")).toContain("$12.73");
    // The header still totals the JOB, which is what was spent on the spec.
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain("$18.68");
  });

  test("a finished step reads as done while the next one is still running", () => {
    const html = rows([
      twoStep({ state: "running", spentUsd: 5.95, results: [{ step: "analyze", ok: true, costUsd: 5.95 }] }),
    ]);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "review-plan")).toContain("b-running");
  });

  test("the step that failed keeps the error; the steps before it do not", () => {
    const html = rows([
      twoStep({
        state: "failed",
        error: "cannot fast-forward main",
        spentUsd: 5.95,
        results: [
          { step: "analyze", ok: true, costUsd: 5.95 },
          { step: "review-plan", ok: false, costUsd: 0 },
        ],
      }),
    ]);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "analyze")).not.toContain("cannot fast-forward");
    expect(subRow(html, "review-plan")).toContain("b-refused");
    expect(subRow(html, "review-plan")).toContain("cannot fast-forward");
  });

  test("a job with no per-step results still lands on the step it is on", () => {
    const html = rows([
      row({ id: "plain", specFolder: "90-grouped", steps: ["implement"], stepIndex: 0, state: "queued" }),
    ]);
    expect(subRow(html, "implement")).toContain('href="/specs/plain"');
    expect(subRow(html, "analyze")).toContain("not run yet");
  });
});

// --- spec 94: a spec's phases are ticked and run from its own row ------------

// Two ways in became one. A form above the table queued several steps as
// one gated job for whichever spec its dropdown had selected, and each
// phase line carried its own one-step Run button. Both are gone: the
// spec's own header row carries one checkbox per phase, the model, the
// extras and one Run button that queues everything ticked as a single
// job — and it is on the HEADER row, because folding takes the phase
// lines out of the page entirely.
describe("a spec's row runs its own phases", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "94-row-runs-it", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // The run control belongs to an OPEN row since spec 103, so this
  // block opens every spec it renders unless a test says otherwise —
  // it is about what that control holds, which has not changed.
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  const page = (opts: Partial<QueuePageOptions> = {}) =>
    renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "94-never-run" }],
      ...opts,
    });

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The row's "more" line — since spec 103 the model, the gate and the
   *  other repos are on a `<tr>` of their own, not in the action cell. */
  const more = (html: string, folder: string) =>
    html.match(new RegExp(`<tr data-more="${folder}">.*?</tr>`))?.[0] ?? "";
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** One phase's checkbox and its label, from the row it sits on. */
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";

  test("done phases are marked and left unticked; the next one is pre-ticked (criterion 1)", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "review-plan")],
      [target("94-row-runs-it", { done: ["analyze", "review-plan"] })],
    );
    const line = head(html, "94-row-runs-it");
    expect(box(line, "analyze")).toContain('class="phase done"');
    expect(box(line, "analyze")).toContain('title="already done"');
    expect(box(line, "analyze")).not.toContain("checked");
    expect(box(line, "review-plan")).toContain('class="phase done"');
    expect(box(line, "implement")).toContain('value="implement" checked');
    expect(box(line, "archive")).not.toContain("checked");
    expect(line).not.toContain("disabled");
  });

  test("with every phase done, nothing is pre-ticked", () => {
    const line = head(
      rows(
        [job("j1", "archive")],
        [target("94-row-runs-it", { done: ["analyze", "review-plan", "implement", "archive"] })],
      ),
      "94-row-runs-it",
    );
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(box(line, step)).not.toContain("checked");
    }
  });

  test("a spec nothing has ever run pre-ticks analyze AND review-plan (criterion 1a)", () => {
    const line = head(rows([], [target("94-never-run")]), "94-never-run");
    expect(box(line, "analyze")).toContain('value="analyze" checked');
    expect(box(line, "review-plan")).toContain('value="review-plan" checked');
    expect(box(line, "implement")).not.toContain("checked");
    expect(box(line, "archive")).not.toContain("checked");
  });

  test("a spec that HAS run something pre-ticks only the next undone phase (criterion 1a)", () => {
    // `explore` is outside the four, so the done-set is still empty —
    // but something has run for this spec, and the pair is only for a
    // spec nothing has ever run.
    const line = head(rows([job("j1", "explore")], [target("94-row-runs-it")]), "94-row-runs-it");
    expect(box(line, "analyze")).toContain('value="analyze" checked');
    expect(box(line, "review-plan")).not.toContain("checked");
  });

  test("the pair never re-ticks a phase already done on disk (criterion 1b)", () => {
    // Nothing was ever queued for this spec, but its 2-analysis.md is
    // filled in: `done` is read off the files, not off job history.
    const line = head(rows([], [target("94-never-run", { done: ["analyze"] })]), "94-never-run");
    expect(box(line, "analyze")).toContain('class="phase done"');
    expect(box(line, "analyze")).not.toContain("checked");
    expect(box(line, "review-plan")).toContain('value="review-plan" checked');
  });

  test("a phase in flight is disabled; its siblings on the same row are not (criterion 2)", () => {
    for (const state of ["queued", "running", "awaiting-approval"] as const) {
      const line = head(
        rows([job("j1", "implement", { state })], [target("94-row-runs-it")]),
        "94-row-runs-it",
      );
      expect(box(line, "implement")).toContain("disabled");
      for (const other of ["analyze", "review-plan", "archive"]) {
        expect(box(line, other)).not.toContain("disabled");
      }
    }
  });

  test("a busy phase is never also pre-ticked", () => {
    const line = head(
      rows([job("j1", "analyze", { state: "running" })], [target("94-row-runs-it")]),
      "94-row-runs-it",
    );
    expect(box(line, "analyze")).toContain("disabled");
    expect(box(line, "analyze")).not.toContain("checked");
  });

  test("one form per row, posting the spec it belongs to and a box per phase (criterion 3)", () => {
    const line = head(rows([], [target("94-never-run")]), "94-never-run");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('name="project" value="aide"');
    expect(line).toContain('name="specFolder" value="94-never-run"');
    // The browser submits checkboxes in document order, so the order
    // the boxes are DRAWN in is the order `steps` arrives in.
    const order = [...line.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["analyze", "review-plan", "implement", "archive"]);
    expect(line).toContain(">Run</button>");
  });

  test("a phase already done can be ticked again — a rerun is the same submission (criterion 4)", () => {
    const line = head(
      rows([job("j1", "analyze")], [target("94-row-runs-it", { done: ["analyze"] })]),
      "94-row-runs-it",
    );
    expect(box(line, "analyze")).toContain('name="steps" value="analyze"');
    expect(box(line, "analyze")).not.toContain("disabled");
  });

  test("'also touches' lists the other projects and never the row's own (criterion 5)", () => {
    const line = more(rows([], [target("94-never-run")], { projects: ["aide", "paceup"] }), "94-never-run");
    expect(line).toContain('name="extraProjects" value="paceup"');
    expect(line).not.toContain('name="extraProjects" value="aide"');
    // No script needed to exclude the row's own project: the row knows
    // which spec it is before it is drawn.
    const field = line.slice(line.indexOf('name="extraProjects"'));
    expect(field.slice(0, 200)).not.toContain("checked");
  });

  test("with only its own project there is nothing to add (criterion 5)", () => {
    const html = rows([], [target("94-never-run")], { projects: ["aide"] });
    expect(more(html, "94-never-run")).not.toBe("");
    expect(html).not.toContain('name="extraProjects"');
  });

  test("the gate box is on every row, unticked, with or without 'also touches' (criterion 5a)", () => {
    for (const projects of [["aide"], ["aide", "paceup"]]) {
      const line = more(rows([], [target("94-never-run")], { projects }), "94-never-run");
      expect(line).toContain('<input type="checkbox" name="gate" value="1"');
      expect(line).not.toContain('name="gate" checked');
    }
  });

  test("the row offers the configured models, and a default that changes nothing", () => {
    const line = more(
      rows([], [target("94-never-run")], {
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12 }],
      }),
      "94-never-run",
    );
    expect(line).toContain('name="model"');
    expect(line).toContain('value="fable"');
    expect(line).toContain('<option value="">');
  });

  test("with no model configured the row offers no dropdown at all", () => {
    const html = rows([], [target("94-never-run")]);
    expect(more(html, "94-never-run")).not.toBe("");
    expect(html).not.toContain('name="model"');
  });

  test("the token rides along when the page carries one", () => {
    const line = head(rows([], [target("94-never-run")], { token: "s3cret" }), "94-never-run");
    expect(line).toContain('name="token" value="s3cret"');
  });

  test("a phase line is read-only now — it carries no form of its own", () => {
    const html = rows([job("j1", "analyze")], [target("94-row-runs-it")]);
    for (const phase of ["analyze", "review-plan", "implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("<form");
      expect(subRow(html, phase)).not.toContain("<button");
    }
  });

  // Spec 94 put the run control on the header row so folding could not
  // take it away; spec 103 retires that premise deliberately. Folding
  // is now what the run control is BEHIND: a collapsed row is a status
  // line, and the row a reader is about to act on is the one they open.
  test("the run control belongs to the open row, and folding takes it away", () => {
    const shut = rows([], [target("94-never-run")], { filter: {} });
    expect(shut).not.toContain('<tr class="subrow');
    expect(head(shut, "94-never-run")).not.toContain('action="/api/queue"');
    expect(head(shut, "94-never-run")).not.toContain('name="steps"');

    const open = rows([], [target("94-never-run")], { filter: { open: "aide/94-never-run" } });
    const line = head(open, "94-never-run");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('name="steps" value="analyze"');
  });

  test("a row's title, phase and progress come from its OWN target (criterion 9)", () => {
    const html = rows(
      [job("j1", "analyze")],
      [
        target("94-other", { title: "Another spec", phase: "Phase 1: RED", percent: 10 }),
        target("94-row-runs-it", { title: "Row runs it", phase: "Phase 2: GREEN", percent: 64 }),
      ],
    );
    const line = head(html, "94-row-runs-it");
    expect(line).toContain("Row runs it");
    expect(line).toContain("Phase 2: GREEN");
    expect(line).toContain("64% done");
    expect(line).not.toContain("Another spec");
    expect(line).not.toContain("Phase 1: RED");
  });

  test("a spec with no recorded status says so rather than showing a blank", () => {
    const line = head(rows([], [target("94-never-run")]), "94-never-run");
    expect(line).toContain("no status recorded yet");
  });

  test("the top form is gone from the page, not merely hidden (criterion 7)", () => {
    const html = page({ projects: ["aide"] });
    expect(html).not.toContain('name="target"');
    expect(html).not.toContain('id="targetdata"');
    expect(html).not.toContain('class="enqueue"');
    expect(html).not.toContain("Run a spec");
  });

  test("a refusal is shown on the page, belonging to no one row (criterion 6)", () => {
    const html = page({ error: "analyze is already queued for this spec" });
    expect(html).toContain('class="refusal rowmsg err"');
    expect(html).toContain("analyze is already queued for this spec");
    // Above the table, so it is read before the row that caused it.
    expect(html.indexOf("refusal")).toBeLessThan(html.indexOf('id="jobrows"'));
  });
});

// --- spec 90: every spec is a row, and analyze starts from it ----------------

// The dropdown at the top and the list held the same things: one showed
// specs that had not started, the other specs that had. A spec crossed
// from one to the other the first time it ran, and nothing about that
// crossing was meaningful to the reader.
describe("every spec is a row (criteria 1-10)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "90-has-run", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        // Open, because this block is about what a row HOLDS — the
        // phase lines and the form that runs them, which spec 103 put
        // behind the fold without changing either. The targets alone:
        // a job whose spec is no longer a target must not reach the
        // page through the fold state either.
        filter: { open: openKeys([], targets) },
        ...opts,
      },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const heads = (html: string) => html.match(/<tr class="[^"]*spechead[^"]*"[^>]*>/g) ?? [];
  // One header row and everything up to the next `<tr`, which is the
  // whole header line and nothing else.
  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  test("a target with no jobs gets a header row and four phase lines (criterion 1)", () => {
    const html = rows([], [target("90-never-run")]);
    expect(heads(html)).toHaveLength(1);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["analyze", "review-plan", "implement", "archive"]);
    for (const phase of order) expect(subRow(html, phase!)).toContain("not run yet");
  });

  test("a never-run spec's own row runs analyze (criterion 2)", () => {
    // Spec 94 moved the form off the phase line and onto the header
    // row, which is the only line folding leaves in the page.
    const html = rows([], [target("90-never-run")]);
    const line = head(html, "90-never-run");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('name="project" value="aide"');
    expect(line).toContain('name="specFolder" value="90-never-run"');
    expect(line).toContain('name="steps" value="analyze"');
    expect(line).toContain(">Run</button>");
    expect(line).not.toContain("disabled");
    expect(subRow(html, "analyze")).not.toContain("<form");
  });

  test("a never-run spec reads 'not started' and links to no job (criterion 3)", () => {
    const html = rows([], [target("90-never-run")]);
    const line = head(html, "90-never-run");
    // Hyphen in the class, space in the text: one is the filter key, the
    // other is what the reader sees.
    expect(line).toContain('<span class="badge b-idle">not started</span>');
    // The absence of the JOB link, not of an anchor — the fold control
    // is an anchor and lives in the same cell.
    expect(line).not.toMatch(/href="\/specs\/[^"]+"/);
    expect(line).toContain("90-never-run");
  });

  test("a spec that is both a target and has jobs gets one row (criterion 4)", () => {
    const html = rows([job("j1", "analyze")], [target("90-has-run")]);
    expect(heads(html)).toHaveLength(1);
    expect(html).toContain('href="/specs/j1"');
  });

  test("a job group whose spec is no longer a target is off the page (criterion 5)", () => {
    const html = rows([job("j1", "analyze")], [target("90-something-else")]);
    expect(html).not.toContain("90-has-run");
    expect(heads(html)).toHaveLength(1);
  });

  test("a project with no targets at all keeps every group it has (criterion 6)", () => {
    // An empty target list is "we do not know", never "everything is
    // archived": a specs root that is not checked out on this host looks
    // exactly the same from here.
    const html = rows([job("j1", "analyze")], [target("01-first", { project: "paceup" })]);
    expect(html).toContain("90-has-run");
    expect(html).toContain("01-first");
  });

  test("never-run specs form a stable block at the bottom (criterion 7)", () => {
    const html = rows(
      [job("j1", "analyze", { startedAt: "2026-08-16T09:00:00Z" })],
      [target("90-has-run"), target("88-never"), target("89-never")],
    );
    const order = [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map(
      (m) => m[1],
    );
    // The higher-numbered folder comes first within the block.
    expect(order).toEqual(["90-has-run", "89-never", "88-never"]);
  });

  test("two specs that have both RUN keep the order they have today (criterion 7)", () => {
    // A general folder tie-break would reverse this pair. It must reach
    // only groups where `activityAt` is 0 on both sides.
    const html = rows(
      [
        job("j1", "analyze", { specFolder: "aa-spec", startedAt: "2026-08-16T09:00:00Z" }),
        job("j2", "analyze", { specFolder: "bb-spec", startedAt: "2026-08-16T09:00:00Z" }),
      ],
      [],
      { filter: { sort: "started" } },
    );
    const order = [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["aa-spec", "bb-spec"]);
  });

  test("the state chips count and cut the never-run specs (criterion 8)", () => {
    const list = [job("j1", "analyze", { state: "done" })];
    const targets = [target("90-has-run"), target("90-never-run")];
    const html = rows(list, targets);
    expect(html).toMatch(/>All · 2</);
    expect(html).toMatch(/>Not started · 1</);
    expect(html).toMatch(/>Active · 0</);
    expect(html).toMatch(/>Done · 1</);
    expect(html).toMatch(/>Problems · 0</);

    const only = rows(list, targets, { filter: { state: "not-started" } });
    expect(only).toContain("90-never-run");
    expect(head(only, "90-has-run")).toBe("");
  });

  test("a never-run spec's Cost and Started are dashes (criterion 9)", () => {
    const line = head(rows([], [target("90-never-run")]), "90-never-run");
    expect(line).not.toContain("$0.00");
    expect(line).not.toContain("Invalid Date");
    expect(line).not.toContain("NaN");
    // Two dashes: one for Started, one for Cost — plus the action cell.
    expect(line.match(/–/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("with neither jobs nor targets the page says there is no spec (criterion 10)", () => {
    const html = rows([], []);
    expect(html).toContain("No spec");
    expect(html).not.toContain("Pick a spec above");
  });
});

// --- spec 90: a spec's phases fold away --------------------------------------

// Adding a row for every spec that has never run makes the list longer,
// and folding is what keeps it readable. The state is a query parameter,
// so it survives the five-second swap of the table by the mechanism the
// filter and the sort already ride on.
//
// Spec 103 turned the polarity round: the key is `open`, it names the
// rows shown EXPANDED, and a row nobody named is collapsed. The claims
// below are the same ones spec 90 made — one spec's fold state leaves
// the others alone, a key naming no spec is inert, every filter and
// sort link carries the state forward — asked of the new default.
describe("a spec's phases fold away (criteria 11-15)", () => {
  const target = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });

  const rows = (targets: QueueTarget[], filter?: QueuePageOptions["filter"]) =>
    renderQueueRows(
      [],
      { runnerAvailable: true, targets, filter },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";

  test("a spec nobody has opened reads as shut, and its control opens it (criterion 11)", () => {
    const html = rows([target("90-x")]);
    const line = head(html, "90-x");
    expect(line).toContain('aria-expanded="false"');
    expect(html).not.toContain('<tr class="subrow');
    // Percent-encoded, because `queueHref` encodes each value. The raw
    // key appears in no href under any implementation.
    expect(line).toContain("open=aide%2F90-x");
  });

  test("an opened spec gains its phase lines, and its control shuts it again (criterion 12)", () => {
    const html = rows([target("90-x")], { open: "aide/90-x" });
    const line = head(html, "90-x");
    expect(line).not.toBe("");
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    expect(line).toContain('aria-expanded="true"');
    // Its own control now SHUTS it: the encoded key is gone from its href.
    expect(line).not.toContain("open=aide%2F90-x");
  });

  // The control was a text glyph (▸/▾) in a 1rem box: barely visible,
  // and a target nobody could hit. It is an SVG chevron in a 24px flat
  // now, and the state is on the element, not in the glyph.
  test("the fold control is an SVG chevron, open and shut told apart by a class", () => {
    const opened = head(rows([target("90-x")], { open: "aide/90-x" }), "90-x");
    expect(opened).toMatch(/<a class="fold"[^>]*aria-expanded="true"[^>]*><svg/);
    expect(opened).not.toContain("▾");
    const shut = head(rows([target("90-x")]), "90-x");
    expect(shut).toMatch(/<a class="fold shut"[^>]*aria-expanded="false"[^>]*><svg/);
    expect(shut).not.toContain("▸");
  });

  test("opening one spec leaves the other shut (criterion 13)", () => {
    const html = rows([target("90-x"), target("90-y")], { open: "aide/90-x" });
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(html).toContain(`data-step="${step}"`);
    }
    expect(head(html, "90-y")).toContain('aria-expanded="false"');
    // The other spec's own control keeps the opened key and adds its
    // own — the whole filter travels through `queueHref`.
    expect(head(html, "90-y")).toContain("open=aide%2F90-x%2Caide%2F90-y");
  });

  test("an open key naming no spec leaves every real spec collapsed (criterion 14)", () => {
    const html = rows([target("90-x")], { open: "aide/nope" });
    expect(html).not.toContain('<tr class="subrow');
    expect(head(html, "90-x")).toContain('aria-expanded="false"');
  });

  test("the filter, sort and project links keep the fold (criterion 15)", () => {
    const html = rows([target("90-x"), target("90-y")], { open: "aide/90-x", state: "not-started" });
    // Every state chip and every sortable column header keeps it.
    const links = [...html.matchAll(/<a data-nav href="([^"]+)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(4);
    for (const href of links) expect(href).toContain("open=aide%2F90-x");
  });

  // Spec 100: the list answers at `/`, so every link it builds for
  // itself is rooted there — `/specs` would cost a redirect hop on
  // every sort, filter and fold click.
  test("the filter, sort and fold links are rooted at / , not /specs", () => {
    const html = rows([target("90-x"), target("90-y")], { open: "aide/90-x", state: "not-started" });
    const links = [...html.matchAll(/<a data-nav href="([^"]+)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(4);
    for (const href of links) {
      expect(href).toMatch(/^\/(\?|$)/);
    }
  });
});

// Spec 97: the row says when the plan describes an older problem than
// the description does. Nothing is blocked — a person who knows the
// edit was cosmetic can still start `implement`; the page just stops
// pretending the plan is current.
describe("the description-changed badge (criteria 1, 3)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "97-stale", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // The badge sits on the analyze PHASE LINE, which a collapsed row
  // does not draw at all — so every example here opens its spec.
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  // The path every example in the ticket takes: 93, 94 and 96 had all
  // actually run an analyze, so a badge wired only into `emptyGroup`
  // would never fire for any of them.
  test("a spec with job history carries it on the analyze line (criterion 1)", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale", { analyzeStale: true })]);
    expect(subRow(html, "analyze")).toContain("description changed since");
    for (const phase of ["review-plan", "implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("description changed since");
    }
  });

  test("a spec nothing has run carries it too (criterion 1)", () => {
    const html = rows([], [target("97-never-run", { analyzeStale: true })]);
    expect(subRow(html, "analyze")).toContain("description changed since");
  });

  test("a spec whose description has not moved carries nothing (criterion 4)", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale")]);
    expect(html).not.toContain("description changed since");
  });

  // `done` is what the server has already stripped `analyze` and
  // `review-plan` out of; the row's job is to pre-tick the first phase
  // that is left, which is analyze — not implement.
  test("analyze is pre-ticked again, not implement (criterion 3)", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "implement")],
      [target("97-stale", { analyzeStale: true, done: ["implement"], percent: 100 })],
    );
    const line = head(html, "97-stale");
    expect(line).toMatch(/value="analyze" checked/);
    expect(line).not.toMatch(/value="implement" checked/);
    // Exactly one box, as `stepBoxes` has always ticked: the pair
    // belongs to a spec nothing has ever run (spec 94).
    expect([...line.matchAll(/value="[^"]*" checked/g)]).toHaveLength(1);
  });
});

// --- spec 99: the view survives an action, and a refusal finds its row ------

// Pressing Run, Approve, Cancel or Merge used to drop the reader back
// on the default view: the redirect after the POST can only carry
// forward what the POST itself received, and none of the three forms
// sent anything about the current filter.
describe("every action form carries the current view (criterion 7)", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";

  const FILTER = { state: "all", project: "aide", sort: "spec", dir: "desc", open: "aide/99-x" };

  test("the Run form sends every filter key (criterion 7)", () => {
    const line = head(rows([], [target("99-x")], { filter: FILTER }), "99-x");
    for (const [key, value] of Object.entries(FILTER)) {
      expect(line).toContain(`<input type="hidden" name="view.${key}" value="${value}">`);
    }
  });

  // `project` is the collision: the Run form already posts a field of
  // that name to say WHICH spec to run, and two of them arrive as a
  // list that the enqueue refuses as "invalid project".
  test("the view's project never collides with the Run form's own (criterion 7)", () => {
    const line = head(rows([], [target("99-x")], { filter: FILTER }), "99-x");
    expect(line).toContain(`<input type="hidden" name="project" value="aide">`);
    expect([...line.matchAll(/name="project"/g)]).toHaveLength(1);
  });

  // Nothing is sent that the view does not hold: the row is open, so
  // the Run form is there to carry the fields, and the only key set is
  // the only key posted.
  test("a key the view does not hold is not sent (criterion 7)", () => {
    const line = head(rows([], [target("99-x")], { filter: { open: "aide/99-x" } }), "99-x");
    expect(line).toContain('<input type="hidden" name="view.open" value="aide/99-x">');
    for (const key of ["state", "project", "sort", "dir"]) {
      expect(line).not.toContain(`name="view.${key}"`);
    }
  });

  test("the Cancel form sends them too (criterion 7)", () => {
    const running = row({ id: "j1", specFolder: "99-x", state: "running" });
    // Cancel belongs to the open row — a collapsed one offers Approve
    // or Merge and nothing else (spec 103).
    const line = head(
      rows([running], [target("99-x")], { filter: { state: "active", open: "aide/99-x" } }),
      "99-x",
    );
    const form = line.match(/<form method="post" action="\/api\/queue\/j1\/cancel"[^>]*>.*?<\/form>/)![0];
    expect(form).toContain('<input type="hidden" name="view.state" value="active">');
  });

  test("the Approve form sends them too (criterion 7)", () => {
    const waiting = row({ id: "j1", specFolder: "99-x", state: "awaiting-approval" });
    const line = head(rows([waiting], [target("99-x")], { filter: { sort: "cost" } }), "99-x");
    const form = line.match(/<form method="post" action="\/api\/queue\/j1\/approve"[^>]*>.*?<\/form>/)![0];
    expect(form).toContain('<input type="hidden" name="view.sort" value="cost">');
  });

  test("the Merge form sends them too (criterion 7)", () => {
    const done = row({
      id: "j1",
      specFolder: "99-x",
      state: "done",
      branchUrls: [{ label: "aide", url: "https://example.test/aide", merged: false }],
    });
    const line = head(rows([done], [target("99-x")], { filter: { state: "all" } }), "99-x");
    const form = line.match(/<form method="post" action="\/api\/queue\/j1\/merge"[^>]*>.*?<\/form>/)![0];
    expect(form).toContain('<input type="hidden" name="view.state" value="all">');
  });
});

// The page lists up to 25 rows, so a refusal shown once at the top of
// the page does not say WHICH row it is about.
describe("a refusal is shown on the row it belongs to (criteria 8, 12)", () => {
  const target = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });

  const rows = (targets: QueueTarget[], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      [],
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";

  test("the named spec's row carries the reason, and no other row does (criterion 8)", () => {
    const html = rows([target("99-x"), target("99-y")], {
      error: "the tree is dirty in /repos/aide",
      errorSpec: "aide/99-x",
    });
    expect(head(html, "99-x")).toContain("the tree is dirty in /repos/aide");
    expect(head(html, "99-y")).not.toContain("the tree is dirty");
  });

  test("an errorSpec naming another project leaves the row alone (criterion 8)", () => {
    const html = rows([target("99-x")], { error: "refused", errorSpec: "paceup/99-x" });
    expect(head(html, "99-x")).not.toContain("refused");
  });

  test("the page-top banner is not shown as well when a row has it (criterion 12)", () => {
    const page = renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [target("99-x")],
      error: "the tree is dirty in /repos/aide",
      errorSpec: "aide/99-x",
    });
    expect(page).not.toContain('<p class="refusal">');
    // …and the reason is still on the page, on its row.
    expect(page).toContain("the tree is dirty in /repos/aide");
  });

  test("a refusal that belongs to no row keeps the banner (criterion 12)", () => {
    const page = renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [target("99-x")],
      error: "payload too large",
    });
    expect(page).toContain('<p class="refusal rowmsg err">');
    expect(page).toContain("payload too large");
  });
});

// Spec 100 made the spec list the front page; the nav's own "Specs"
// entry went with the wordmark taking over as home. On `/` no list
// entry is current — the wordmark is the page — and nothing links to
// the old /specs.
describe("spec 100: the list page's own nav", () => {
  test("renderQueuePage has no Specs entry and no /specs link; the wordmark is home", () => {
    const html = renderQueuePage(
      [],
      "2026-08-18T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: true, targets: [] },
    );
    expect(html).not.toContain(">Specs</a>");
    expect(html).not.toContain('href="/specs"');
    expect(html).toContain('<a class="brand" href="/">');
    expect(html).toContain('<a href="projects.html">Overview</a>');
  });
});

// --- spec 101: one pass over the page as a whole -----------------------------

// The page was built one row-feature at a time and never looked at
// whole. Three of the six complaints are render-level: a disabled box
// that looks live, a job whose later steps read as free while it holds
// them, and an intro paragraph standing between the title and the list
// on every load.
describe("spec 101: a busy job holds every step it was queued with (criteria 1-3)", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  // The step boxes belong to the open row (spec 103); which of them a
  // busy job holds is what this block is about.
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );
  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";

  /** One job holding two steps — the shape every spec here is actually
   *  started as (`analyze` + `review-plan` as one gated job). */
  const pair = (state: QueueRowView["state"], stepIndex = 0): QueueRowView =>
    row({
      specFolder: "101-specs-page-ui-pass",
      steps: ["analyze", "review-plan"],
      stepIndex,
      state,
    });

  const line = (r: QueueRowView) =>
    head(rows([r], [target("101-specs-page-ui-pass")]), "101-specs-page-ui-pass");

  test("a later step of the running job is disabled too, not only the one in flight", () => {
    const l = line(pair("running"));
    // The server would refuse a second job naming EITHER of these
    // (`clashing()` tests the whole job), so the page must not offer
    // one of them as available.
    expect(box(l, "analyze")).toContain("disabled");
    expect(box(l, "review-plan")).toContain("disabled");
    // A step the job never held stays offerable.
    expect(box(l, "implement")).not.toContain("disabled");
    expect(box(l, "archive")).not.toContain("disabled");
  });

  test("a queued job holds its steps before it has started any of them", () => {
    const l = line(pair("queued"));
    expect(box(l, "analyze")).toContain("disabled");
    expect(box(l, "review-plan")).toContain("disabled");
  });

  test("a disabled box says why, on the label the pointer is over", () => {
    const l = line(pair("running"));
    expect(box(l, "analyze")).toContain('title="analyze is running"');
    // The reason is about the JOB, so the step that has not started yet
    // carries the same sentence rather than a blank one.
    expect(box(l, "review-plan")).toContain('title="analyze is running"');
  });

  test("a step nothing is holding carries no title at all", () => {
    expect(box(line(pair("running")), "implement")).not.toContain("title=");
  });

  test("a finished job holds nothing — every box is offerable again", () => {
    const l = line(pair("done", 1));
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(box(l, step)).not.toContain("disabled");
      expect(box(l, step)).not.toContain("title=\"analyze");
    }
  });

  test("a job that failed, stopped or was cancelled holds nothing either", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const l = line(pair(state, 1));
      expect(box(l, "analyze")).not.toContain("disabled");
      expect(box(l, "review-plan")).not.toContain("disabled");
    }
  });
});

describe("spec 101: the intro is out of the way (criterion 10)", () => {
  const page = (opts: Partial<QueuePageOptions> = {}) =>
    renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [],
      ...opts,
    });

  test("the intro is behind a closed disclosure, not standing above the list", () => {
    const html = page();
    expect(html).toContain('<details class="intro">');
    // Closed by default: `<details open>` would be the same paragraph
    // with an extra click's worth of markup around it.
    expect(html).not.toContain('<details class="intro" open');
    expect(html).not.toContain('<p class="intro">');
    // The copy itself is unchanged — this is where it is, not what it says.
    expect(html).toContain("A job that hits a cap is");
  });

  test("the runner-unavailable notice stays outside it", () => {
    const html = page({ runnerAvailable: false });
    expect(html).toContain("No runner is installed");
    // "nothing here spends money" is safety-relevant context and must
    // not need a click.
    expect(html.indexOf("No runner is installed")).toBeLessThan(html.indexOf('<details class="intro">'));
  });
});

describe("spec 101: one line per row for what is going on and what is next (criterion 11)", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(list, { runnerAvailable: true, targets }, Date.parse("2026-08-18T12:00:00Z"));
  // The sentence sits in the state cell now, under the badge it
  // explains, and is the last thing in that cell.
  const hint = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = head.split("<td")[3] ?? "";
    return state.match(/<div class="muted small">([\s\S]*?)<\/div>\s*<\/td>/)?.[1] ?? "";
  };

  test("a spec nothing has run says what the next click is", () => {
    const text = hint(rows([], [target("101-never-run")]));
    expect(text).toContain("Run");
  });

  test("a running job names the step it is on and the ones still to come", () => {
    const text = hint(
      rows(
        [row({ specFolder: "101-a", steps: ["analyze", "review-plan"], stepIndex: 0, state: "running" })],
        [target("101-a")],
      ),
    );
    expect(text).toContain("analyze");
    expect(text).toContain("running");
    // Shown as `review`; `review-plan` is the value, not the word.
    expect(text).toContain("review");
  });

  test("a job on its last step promises nothing after it", () => {
    const text = hint(
      rows(
        [row({ specFolder: "101-a", steps: ["analyze", "review-plan"], stepIndex: 1, state: "running" })],
        [target("101-a")],
      ),
    );
    expect(text).toContain("review");
    expect(text).not.toContain("to follow");
  });

  test("a job waiting on a person says whose move it is", () => {
    const text = hint(
      rows([row({ specFolder: "101-a", state: "awaiting-approval" })], [target("101-a")]),
    );
    expect(text.toLowerCase()).toContain("approval");
  });

  test("a job that stopped short says how to try again", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const text = hint(
        rows([row({ specFolder: "101-a", steps: ["implement"], state })], [target("101-a")]),
      );
      expect(text).toContain("Run");
      expect(text).toContain("implement");
    }
  });

  test("a finished spec with a branch still out says the branch is the next thing", () => {
    const text = hint(
      rows(
        [
          row({
            specFolder: "101-a",
            state: "done",
            branchUrls: [{ label: "aide", url: "https://example.test/aide", merged: false }],
          }),
        ],
        [target("101-a")],
      ),
    );
    expect(text.toLowerCase()).toContain("merge");
  });

  test("a finished spec with nothing left out does not ask for a merge", () => {
    const text = hint(rows([row({ specFolder: "101-a", state: "done" })], [target("101-a")]));
    expect(text).toContain("done");
    expect(text.toLowerCase()).not.toContain("merge");
  });

  test("every row has the line — a hint that is blank on half the rows says nothing", () => {
    const html = rows(
      [row({ specFolder: "101-a", state: "running" })],
      [target("101-a"), target("101-b")],
    );
    // The hint closes the state cell on every row.
    expect([...html.matchAll(/<\/span><div class="muted small">[^<]*<\/div><\/td>/g)]).toHaveLength(2);
  });
});


// --- spec 103: a collapsed row shows status only -----------------------------

// Folding used to remove the four phase LINES and nothing else: the
// collapsed row still carried the phase checkboxes, the model dropdown,
// "more" and the Run button, so a list of collapsed rows was still a
// wall of controls and folding said nothing about what it was FOR.
// A collapsed row now says what the spec IS and what state it is in,
// and offers at most the one thing it needs from the reader right now
// (Approve while a gate waits, Merge while a branch waits). Everything
// else belongs to the expanded row, which is what it always was.
describe("spec 103: a collapsed row shows status only", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The row's own "more" line: its own `<tr>`, not a cell of the header. */
  const moreLine = (html: string, folder: string) =>
    html.match(new RegExp(`<tr data-more="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The last cell of the header row — where every action lives. */
  const actionCell = (line: string) => line.slice(line.lastIndexOf("<td>"));

  const open = (folder: string) => ({ filter: { open: `aide/${folder}` } });

  test("a collapsed row carries no run control at all (criterion 1)", () => {
    const line = head(rows([], [target("103-idle")]), "103-idle");
    expect(line).not.toBe("");
    expect(line).not.toContain('action="/api/queue"');
    expect(line).not.toContain('name="steps"');
    expect(line).not.toContain('name="model"');
    expect(line).not.toContain('class="more"');
    expect(line).not.toContain(">Run<");
  });

  test("a collapsed row keeps its name, status, pips, started and cost (criterion 1)", () => {
    const line = head(
      rows(
        [row({ id: "j1", specFolder: "103-idle", state: "done", spentUsd: 1.5,
               startedAt: "2026-08-19T09:00:00Z" })],
        [target("103-idle", { title: "Status only", phase: "Phase 3", percent: 75 })],
      ),
      "103-idle",
    );
    expect(line).toContain("103-idle");
    expect(line).toContain("Status only");
    expect(line).toContain("75% done");
    expect(line).toContain('class="badge b-done"');
    expect(line).toContain('class="pips"');
    expect(line).toContain("$1.50");
  });

  test("a gated collapsed row offers Approve, and only Approve (criterion 2)", () => {
    const cell = actionCell(
      head(
        rows([row({ id: "j1", specFolder: "103-gated", state: "awaiting-approval" })],
             [target("103-gated")]),
        "103-gated",
      ),
    );
    expect(cell).toContain('action="/api/queue/j1/approve"');
    expect(cell).not.toContain('action="/api/queue/j1/cancel"');
    expect(cell.match(/<form/g)).toHaveLength(1);
  });

  test("a collapsed row with an unmerged branch offers Merge, and only Merge (criterion 3)", () => {
    const cell = actionCell(
      head(
        rows(
          [row({ id: "j1", specFolder: "103-merge", state: "done",
                 branchUrls: [{ label: "aide", url: "https://example.test/c", merged: false }] })],
          [target("103-merge")],
        ),
        "103-merge",
      ),
    );
    expect(cell).toContain('action="/api/queue/j1/merge"');
    expect(cell.match(/<form/g)).toHaveLength(1);
    expect(cell).not.toContain('name="steps"');
  });

  test("a running collapsed row offers nothing — Cancel is one click away (criterion 4)", () => {
    const cell = actionCell(
      head(rows([row({ id: "j1", specFolder: "103-busy", state: "running" })], [target("103-busy")]),
           "103-busy"),
    );
    expect(cell).not.toContain("<form");
  });

  test("a collapsed row with nothing pending has an empty action cell (criterion 4)", () => {
    const cell = actionCell(head(rows([], [target("103-idle")]), "103-idle"));
    expect(cell).not.toContain("<form");
    expect(cell).not.toContain("<button");
  });

  test("with no open parameter at all, no row shows a run form (criterion 7)", () => {
    const html = rows(
      [
        row({ id: "j1", specFolder: "103-a", state: "done" }),
        row({ id: "j2", specFolder: "103-b", state: "running" }),
      ],
      [target("103-a"), target("103-b"), target("103-c")],
    );
    expect(html).not.toContain('action="/api/queue"');
    expect(html).not.toContain('name="steps"');
    expect(html).not.toContain('<tr class="subrow');
  });

  test("expanding a row reveals every control the page has always had (criterion 5)", () => {
    const html = rows([], [target("103-idle")], {
      ...open("103-idle"),
      projects: ["aide", "paceup"],
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    const line = head(html, "103-idle");
    expect(line).toContain('<form id="rowrun-aide/103-idle" method="post" action="/api/queue"');
    expect(line).toContain('name="steps" value="analyze"');
    expect(line).toContain(">Run</button>");
    const more = moreLine(html, "103-idle");
    expect(more).toContain('name="model"');
    expect(more).toContain('name="gate"');
    expect(more).toContain('name="extraProjects" value="paceup"');
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
  });

  test("an expanded row's forms carry the open key forward (criterion 6)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "103-gated", state: "awaiting-approval" })],
      [target("103-gated")],
      open("103-gated"),
    );
    const line = head(html, "103-gated");
    expect(line).toContain('<input type="hidden" name="view.open" value="aide/103-gated">');
    const approve = line.match(/<form method="post" action="\/api\/queue\/j1\/approve"[^>]*>.*?<\/form>/)![0];
    expect(approve).toContain('name="view.open" value="aide/103-gated"');
    // And Cancel is back, on the row that is open.
    expect(line).toContain('action="/api/queue/j1/cancel"');
  });

  test("'more' is its own full-width line, never a cell of the header row (criterion 10)", () => {
    const html = rows([], [target("103-idle")], {
      ...open("103-idle"),
      projects: ["aide", "paceup"],
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    expect(head(html, "103-idle")).not.toContain('class="more"');
    const more = moreLine(html, "103-idle");
    expect(more).toContain('<td colspan="6">');
    expect(more).toContain('<details class="more">');
    // It sits directly under the row it belongs to, above the phase lines.
    expect(html.indexOf('<tr data-more="103-idle"')).toBeGreaterThan(
      html.indexOf('data-folder="103-idle"'),
    );
    expect(html.indexOf('<tr data-more="103-idle"')).toBeLessThan(html.indexOf('<tr class="subrow'));
  });

  test("a collapsed row emits no 'more' line at all (criterion 10)", () => {
    const html = rows([], [target("103-idle")], { projects: ["aide", "paceup"] });
    expect(html).not.toContain("data-more");
    expect(html).not.toContain('class="more"');
  });

  // The model, the gate and the also-touches chips left the action cell,
  // so they are no longer INSIDE the form they submit with. The `form`
  // attribute is what carries them back — an id that drifts from the
  // form's own silently runs the job with the defaults instead.
  test("the moved fields submit with the row's own Run form (criterion 10)", () => {
    const html = rows([], [target("103-idle")], {
      ...open("103-idle"),
      projects: ["aide", "paceup"],
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    const id = head(html, "103-idle").match(/<form id="([^"]+)"/)![1];
    const more = moreLine(html, "103-idle");
    const fields = [...more.matchAll(/<(?:select|input)\b[^>]*name="(model|gate|extraProjects)"[^>]*>/g)];
    expect(fields.length).toBe(3);
    for (const f of fields) expect(f[0]).toContain(`form="${id}"`);
  });
});
