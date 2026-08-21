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
  renderNewSpecPage,
  renderQueuePage,
  navEntries,
  renderQueueRows,
  renderSite,
  type JobDetailView,
  type NewSpecPageOptions,
  type Page,
  type ProjectView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../src/render.ts";
// The padlock itself, so a test can say a box does NOT carry one
// without restating its markup (spec 145).
import { ICON_LOCK } from "../src/render/components.ts";

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
      dependsOn: [],
      status: {
        progress: { percent: 50, done: 1, total: 2 },
        phase: "Phase 2: GREEN",
        workflowSteps: ["create", "analyze", "review-plan"],
      },
    },
    {
      folder: "02-archived-spec",
      dir: "/x/archive/02-archived-spec",
      archived: true,
      title: "Archived spec",
      description: null,
      dependsOn: [],
      status: {
        progress: { percent: 100, done: 4, total: 4 },
        phase: "done",
        workflowSteps: ["create", "analyze", "review-plan", "implement", "archive"],
      },
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
    // Still the overview's file, whatever it holds — since spec 115 the
    // way on to the served page.
    expect(overview.html).toContain('<a href="/projects">');
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
      // Spec 115: the entry points at the SERVED page, not at the file.
      expect(page.html).toContain('href="/projects"');
      expect(page.html).not.toMatch(/<nav>[\s\S]*href="goodproj.html"[\s\S]*<\/nav>/);
    }
  });

  // Criterion 9 (spec 115), at the source: one entry, retargeted at the
  // served page. `navFromSite()` in serve.ts is a SEPARATE fallback and
  // deliberately still answers `projects.html` — serve.test.ts holds
  // that half.
  test("the Projects entry points at the served page", () => {
    expect(navEntries([healthy, broken])[0]).toEqual({ label: "Projects", path: "/projects" });
  });

  // Two tabs since spec 119, and only two: the site has a Specs half
  // and a Projects half, and the project pages are the Projects page's
  // business rather than tabs of their own. About left the bar for the
  // "…" menu — it is not a half of the site.
  test("the tabs are Specs and Projects; the wordmark is still home", () => {
    for (const page of site) {
      const navHtml = page.html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
      const links = [...navHtml.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
        (m) => [m[2], m[1]],
      );
      expect(links).toEqual([["Specs", "/"], ["Projects", "/projects"]]);
      expect(page.html).toContain('<a class="brand" href="/">');
    }
  });

  // Every generated page is a Projects page: the overview, the About
  // page's siblings and one page per project. None of them is the spec
  // list, so Specs is never the current tab here.
  test("exactly one current tab, and on a generated page it is Projects", () => {
    for (const page of site) {
      const navHtml = page.html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
      const currents = [...navHtml.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)];
      // About has no tab of its own — it is reached through the menu.
      const expected = page.path === "about.html" ? [] : ["Projects"];
      expect(currents.map((m) => m[1])).toEqual(expected);
    }
  });
});

// Spec 107. The three choices are not a page to go to, so they are not
// tabs — and since spec 119 they are not on the page at all until the
// reader opens the "…" menu in the header.
describe("the theme choice in the … menu (specs 107, 119)", () => {
  const menu = (html: string) => html.match(/<details class="menu">[\s\S]*?<\/details>/)![0];

  test("every page offers Dark, Light and Auto", () => {
    for (const page of site) {
      const m = menu(page.html);
      const choices = [...m.matchAll(/data-theme-choice="([^"]+)"[^>]*>([^<]+)</g)].map(
        (x) => [x[1], x[2]],
      );
      expect(choices).toEqual([["dark", "Dark"], ["light", "Light"], ["auto", "Auto"]]);
      expect(m).toContain(">Theme</span>");
    }
  });

  test("the choices are buttons, not links — they go nowhere", () => {
    const m = menu(site[0]!.html);
    expect(m).toMatch(/<button type="button" data-theme-choice="dark"/);
    expect(m).not.toMatch(/<a[^>]*data-theme-choice/);
  });

  test("Auto is marked as chosen, because the server cannot know better", () => {
    for (const page of site) {
      const m = menu(page.html);
      const marked = [...m.matchAll(/data-theme-choice="([^"]+)" aria-current=/g)].map(
        (x) => x[1],
      );
      expect(marked).toEqual(["auto"]);
      // `aria-current`, never `class="current"`: that class means "the
      // page you are on", and the theme control is not a page.
      expect(m).not.toMatch(/<button[^>]*class="current"/);
    }
  });
});

// Spec 115: the listing itself moved to the SERVED `/projects`, where
// the panel that changes the list can sit beside it. What the generator
// still writes at this filename is a redirect — the file has to keep
// existing (`rsync-publish.sh` will not publish a site without it, and
// people have bookmarked it), but the reader belongs on the served page.
// The listing's own tests went with it, to projects-page.test.ts.
describe("the generated overview is a redirect to /projects", () => {
  const index = byPath.get("projects.html")!;

  test("it sends the reader on, keeping whatever the address carried", () => {
    expect(index).toContain("location.replace('/projects' + location.search)");
  });

  // The script is the fast path, not the only one: a browser with
  // JavaScript off, or a folder opened without a server, still has
  // something to click.
  test("a plain link too, for a reader the script never reaches", () => {
    expect(index).toContain('<a href="/projects">');
    expect(index.toLowerCase()).toContain("moved");
  });

  test("it lists nothing itself — that is the served page's job now", () => {
    expect(index).not.toContain('class="proj-row"');
    expect(index).not.toContain("2 projects · 1 active · 1 archived");
    expect(index).not.toContain("Manage projects");
    expect(index).not.toContain("<table");
  });

  test("it is still a page of the site, nav and all; the stamp lives on About", () => {
    expect(index).toContain("<nav");
    expect(index).not.toContain(generatedAt);
    expect(byPath.get("about.html")).toContain(generatedAt);
  });
});

// About opens as a DIALOG from the menu (asked for 2026-08-19): the
// markup rides on every page, the menu item opens it in place, and the
// about.html page below stays as the no-JS fallback its href points at.
describe("the About dialog", () => {
  test("every page carries the dialog, with a close cross", () => {
    for (const p of site) {
      expect(p.html).toContain('<dialog class="about">');
      expect(p.html).toContain('<button class="aboutclose" aria-label="Close">');
      // the platform's own close: no script once the box is open
      expect(p.html).toContain('<form method="dialog">');
    }
  });

  test("a static page's dialog carries the labelled build stamp", () => {
    expect(byPath.get("about.html")!.match(/Build: these static pages/g)!.length)
      .toBeGreaterThanOrEqual(1);
  });

  test("a served page's dialog carries no build stamp — it was not built", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", NAV, {
      runnerAvailable: true,
      targets: [],
    });
    expect(html).toContain('<dialog class="about">');
    expect(html).not.toContain("Build:");
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

  // Spec 119: About is reached from the "…" menu, so it has no tab of
  // its own and marks none of the two current.
  test("it is reached from the menu, and marks no tab current", () => {
    const page = byPath.get("about.html")!;
    const menu = page.match(/<details class="menu">[\s\S]*?<\/details>/)![0];
    expect(menu).toContain('<a href="about.html" data-about>About</a>');
    expect(page.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0]).not.toContain("aria-current");
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
//
// Spec 150 changed WHERE in: the name opens the SPEC, not whichever job
// happened to run last — so every spec has somewhere to point, including
// one that has never run anything.
describe("the queue row links to the spec (criterion 12)", () => {
  const SPEC_HREF = "/specs/aide/81-queue-and-runner";

  test("the spec cell links to the spec page", () => {
    const html = renderQueueRows([row()], { runnerAvailable: true, targets: [] });
    expect(html).toContain(`<a class="label" href="${SPEC_HREF}" title="81-queue-and-runner">81-queue-and-runner</a>`);
  });

  // "A spec that has never run has no job page to point at, so the name
  // is text: a link to nothing is worse than no link." That sentence is
  // what the spec page invalidates.
  test("a spec that has never run is a link too", () => {
    const html = renderQueueRows([], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    expect(html).toContain(`href="${SPEC_HREF}"`);
    expect(html).not.toContain('<span class="label" title="81-queue-and-runner">');
  });

  // The phase lines are unchanged: a phase's page is that phase's own
  // RUN, which is a job and is still read at /specs/<job-id>.
  test("the phase lines still point at the job that ran them", () => {
    const html = renderQueueRows([row({ steps: ["analyze"], state: "done" })], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: { open: "aide/81-queue-and-runner" },
    });
    expect(html).toContain('href="/specs/job-1234"');
  });

  // The name is one line with an ellipsis, and the marks carry a
  // lead-in — a wrapped name-tail used to land in front of bare repo
  // names and read as one of them (2026-08-19).
  test("the marks say what they are, and the stylesheet clamps the name", async () => {
    const html = renderQueueRows(
      [row({ branchUrls: [{ label: "aide", url: "https://example.test/compare", merged: false }] })],
      { runnerAvailable: true, targets: [] },
    );
    expect(html).toContain('<span class="branchlist"><span class="lbl">Affected repos:</span>');
    const { CSS } = await import("../src/render/css.ts");
    expect(CSS).toContain(".spec-name > .label { overflow: hidden; text-overflow: ellipsis;");
  });

  test("an existing branch link stays beside it, never replaced by it", () => {
    const html = renderQueueRows(
      [row({ branchUrls: [{ label: "aide", url: "https://example.test/compare", merged: false }] })],
      { runnerAvailable: true, targets: [] },
    );
    expect(html).toContain('<a class="label" href="/specs/aide/81-queue-and-runner" title="81-queue-and-runner">81-queue-and-runner</a>');
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
  // The Work row left the job page with spec 150: the branch, its
  // compare link and its badge are all on the row this page is opened
  // from, and the Overview is now what is said nowhere else. The badge
  // itself is unchanged — it is asserted on the row above.
  test("the job page no longer carries the branch at all (spec 150)", () => {
    for (const state of ["running", "done"] as const) {
      const html = jobPage({ branchUrls: at(false), state });
      expect(html).not.toContain(BRANCH);
      expect(html).not.toContain("ready to merge");
    }
  });

  test("no branch, no badge — on either page (criterion 4)", () => {
    for (const html of [queueRows({ branchUrls: [] }), queueRows({})]) {
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
    // The State line says "ready to merge the plan"/"the code" too since
    // spec 132; this test is about the per-repo badge, whose wording is bare.
    expect(html.match(/>ready to merge</g)).toHaveLength(1);
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

  // Spec 150 took the Work line off the job page; the row is where both
  // links live now.
  test("the job page shows neither link — the row carries both (spec 150)", () => {
    const html = jobPage({ branchUrls: withPreview, state: "done" });
    expect(html).not.toContain(PREVIEW);
    expect(html).not.toContain('href="https://example.test/aide"');
  });

  // A project with no `deployment.preview` — aide itself, PaceUp — must
  // render exactly as it did before this field existed.
  test("no previewUrl, nothing new on either page (criterion 3)", () => {
    const bare = [{ label: "aide", url: "https://example.test/aide", merged: false }];
    const html = queueRows({ branchUrls: bare });
    expect(html).not.toContain(">preview</a>");
    expect(html).toContain('href="https://example.test/aide"');
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
  // Spec 150 moved the `## Description` prose off this page: the whole
  // description is one of the four files on the SPEC page, and a
  // phase's page shows what that PHASE made instead. The title stays,
  // above the tabs, because a reader still has to know which spec this
  // job is about.
  test("shows the spec's title, and the phase's own file (criterion 1)", () => {
    const html = renderJobDetailPage(
      detail({
        title: "A running job is a black box",
        phase: { label: "2-analysis.md", text: "It shows <nothing> about what the job IS." },
      }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("A running job is a black box");
    expect(html).toContain("about what the job IS");
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

  // Criteria 4 and 5 were the "Live right now" panel, and spec 150
  // removed it outright: it existed for the one moment a step runs and
  // answered `State not-live · Subagents – · Cost so far – · Session
  // decc8861`, because claude-usage does not recognise a session run in
  // a worktree under `~/aide-worktrees/` — which is where every run has
  // worked since spec 91. Its absence is asserted in its own block
  // further down ("Live right now is gone").

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
    // The job page belongs to the spec list at `/`, and says so twice
    // over: the wordmark goes home, and the Specs tab is the current
    // one (spec 119 — `job-page.ts` passes `currentPath = "/"`).
    expect(html).toContain('<a class="brand" href="/">');
    expect(html).toMatch(/<nav[^>]*>[\s\S]*aria-current="page"[^>]*>Specs<\/a>/);
  });

  test("a finished job shows no live panel — there is no session to follow", () => {
    const html = renderJobDetailPage(
      detail({ state: "done" }),
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
    // The page proper, without the site's own tab bar above it — spec
    // 119 put a second marked tab there, and Specs is legitimately
    // current on a job page.
    const page = html.replace(/<nav[^>]*>[\s\S]*?<\/nav>/, "");
    expect(page.match(/aria-current="page"/g)).toHaveLength(1);
    expect(page).toMatch(/aria-current="page"[^>]*>Activity/);
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
      withParts({ state: "done" }),
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
      withParts({ state: "done" }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "../secrets" },
    );
    expect(html).toContain("A running job is a black box");
    expect(html).toMatch(/aria-current="page"[^>]*>Overview/);
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
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");

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
    expect(order).toEqual(["create", "analyze", "review-plan", "implement", "archive"]);
    expect(subRow(html, "review-plan")).toContain("not run yet");
  });

  test("a phase that never ran is drawn like any other, not half-lit", () => {
    // Asked for 2026-08-20: a control is enabled or disabled, with
    // nothing in between. A row at 55% opacity reads as a disabled
    // control, and these boxes are not disabled — they tick, and a run
    // starts. The State column already says "not run yet" in words,
    // which is the same fact without the ambiguity.
    const html = rows([job("j1", "analyze")]);

    expect(subRow(html, "review-plan")).toContain("not run yet");
    expect(html).not.toContain("untried");
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
    // Spec 132: a resting `done` badge reads the resting state and what
    // is next, so it wears `b-ready` here. What it must not read is the
    // OLDER job's outcome, which would still be the bare word "failed".
    expect(head).toContain('class="badge b-ready"');
    expect(head).toContain("ready for analyze");
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
    // The State line says "ready to merge the plan"/"the code" too since
    // spec 132; this test is about the per-repo badge, whose wording is bare.
    expect(html.match(/>ready to merge</g)).toHaveLength(1);
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
    expect(html.match(/<tr class="subrow/g)).toHaveLength(5);
    expect(html.match(/<form method="post" action="\/api\/queue\/j2\/cancel"/g)).toHaveLength(1);
    // Approve/cancel is the SPEC's one action and belongs on the header —
    // as, since spec 94, does the form that runs the spec's phases. A
    // phase line is read-only.
    for (const phase of ["create", "analyze", "review-plan", "implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("/cancel");
      expect(subRow(html, phase)).not.toContain("/approve");
    }
  });

  test("two different specs keep their own header rows", () => {
    const html = rows([job("j1", "analyze"), job("j2", "analyze", { specFolder: "87-other" })]);
    expect(heads(html)).toHaveLength(2);
  });

  // Spec 116: create is the FIRST phase line, not a straggler appended
  // after archive — and it appears exactly once, never twice.
  test("a create job leads the phase list, once (spec 116, criterion 8)", () => {
    const html = rows([job("j1", "analyze"), job("j2", "create")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "review-plan", "implement", "archive"]);
    expect(subRow(html, "create")).toContain('href="/specs/j2"');
  });

  test("a step outside the five is still shown, never silently dropped", () => {
    const html = rows([job("j1", "analyze"), job("j2", "explore")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "review-plan", "implement", "archive", "explore"]);
    expect(subRow(html, "explore")).toContain('href="/specs/j2"');
  });
});

// --- a job that ran several steps belongs on all of them ---------------------

// Measured 2026-08-17 on spec 90: one job ran `analyze` and then
// `review-plan`, finished, and appeared ONLY on the review-plan line —
// because a job was placed by `steps[stepIndex]`, which is a single
// step. The analyze line was left showing an older attempt that had
// failed on `unknown spec`, so a finished analysis read as failed.
describe("a multi-step job is shown on every step it ran", () => {
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-17T12:00:00Z"),
    );
  // Since spec 108 a phase line says what the spec's own FILES say, and
  // the job's outcome qualifies it. This block is about WHICH job
  // speaks for a line, so the file side has to agree the analysis is
  // done — otherwise the line is answering a different question.
  const analysed: QueueTarget[] = [{ project: "aide", specFolder: "90-grouped", done: ["analyze"] }];
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");

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
    ], analysed);
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
    ], analysed);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "review-plan")).toContain("b-running");
  });

  // Spec 143 moved the reason itself off the phase line and into the
  // row's panel: it is a sentence, and the State column is a cell sized
  // for a word. Which STEP failed is still said on the line — that half
  // is what this test has always been about — and the sentence is said
  // once, for the row.
  test("the step that failed is marked as such; the reason is said once, on the row", () => {
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
    ], analysed);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "analyze")).not.toContain("cannot fast-forward");
    expect(subRow(html, "review-plan")).toContain("b-refused");
    expect(subRow(html, "review-plan")).not.toContain("cannot fast-forward");
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "cannot fast-forward main",
    );
    expect([...html.matchAll(/cannot fast-forward main/g)]).toHaveLength(1);
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
  /** The line the run control is on — since spec 109 a `<tr>` of its
   *  own under the header, rather than the header's last cell. */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");
  /** One phase's checkbox and its label, from the row it sits on. */
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";

  // Spec 124: a done phase is still left unticked, but the box no
  // longer MARKS it — the phase line's own State column says "done",
  // and saying it twice in two alphabets is what that spec removed.
  test("done phases are left unticked; the next one is pre-ticked (criterion 1)", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "review-plan")],
      [target("94-row-runs-it", { done: ["analyze", "review-plan"] })],
    );
    const line = runLine(html, "94-row-runs-it");
    expect(box(line, "analyze")).not.toContain("checked");
    expect(box(line, "analyze")).not.toContain('title="already done"');
    expect(box(line, "review-plan")).not.toContain("checked");
    expect(box(line, "implement")).toContain('value="implement" checked');
    expect(box(line, "archive")).not.toContain("checked");
    // Nothing is in flight, so no BOX is locked. (The stack's own
    // Approve, Cancel and Merge are disabled — there is no job to
    // approve and no branch to merge — which is spec 124's point:
    // they stand there either way.)
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(box(line, step)).not.toContain("disabled");
    }
  });

  test("with every phase done, nothing is pre-ticked", () => {
    const line = runLine(
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
    const line = runLine(rows([], [target("94-never-run")]), "94-never-run");
    expect(box(line, "analyze")).toContain('value="analyze" checked');
    expect(box(line, "review-plan")).toContain('value="review-plan" checked');
    expect(box(line, "implement")).not.toContain("checked");
    expect(box(line, "archive")).not.toContain("checked");
  });

  test("a spec that HAS run something pre-ticks only the next undone phase (criterion 1a)", () => {
    // `explore` is outside the four, so the done-set is still empty —
    // but something has run for this spec, and the pair is only for a
    // spec nothing has ever run.
    const line = runLine(rows([job("j1", "explore")], [target("94-row-runs-it")]), "94-row-runs-it");
    expect(box(line, "analyze")).toContain('value="analyze" checked');
    expect(box(line, "review-plan")).not.toContain("checked");
  });

  test("the pair never re-ticks a phase already done on disk (criterion 1b)", () => {
    // Nothing was ever queued for this spec, but its 2-analysis.md is
    // filled in: `done` is read off the files, not off job history.
    const line = runLine(rows([], [target("94-never-run", { done: ["analyze"] })]), "94-never-run");
    expect(box(line, "analyze")).not.toContain("checked");
    expect(box(line, "review-plan")).toContain('value="review-plan" checked');
  });

  // Criterion 2, as spec 105 rewrote it: the siblings lock too. The
  // rule is read off the spec — one job in flight on it, so no second
  // job from this row — not off the one step that job happens to name.
  test("a phase in flight locks every box on the row, not only its own (criterion 2)", () => {
    for (const state of ["queued", "running", "awaiting-approval"] as const) {
      const line = runLine(
        rows([job("j1", "implement", { state })], [target("94-row-runs-it")]),
        "94-row-runs-it",
      );
      for (const step of ["analyze", "review-plan", "implement", "archive"]) {
        expect(box(line, step)).toContain("disabled");
      }
    }
  });

  /** Rewritten by spec 145. While a row is busy, a box's tick stopped
   *  meaning "what a fresh press would pre-tick" and started meaning
   *  "this job named this step" — and a job names the step it is
   *  running. What the test was guarding, that nothing stale is posted
   *  back, was never the tick: it is `disabled`, which every box on a
   *  busy row still carries. */
  test("a busy phase posts nothing back, ticked or not", () => {
    const line = runLine(
      rows([job("j1", "analyze", { state: "running" })], [target("94-row-runs-it")]),
      "94-row-runs-it",
    );
    expect(box(line, "analyze")).toContain("disabled");
    // Its own job named it, so it reads as ticked — the spinner is
    // what the reader sees in its place either way (the stylesheet
    // hides a busy box's input).
    expect(box(line, "analyze")).toContain('class="phase busy"');
    // The one that is NOT in this job stays untouched by that.
    expect(box(line, "implement")).not.toContain("checked");
    expect(box(line, "implement")).toContain("disabled");
  });

  test("one form per row, posting the spec it belongs to and a box per phase (criterion 3)", () => {
    const line = runLine(rows([], [target("94-never-run")]), "94-never-run");
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
    const line = runLine(
      rows([job("j1", "analyze")], [target("94-row-runs-it", { done: ["analyze"] })]),
      "94-row-runs-it",
    );
    expect(box(line, "analyze")).toContain('name="steps" value="analyze"');
    expect(box(line, "analyze")).not.toContain("disabled");
  });

  test("'also touches' lists the other projects and never the row's own (criterion 5)", () => {
    const line = runLine(rows([], [target("94-never-run")], { projects: ["aide", "paceup"] }), "94-never-run");
    expect(line).toContain('name="extraProjects" value="paceup"');
    expect(line).not.toContain('name="extraProjects" value="aide"');
    // No script needed to exclude the row's own project: the row knows
    // which spec it is before it is drawn.
    const field = line.slice(line.indexOf('name="extraProjects"'));
    expect(field.slice(0, 200)).not.toContain("checked");
  });

  test("with only its own project there is nothing to add (criterion 5)", () => {
    const html = rows([], [target("94-never-run")], { projects: ["aide"] });
    expect(runLine(html, "94-never-run")).not.toBe("");
    expect(html).not.toContain('name="extraProjects"');
  });

  // Spec 133 took the "stop for approval between steps" box out: its
  // two states were "run straight through" and "stop after every step",
  // and the second is reached better by ticking one phase at a time.
  test("no row offers a gate control at all (spec 133, criterion 1)", () => {
    for (const projects of [["aide"], ["aide", "paceup"]]) {
      const html = rows([], [target("94-never-run")], { projects });
      expect(runLine(html, "94-never-run")).not.toBe("");
      expect(html).not.toContain('name="gate"');
      expect(html).not.toContain("data-gate");
    }
  });

  // Since spec 123 the choice is offered once per PHASE, not once per
  // row — but it is still the config that says which models exist. The
  // "default" entry is gone (2026-08-19): the select is pre-filled with
  // a real name instead.
  test("the row offers the configured models, pre-filled and nothing else", () => {
    const html = rows([], [target("94-never-run")], {
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12 }],
      defaultModels: { default: "sonnet" },
    });
    const line = subRow(html, "analyze");
    expect(line).toContain('name="model.analyze"');
    expect(line).toContain('value="fable"');
    expect(line).not.toContain('<option value="">');
    expect(line).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  test("with no model configured the row offers no dropdown at all", () => {
    const html = rows([], [target("94-never-run")]);
    expect(runLine(html, "94-never-run")).not.toBe("");
    expect(html).not.toContain('name="model"');
  });

  test("the token rides along when the page carries one", () => {
    const line = runLine(rows([], [target("94-never-run")], { token: "s3cret" }), "94-never-run");
    expect(line).toContain('name="token" value="s3cret"');
  });

  test("a phase line is read-only now — it carries no form of its own", () => {
    const html = rows([job("j1", "analyze")], [target("94-row-runs-it")]);
    for (const phase of ["create", "analyze", "review-plan", "implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("<form");
      expect(subRow(html, phase)).not.toContain("<button");
    }
  });

  // Spec 94 put the run control on the header row so folding could not
  // take it away; spec 103 retires that premise deliberately. Folding
  // is now what the run control is BEHIND: a collapsed row is a status
  // line, and the row a reader is about to act on is the one they open.
  // Since spec 109 the control opens on a line of its own beneath the
  // header, so a shut row has no such line at all.
  test("the run control belongs to the open row, and folding takes it away", () => {
    const shut = rows([], [target("94-never-run")], { filter: {} });
    expect(shut).not.toContain('<tr class="subrow');
    expect(head(shut, "94-never-run")).not.toContain('action="/api/queue"');
    expect(head(shut, "94-never-run")).not.toContain('name="steps"');

    const open = rows([], [target("94-never-run")], { filter: { open: "aide/94-never-run" } });
    const line = runLine(open, "94-never-run");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('name="steps" value="analyze"');
    // The button and the form it posts stand in the stack beside the
    // phase lines (2026-08-19) — never in the header row, which is why
    // folding takes the whole thing away.
    expect(head(open, "94-never-run")).not.toContain('action="/api/queue"');
    expect(head(open, "94-never-run")).not.toContain(">Run</button>");
    expect(line).toContain(">Run</button>");
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
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");
  /** The line the run control opens onto, under the header (spec 109). */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";

  test("a target with no jobs gets a header row and five phase lines (criterion 1)", () => {
    const html = rows([], [target("90-never-run")]);
    expect(heads(html)).toHaveLength(1);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "review-plan", "implement", "archive"]);
    for (const phase of order) expect(subRow(html, phase!)).toContain("not run yet");
  });

  test("a never-run spec's own row runs analyze (criterion 2)", () => {
    // Spec 94 moved the form off the phase line and onto the spec's own
    // row; spec 109 moved it off the header cell and onto the line the
    // row opens to. Either way it is the SPEC's control, not a phase's.
    const html = rows([], [target("90-never-run")]);
    const line = runLine(html, "90-never-run");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('name="project" value="aide"');
    expect(line).toContain('name="specFolder" value="90-never-run"');
    expect(line).toContain('name="steps" value="analyze"');
    expect(line).toContain(">Run</button>");
    expect(line).not.toContain("disabled");
    expect(subRow(html, "analyze")).not.toContain("<form");
  });

  test("a never-run spec reads 'not started' and links to its SPEC (criterion 3)", () => {
    const html = rows([], [target("90-never-run")]);
    const line = head(html, "90-never-run");
    // Hyphen in the class, space in the text: one is the filter key, the
    // other is what the reader sees.
    expect(line).toContain('<span class="badge b-idle">not started</span>');
    // It used to link to nothing — "a link to nothing is worse than no
    // link". Spec 150 gave every spec somewhere to point, so what must
    // NOT be there is a JOB link: a spec that has never run has no job.
    expect(line).toContain('href="/specs/aide/90-never-run"');
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
    expect(html.match(/<tr class="subrow/g)).toHaveLength(5);
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
    expect(html.match(/<tr class="subrow/g)).toHaveLength(5);
    for (const step of ["create", "analyze", "review-plan", "implement", "archive"]) {
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

  /** The line the phase boxes are on, under the header (spec 109). */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");

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

  // Where the mark sits, not just that it is there. Beside the model
  // picker it had no width of its own, so two lines of free text
  // stretched the name column and took the table sideways with it
  // (2026-08-20). The name cell holds the checkbox, the name and the
  // picker; state goes in the state cell.
  test("the stale mark sits in the state cell, not beside the model picker", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale", { analyzeStale: true })]);
    const line = subRow(html, "analyze");
    const nameCell = line.match(/<td class="phasecell">[\s\S]*?<\/td>/)?.[0] ?? "";
    expect(nameCell).not.toContain("description changed since");
    expect(line).toContain("description changed since");
  });

  test("the attempt count sits in the state cell too", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "analyze")],
      [target("97-tries", {})],
    );
    const line = subRow(html, "analyze");
    const nameCell = line.match(/<td class="phasecell">[\s\S]*?<\/td>/)?.[0] ?? "";
    if (line.includes("attempts")) expect(nameCell).not.toContain("attempts");
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
    const line = runLine(html, "97-stale");
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
  /** The Run form and Cancel are on the line an open row reveals under
   *  its header (spec 109); Approve and Merge stay on the header. */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";

  const FILTER = { state: "all", project: "aide", sort: "spec", dir: "desc", open: "aide/99-x" };

  test("the Run form sends every filter key (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: FILTER }), "99-x");
    for (const [key, value] of Object.entries(FILTER)) {
      expect(line).toContain(`<input type="hidden" name="view.${key}" value="${value}">`);
    }
  });

  // `project` is the collision: the Run form already posts a field of
  // that name to say WHICH spec to run, and two of them arrive as a
  // list that the enqueue refuses as "invalid project".
  test("the view's project never collides with the Run form's own (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: FILTER }), "99-x");
    expect(line).toContain(`<input type="hidden" name="project" value="aide">`);
    expect([...line.matchAll(/name="project"/g)]).toHaveLength(1);
  });

  // Nothing is sent that the view does not hold: the row is open, so
  // the Run form is there to carry the fields, and the only key set is
  // the only key posted.
  test("a key the view does not hold is not sent (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: { open: "aide/99-x" } }), "99-x");
    expect(line).toContain('<input type="hidden" name="view.open" value="aide/99-x">');
    for (const key of ["state", "project", "sort", "dir"]) {
      expect(line).not.toContain(`name="view.${key}"`);
    }
  });

  test("the Cancel form sends them too (criterion 7)", () => {
    const running = row({ id: "j1", specFolder: "99-x", state: "running" });
    // Cancel belongs to the open row — a collapsed one offers Approve
    // or Merge and nothing else (spec 103) — and since spec 109 that
    // means the line the open row reveals, not the header's own cell.
    const line = runLine(
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
    // Spec 132: the form lives in the panel, so the row is opened to
    // reach it. What it carries is unchanged.
    const html = rows([done], [target("99-x")], { filter: { state: "all", open: "aide/99-x" } });
    const form = html.match(/<form method="post" action="\/api\/queue\/j1\/merge"[\s\S]*?<\/form>/)![0];
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

// Spec 100 made the spec list the front page and dropped the nav's own
// "Specs" entry; spec 119 brought it back as one of the two tabs, at
// `/` — the front page still, and still what the wordmark points at.
// The old /specs address is linked from nowhere either way.
describe("spec 119: the list page's own tab", () => {
  test("renderQueuePage marks Specs current, points it at /, and keeps the wordmark home", () => {
    const html = renderQueuePage(
      [],
      "2026-08-18T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: true, targets: [] },
    );
    const navHtml = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
    expect(navHtml).toContain('<a class="tab" data-nav href="/" aria-current="page">Specs</a>');
    expect(html).not.toContain('href="/specs"');
    expect(html).toContain('<a class="brand" href="/">');
    // The Projects tab points wherever the caller's first entry does —
    // the served route in production, this stand-in here.
    expect(navHtml).toContain('href="projects.html"');
  });
});

// --- spec 101: one pass over the page as a whole -----------------------------

// The page was built one row-feature at a time and never looked at
// whole. Three of the six complaints are render-level: a disabled box
// that looks live, a job whose later steps read as free while it holds
// them, and an intro paragraph standing between the title and the list
// on every load.
// Spec 105 widened the rule this block is about: the lock is read off
// the SPEC's state, not off the list of steps the in-flight job happens
// to hold. A job queued as `analyze` + `review-plan` used to leave
// `implement` and `archive` tickable, which promised a press the queue
// was going to refuse anyway.
describe("spec 101: a busy job holds every step on the row (criteria 1-3)", () => {
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
  /** The line an open row reveals under its header, where the phase
   *  boxes have lived since spec 109. */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
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
    runLine(rows([r], [target("101-specs-page-ui-pass")]), "101-specs-page-ui-pass");

  test("a later step of the running job is disabled too, not only the one in flight", () => {
    const l = line(pair("running"));
    // The server would refuse a second job naming EITHER of these
    // (`clashing()` tests the whole job), so the page must not offer
    // one of them as available.
    expect(box(l, "analyze")).toContain("disabled");
    expect(box(l, "review-plan")).toContain("disabled");
  });

  // Spec 105: the step the job never named is locked too. The queue
  // refuses a second job on a spec that already has one in flight
  // (`clashing()`), whatever steps the two name — so a tickable
  // `implement` beside a running `analyze` was an offer the page could
  // not keep.
  test("a step the running job never held is locked all the same (spec 105)", () => {
    const l = line(pair("running"));
    expect(box(l, "implement")).toContain("disabled");
    expect(box(l, "archive")).toContain("disabled");
  });

  test("a queued job holds its steps before it has started any of them", () => {
    const l = line(pair("queued"));
    expect(box(l, "analyze")).toContain("disabled");
    expect(box(l, "review-plan")).toContain("disabled");
  });

  test("a queued job holds the steps it never named either (spec 105)", () => {
    const l = line(pair("queued"));
    expect(box(l, "implement")).toContain("disabled");
    expect(box(l, "archive")).toContain("disabled");
  });

  // A gate is a job in flight as much as a running one is — the queue
  // refuses a second job for it, so the row must not offer one. Nothing
  // exercised this state here before spec 105.
  test("a job parked at a gate holds every step too (spec 105)", () => {
    const l = line(pair("awaiting-approval"));
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(box(l, step)).toContain("disabled");
    }
  });

  test("a disabled box says why, on the label the pointer is over", () => {
    const l = line(pair("running"));
    expect(box(l, "analyze")).toContain('title="analyze is running"');
    // The reason is about the JOB, so the step that has not started yet
    // carries the same sentence rather than a blank one.
    expect(box(l, "review-plan")).toContain('title="analyze is running"');
  });

  test("a step the job never named carries the same reason (spec 105)", () => {
    // One sentence for the whole row: the reader is told what the SPEC
    // is doing, not which steps some job happens to list.
    expect(box(line(pair("running")), "implement")).toContain('title="analyze is running"');
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

// --- spec 121: the New-spec form is a page of its own ------------------------
//
// It was a `<details>` folded into `/` (spec 113 gave its summary the
// primary-button look). Pressing a primary button and having the page
// unfold under it read oddly, and there was no way out but pressing the
// same button again. The control is a plain link now, and the form is
// everything `/new` has on it — with a Create that goes home and a
// Cancel that goes home doing nothing.
describe("spec 121: New spec is a link, and the form is its own page", () => {
  const page = (opts: Partial<QueuePageOptions> = {}) =>
    renderQueuePage([], "2026-08-19T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [],
      createProjects: ["aide"],
      ...opts,
    });
  const newPage = (opts: Partial<NewSpecPageOptions> = {}) =>
    renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-08-19T00:00:00Z", {
      createProjects: ["aide"],
      targets: [],
      ...opts,
    });

  // Criterion 1.
  test("the front page offers a plain link, not a toggle", () => {
    const html = page();
    expect(html).toContain('<a class="btn primary" href="/new">New spec</a>');
    expect(html).not.toContain('<details class="newspec">');
    // And the form itself is gone from this page entirely — not merely
    // shut: `/new` is the only place it is rendered now.
    expect(html).not.toContain('action="/api/queue/create"');
  });

  // Criterion 2: the same emptiness rule the form itself carried — a
  // machine no project may create a spec in is offered nothing.
  test("no project to create in, no link at all", () => {
    const html = page({ createProjects: [] });
    // The markup, not the word: the stylesheet is inlined into every
    // page and its comments name the components they style.
    expect(html).not.toContain(">New spec</a>");
    expect(html).not.toContain('href="/new"');
  });

  // Criterion 3: the whole field order, and the per-project scoping
  // the chips carry so the browser can narrow them. Reworked 2026-08-19:
  // Project and Depends on share the first row, Title has a line of its
  // own, and Create/Cancel sit at the RIGHT of the Description box —
  // which in the markup means after it.
  test("the page carries Project, Depends on, Title, Description, Create, Cancel — in that order", () => {
    const html = newPage({
      targets: [
        { project: "aide", specFolder: "92-a-spec-can-depend" },
        { project: "aide-dashboard", specFolder: "01-first" },
      ],
    });
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect([needle, i > -1]).toEqual([needle, true]);
      return i;
    };
    const order = [
      '<select name="project">',
      'name="dependsOn"',
      '<input type="text" name="title"',
      '<textarea name="description"',
      "Create</button>",
      "Cancel</a>",
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The rows themselves: Project+Depends in one, Description+actions
    // in another, Title between them on its own line.
    expect(html).toMatch(/<span class="frow"><label class="field"><span>Project<\/span>/);
    expect(html).toMatch(/<span class="frow"><label class="field wide"><span>Description<\/span>/);
    expect(html).toMatch(/<span class="factions"><button[^>]*>Create<\/button>/);
    // Each chip says which project it belongs to.
    expect(html).toMatch(/data-project="aide-dashboard"[^]*?value="01-first"/);
  });

  // Criterion 5: Cancel does nothing but leave. A plain `<a href="/">`
  // is what makes "no request against /api/queue/create" true
  // structurally — there is no script for it to depend on.
  test("Cancel is a plain link home, not a button", () => {
    const html = newPage();
    expect(html).toContain('<a class="btn" href="/">Cancel</a>');
    expect(html).not.toContain('name="cancel"');
  });

  // Criterion 4. Today the toggle simply omits itself from `/` when
  // nothing may be created in — a page reachable by its own URL cannot
  // answer that way.
  test("with nothing to create in, the page says so instead of showing an empty form", () => {
    const html = newPage({ createProjects: [] });
    expect(html).not.toContain('action="/api/queue/create"');
    expect(html).toContain("No project on this machine");
  });

  test("a refusal carried back in the query string is shown above the form", () => {
    const html = newPage({ error: "no such project: nope" });
    expect(html).toContain("no such project: nope");
    expect(html.indexOf("no such project: nope")).toBeLessThan(
      html.indexOf('action="/api/queue/create"'),
    );
  });
});

describe("spec 113: the runs explanation is a popover beside the filter chips", () => {
  const page = (opts: Partial<QueuePageOptions> = {}) =>
    renderQueuePage([], "2026-08-19T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [],
      ...opts,
    });

  // Everything the rows renderer puts out ahead of the table — which is
  // the filter bar and nothing else.
  const beforeTable = (html: string) => html.slice(0, html.indexOf('<table class="list">'));

  test("the popover stays inside the refreshed rows before the New-spec link", () => {
    const html = page({ createProjects: ["aide"] });
    // The only `.intro` disclosure left on this page is inside the
    // refreshed rows container, immediately before the New-spec link.
    expect(html.indexOf('<details class="intro">')).toBeGreaterThan(html.indexOf('id="jobrows"'));
    expect(html.indexOf('<details class="intro">')).toBeLessThan(html.indexOf('href="/new"'));
  });

  test("the runner-unavailable notice still needs no click", () => {
    const html = page({ runnerAvailable: false });
    expect(html).toContain("No runner is installed");
    // "nothing here spends money" is safety-relevant context and must
    // not need a click.
    expect(html.indexOf("No runner is installed")).toBeLessThan(
      html.indexOf('<details class="intro">'),
    );
  });

  test("the popover sits in the filter bar when only one project has specs", () => {
    const bar = beforeTable(renderQueueRows([row()], { runnerAvailable: true, targets: [] }));
    expect(bar).toContain('<details class="intro">');
    expect(bar).toContain(">?</summary>");
  });

  test("it sits there with several projects too, after the chips", () => {
    const bar = beforeTable(
      renderQueueRows([row(), row({ id: "job-2", project: "atlasaurus", specFolder: "12-other" })], {
        runnerAvailable: true,
        targets: [],
      }),
    );
    expect(bar).toContain("Project");
    expect(bar.indexOf('<details class="intro">')).toBeGreaterThan(bar.indexOf("Project"));
  });

  test("the copy still says what happens to a job that hits a cap", () => {
    const bar = beforeTable(renderQueueRows([row()], { runnerAvailable: true, targets: [] }));
    expect(bar).toContain("<em>stopped</em>");
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
    // The THIRD cell: name, progress, state (the action cell went back
    // to the end of the row, 2026-08-19).
    const state = head.split("<td")[3] ?? "";
    return state.match(/<div class="muted small">([\s\S]*?)<\/div>\s*<\/td>/)?.[1] ?? "";
  };
  /** Spec 132: the FIRST line — the badge itself. Once nothing is
   *  running it carries the whole sentence, and `hint` above is empty.
   *  The dot comes off first: it is the badge's live mark, not a word. */
  const chip = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = (head.split("<td")[3] ?? "").replace(/<span class="dot"[^>]*><\/span>/g, "");
    return state.match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
  };

  test("a spec nothing has run says what the next click is", () => {
    const text = hint(rows([], [target("101-never-run")]));
    expect(text).toContain("Run");
  });

  // In flight the sentence says nothing (asked for 2026-08-19): the
  // chip itself reads "analyzing" and the running phase line says the
  // rest — "analyze running — review to follow" was the same fact a
  // third time.
  test("a running job's chip carries the phase word; the sentence stays empty", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze", "review-plan"], stepIndex: 0, state: "running" })],
      [target("101-a")],
    );
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)![0];
    expect(head).toContain(">analyzing<");
    expect(head).not.toContain("to follow");
    expect(hint(html)).toBe("");
  });

  test("review-plan in flight gerunds from the reader's word: reviewing", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze", "review-plan"], stepIndex: 1, state: "running" })],
      [target("101-a")],
    );
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)![0];
    expect(head).toContain(">reviewing<");
    expect(head).not.toContain("review-planing");
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

  // Spec 132: the sentence moved up into the badge, and it names WHICH
  // repo — the distinction spec 96 put on the button, kept on the row.
  test("a finished spec with a branch still out says so in the badge, and names it", () => {
    const html = rows(
      [
        row({
          specFolder: "101-a",
          state: "done",
          branchUrls: [{ label: "aide", url: "https://example.test/aide", merged: false }],
        }),
      ],
      [target("101-a")],
    );
    expect(chip(html)).toBe("ready to merge the code");
    expect(hint(html)).toBe("");
  });

  // Spec 111: the fixture had no `done` at all, which under spec 111's
  // rule means "nothing has happened yet" — the opposite of what the
  // test's own name claims. It passed only because the sentence never
  // read the files. Every phase is named here, so "nothing left out"
  // is what the fixture actually says.
  test("a finished spec with nothing left out does not ask for a merge", () => {
    const html = rows(
      [row({ specFolder: "101-a", state: "done" })],
      [target("101-a", { done: ["analyze", "review-plan", "implement", "archive"] })],
    );
    expect(chip(html)).toBe("done — nothing waiting on you");
    expect(chip(html).toLowerCase()).not.toContain("merge");
    expect(hint(html)).toBe("");
  });

  // --- spec 111: the sentence names the next phase, not "nothing waiting" ---

  // "done" is the JOB's state and is correct for the job. What the
  // sentence beneath it used to say — nothing is waiting on you — was a
  // claim about the SPEC, and the spec's own files already knew better.
  // Same rule as spec 108: the files say what has happened.
  test("a spec whose plan is done but not implemented is ready for implement", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["review-plan"], state: "done" })],
      [target("101-a", { done: ["analyze", "review-plan"] })],
    );
    expect(chip(html)).toBe("ready for implement");
    expect(chip(html)).not.toBe("done");
    expect(hint(html)).toBe("");
  });

  test("the next phase is named the way a reader sees it, not by its step name", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("ready for review");
    expect(chip(html)).not.toContain("review-plan");
  });

  test("a spec with only archive left says so", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["implement"], state: "done" })],
      [target("101-a", { done: ["analyze", "review-plan", "implement"] })],
    );
    expect(chip(html)).toBe("ready for archive");
  });

  // Precedence is the whole of the risk here: merging first still
  // outranks starting the next phase, exactly as before.
  test("an unmerged branch still outranks the phase that is ready", () => {
    const html = rows(
      [
        row({
          specFolder: "101-a",
          steps: ["review-plan"],
          state: "done",
          branchUrls: [{ label: "aide", url: "https://example.test/aide", merged: false }],
        }),
      ],
      [target("101-a", { done: ["analyze", "review-plan"] })],
    );
    expect(chip(html)).toBe("ready to merge the code");
    expect(chip(html)).not.toContain("ready for");
    expect(hint(html)).toBe("");
  });

  test("a spec with every phase behind it still says nothing is waiting", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { done: ["analyze", "review-plan", "implement", "archive"] })],
    );
    expect(chip(html)).toBe("done — nothing waiting on you");
    expect(hint(html)).toBe("");
  });

  // The bug as reported, on spec 108, 2026-08-19: the plan run finished,
  // its branch was merged, and the row said nothing waited on a reader
  // while implement had never been started.
  test("a merged plan branch with implement still to run says implement is ready", () => {
    const html = rows(
      [
        row({
          specFolder: "101-a",
          steps: ["review-plan"],
          state: "done",
          branchUrls: [{ label: "aide", url: "https://example.test/aide", merged: true }],
        }),
      ],
      [target("101-a", { done: ["analyze", "review-plan"] })],
    );
    expect(chip(html)).toBe("ready for implement");
    expect(chip(html)).not.toContain("nothing waiting on you");
  });

  // A run that stopped short has better wording of its own — it says
  // why, and what to press. "ready for X" must not widen into it.
  test("a job that stopped short keeps its retry wording, whatever the files say", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const text = hint(
        rows(
          [row({ specFolder: "101-a", steps: ["implement"], state })],
          [target("101-a", { done: ["analyze", "review-plan"] })],
        ),
      );
      expect(text).toBe("press Run to try implement again");
    }
  });

  // Spec 108: archive is the one phase whose "done" the job's own exit
  // status cannot answer, so the sentence reads the file instead.
  test("a spec whose archive run declined says so instead of 'done'", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    // Spec 143: the badge keeps the WORD — it is `nowrap`, and the
    // reason is a sentence — and the row's panel says the reason.
    expect(chip(html)).toBe("archive held back");
    expect(chip(html)).not.toContain("nothing waiting on you");
    // Once, not twice: the badge says it, so the line below has nothing
    // left to add (spec 132).
    expect(hint(html)).toBe("");
    expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "archive held back — the Slack webhook",
    );
  });

  // Spec 132, criterion 11 said the file's reason on the line below the
  // badge for the four states that stopped short. Spec 143 took it to
  // the row's panel instead — the same sentence, the same four states,
  // in the one place on the row that has the width for it. The line
  // below goes back to saying what to press.
  test("a run that stopped short says the held-back reason in the row's panel", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ specFolder: "101-a", steps: ["archive"], state })],
        [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
      );
      expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
        "archive held back — the Slack webhook",
      );
      expect(hint(html)).toBe("press Run to try archive again");
      expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    }
  });

  test("a run in flight outranks a stale held-back note from an earlier one", () => {
    const text = hint(
      rows(
        [row({ specFolder: "101-a", steps: ["archive"], state: "running" })],
        [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
      ),
    );
    // The sentence is empty in flight; what must not happen is the
    // stale note upstaging the retry.
    expect(text).not.toContain("held back");
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


// --- spec 132: the first line says what is happening, or what is next --------
//
// One rule for the badge, whatever the row is doing: a verb while
// something runs, and the resting state plus the next move when nothing
// does. `done` and `queued` were the two words that carried neither —
// `done` because the sentence disambiguating it sat one line lower, and
// `queued` because nothing said WHICH step was waiting.

describe("spec 132: the State line says what is happening, or what is next", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-20T12:00:00Z"),
    );
  const chip = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = (head.split("<td")[3] ?? "").replace(/<span class="dot"[^>]*><\/span>/g, "");
    return state.match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
  };
  const actionCell = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = [...head.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[cells.length - 1] ?? "";
  };
  const at = (label: string) => ({ label, url: `https://example.test/${label}`, merged: false });
  const done = (branchUrls: { label: string; url: string; merged: boolean }[]) =>
    row({ id: "j1", specFolder: "132-a", steps: ["implement"], state: "done", branchUrls });

  // Criteria 3, 4: what spec 96 put on the button — WHICH of the two
  // repos a press would land — said as a resting state instead. Losing
  // the distinction would rebuild the problem 96 fixed.
  test("only the project's own branch open reads: ready to merge the code", () => {
    expect(chip(rows([done([at("aide")])], [target("132-a")]))).toBe("ready to merge the code");
  });

  test("only the specs repo's branch open reads: ready to merge the plan", () => {
    expect(chip(rows([done([at("aide-specs")])], [target("132-a")]))).toBe("ready to merge the plan");
  });

  test("both open reads: ready to merge plan and code", () => {
    const html = rows([done([at("aide"), at("aide-specs")])], [target("132-a")]);
    expect(chip(html)).toBe("ready to merge plan and code");
  });

  // Criterion 10: the per-repo badge in the Affected-repos line is a
  // different piece of markup with the same three words in it. The two
  // must not be conflated — this reads the branch line, not the State
  // cell.
  test("the per-repo badge in the branch line keeps its own bare wording", () => {
    const html = rows([done([at("aide")])], [target("132-a")]);
    const branchLine = html.match(/<span class="branchlist">[\s\S]*?<\/span><\/span>/)?.[0] ?? "";
    expect(branchLine).toContain(">ready to merge<");
    expect(branchLine).not.toContain("ready to merge the code");
  });

  // Criteria 8, 9: a queued row said one word and nothing else, while
  // the step it was waiting to run was known all along.
  test("a queued job names the step it is waiting to run", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "132-a", steps: ["implement"], stepIndex: 0, state: "queued" })],
      [target("132-a")],
    );
    expect(chip(html)).toBe("implementing queued");
  });

  test("a queued review-plan gerunds from the reader's word, as the running one does", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "132-a", steps: ["analyze", "review-plan"], stepIndex: 1, state: "queued" })],
      [target("132-a")],
    );
    expect(chip(html)).toBe("reviewing queued");
    expect(html).not.toContain("review-planing");
  });

  // Criterion 1: the one action that used to live outside the panel.
  test("a row whose only offer was Merge now has an empty action cell", () => {
    const cell = actionCell(rows([done([at("aide")])], [target("132-a")]));
    expect(cell).not.toContain("<form");
    expect(cell).not.toContain("/merge");
    expect(cell).not.toContain("<button");
  });

  // Criterion 2: whatever is open, the button in the panel is one word.
  // What it will land is on the row, in the badge, with no button on it.
  test("the panel's Merge button is one word, whatever it would land", () => {
    for (const branches of [[at("aide")], [at("aide-specs")], [at("aide"), at("aide-specs")]]) {
      const html = rows([done(branches)], [target("132-a")], { filter: { open: "aide/132-a" } });
      const form = html.match(/<form method="post" action="\/api\/queue\/j1\/merge"[\s\S]*?<\/form>/)?.[0] ?? "";
      expect(form).toContain(">Merge</button>");
      expect(form).not.toContain("Merge the");
    }
  });

  // Spec 135 took the last label branch out too: a refused merge is the
  // same decision, and the button says the same verb for it. That a
  // merge was refused is the row's to say, on its State line.
  test("a refused merge still says Merge, and nothing about the refusal", () => {
    const html = rows([done([at("aide")])], [target("132-a")], {
      filter: { open: "aide/132-a" },
      error: "cannot merge — conflict",
      errorSpec: "aide/132-a",
    });
    const form = html.match(/<form method="post" action="\/api\/queue\/j1\/merge"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toContain(">Merge</button>");
    expect(form).not.toContain("Merge again");
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
  /** The row's own controls line: since spec 109 the run form and
   *  Cancel are a `<tr>` under the header, not a cell inside it. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's buttons are. An OPEN row stacks them in the cell
   *  that leads its phase lines (`stackcell`, spanning them all); a
   *  SHUT row offers its one action in the header's LAST cell. Takes
   *  the whole row group, since the two live on different lines
   *  (2026-08-19 — spec 124's leading COLUMN pushed the table
   *  sideways and was taken back out). */
  const actionCell = (chunk: string) => {
    const stack = chunk.match(/<td class="stackcell"[^>]*>([\s\S]*?)<\/td>/)?.[1];
    if (stack !== undefined) return stack;
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[cells.length - 1] ?? "";
  };

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
    // Spec 132: the badge says the resting state and what is next, so a
    // spec whose files say nothing has run reads "ready for analyze".
    expect(line).toContain('class="badge b-ready"');
    expect(line).toContain("ready for analyze");
    expect(line).toContain('class="pips"');
    expect(line).toContain("$1.50");
  });

  test("a gated collapsed row offers Approve, and only Approve (criterion 2)", () => {
    const cell = actionCell(
      controlsLine(
        rows([row({ id: "j1", specFolder: "103-gated", state: "awaiting-approval" })],
             [target("103-gated")]),
        "103-gated",
      ),
    );
    expect(cell).toContain('action="/api/queue/j1/approve"');
    expect(cell).not.toContain('action="/api/queue/j1/cancel"');
    expect(cell.match(/<form/g)).toHaveLength(1);
  });

  // Spec 132 took Merge back out of the row: the State column already
  // says "ready to merge the code", and acting means opening the panel,
  // the same as every other action a collapsed row does not draw.
  test("a collapsed row with an unmerged branch offers no Merge at all (spec 132)", () => {
    const cell = actionCell(
      controlsLine(
        rows(
          [row({ id: "j1", specFolder: "103-merge", state: "done",
                 branchUrls: [{ label: "aide", url: "https://example.test/c", merged: false }] })],
          [target("103-merge")],
        ),
        "103-merge",
      ),
    );
    expect(cell).not.toContain("/merge");
    expect(cell).not.toContain("<form");
    expect(cell).not.toContain("<button");
  });

  test("a running collapsed row offers nothing — Cancel is one click away (criterion 4)", () => {
    const cell = actionCell(
      controlsLine(rows([row({ id: "j1", specFolder: "103-busy", state: "running" })], [target("103-busy")]),
           "103-busy"),
    );
    expect(cell).not.toContain("<form");
  });

  // Spec 105, criterion 1b: the branch a previous job left behind does
  // not make a busy row actionable. Merge while a step is still writing
  // to that very branch is the press the queue refuses — the collapsed
  // row offers it no more than the open one does. Cancel stays where
  // spec 103 put it: one click away, by opening the row.
  test("a busy collapsed row with an unmerged branch offers no Merge either (spec 105)", () => {
    for (const state of ["queued", "running"] as const) {
      const cell = actionCell(
        controlsLine(
          rows(
            [row({ id: "j1", specFolder: "103-busy-branch", state,
                   branchUrls: [{ label: "aide", url: "https://example.test/c", merged: false }] })],
            [target("103-busy-branch")],
          ),
          "103-busy-branch",
        ),
      );
      expect(cell).not.toContain("<form");
      expect(cell).not.toContain("mergeform");
      expect(cell).not.toContain("/merge");
    }
  });

  // The gated case is spec 103's, unchanged by 105: Approve is the one
  // thing a gate needs, and an unmerged branch does not add a second.
  test("a gated collapsed row with an unmerged branch still offers Approve alone (spec 105)", () => {
    const cell = actionCell(
      controlsLine(
        rows(
          [row({ id: "j1", specFolder: "103-gated-branch", state: "awaiting-approval",
                 branchUrls: [{ label: "aide", url: "https://example.test/c", merged: false }] })],
          [target("103-gated-branch")],
        ),
        "103-gated-branch",
      ),
    );
    expect(cell).toContain('action="/api/queue/j1/approve"');
    expect(cell.match(/<form/g)).toHaveLength(1);
  });

  test("a collapsed row with nothing pending has an empty action cell (criterion 4)", () => {
    const cell = actionCell(controlsLine(rows([], [target("103-idle")]), "103-idle"));
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
    const line = controlsLine(html, "103-idle");
    expect(line).toContain('<form id="rowrun-aide/103-idle" method="post" action="/api/queue"');
    expect(line).toContain('name="steps" value="analyze"');
    expect(line).toContain(">Run</button>");
    expect(line).toContain('name="extraProjects" value="paceup"');
    // Run and the rarely-set field are in the header's own action
    // cell since spec 124; the boxes are on the phase lines below it.
    expect(actionCell(controlsLine(html, "103-idle"))).toContain(">Run</button>");
    expect(
      html.match(/<tr class="subrow[^"]*"[^>]*data-step="analyze">[\s\S]*?<\/tr>/)![0],
    ).toContain('name="steps" value="analyze"');
    // The model went with the rest of them, onto the phase lines it
    // belongs to (spec 123) — still revealed by opening, one per phase.
    expect(html).toContain('name="model.analyze"');
    // Five phase lines, plus the caption line above them.
    expect(html.match(/<tr class="subrow/g)).toHaveLength(6);
  });

  test("an expanded row's forms carry the open key forward (criterion 6)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "103-gated", state: "awaiting-approval" })],
      [target("103-gated")],
      open("103-gated"),
    );
    // The stack, on the line it leads — an open row's buttons are not
    // in the header cell any more (2026-08-19).
    const line = controlsLine(html, "103-gated");
    expect(line).toContain('<input type="hidden" name="view.open" value="aide/103-gated">');
    const approve = line.match(/<form method="post" action="\/api\/queue\/j1\/approve"[^>]*>[\s\S]*?<\/form>/)![0];
    expect(approve).toContain('name="view.open" value="aide/103-gated"');
    // And Cancel is back — on the controls line the open row reveals
    // (spec 109), carrying the same key.
    const cancel = controlsLine(html, "103-gated").match(
      /<form method="post" action="\/api\/queue\/j1\/cancel"[^>]*>.*?<\/form>/,
    )![0];
    expect(cancel).toContain('name="view.open" value="aide/103-gated"');
  });

  test("the rarely-set fields end the action stack, on no line of their own (criterion 10)", () => {
    const html = rows([], [target("103-idle")], {
      ...open("103-idle"),
      projects: ["aide", "paceup"],
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    expect(head(html, "103-idle")).not.toContain('class="more"');
    // Spec 124: the line they shared is gone. They sit at the end of
    // the header cell's own stack, still one click from nowhere.
    const cell = actionCell(controlsLine(html, "103-idle"));
    expect(cell).toContain('<span class="stack">');
    expect(cell).toContain('<span class="row extra">');
    expect(cell.indexOf('class="row extra"')).toBeGreaterThan(cell.indexOf(">Run</button>"));
    expect(html).not.toContain("data-controls");
  });

  test("no 'more' disclosure survives, open or shut (criterion 10)", () => {
    for (const html of [
      rows([], [target("103-idle")], { projects: ["aide", "paceup"] }),
      rows([], [target("103-idle")], {
        ...open("103-idle"),
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
      }),
    ]) {
      // Scoped to the list: the "?" popover above it is a `<details>`
      // of its own (spec 113), about how runs work, not about a row.
      const table = html.match(/<table class="list">[\s\S]*<\/table>/)?.[0] ?? "";
      expect(table).not.toBe("");
      expect(table).not.toContain("data-more");
      expect(table).not.toContain('class="more"');
      expect(table).not.toContain("<summary");
    }
  });

  // The model and the also-touches chips left the action cell, so
  // they are no longer INSIDE the form they submit with — they are
  // written after its closing tag, on the same line. The `form`
  // attribute is what carries them back — an id that drifts from the
  // form's own silently runs the job with the defaults instead.
  test("the moved fields submit with the row's own Run form (criterion 10)", () => {
    const html = rows([], [target("103-idle")], {
      ...open("103-idle"),
      projects: ["aide", "paceup"],
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    const line = controlsLine(html, "103-idle");
    const id = line.match(/<form id="([^"]+)"/)![1];
    const after = line.slice(line.indexOf("</form>"));
    const fields = [...after.matchAll(/<(?:select|input)\b[^>]*name="extraProjects"[^>]*>/g)];
    expect(fields.length).toBe(1);
    // The phase boxes reach it the same way since spec 124 — they are
    // on lines of their own, further from the form than the fields are.
    for (const b of line.matchAll(/<input type="checkbox" name="steps"[^>]*>/g)) {
      expect(b[0]).toContain(`form="${id}"`);
    }
    for (const f of fields) expect(f[0]).toContain(`form="${id}"`);
    // The model left this line for the phase lines (spec 123) and is
    // even further from its form there — the same attribute is the only
    // thing carrying it back.
    for (const sel of html.matchAll(/<select\b[^>]*name="model\.[^"]*"[^>]*>/g)) {
      expect(sel[0]).toContain(`form="${id}"`);
    }
  });
});

// --- spec 105: while a spec is busy, its row offers Cancel and nothing else ---

// The row's controls used to be governed step by step: spec 101
// disabled the boxes the in-flight job named, and everything else on
// the row stayed live. Seen on 2026-08-19 on spec 103 — `implement`
// running, its spinner up, and the other three phase boxes still
// tickable, "more" still setting a model for a job that could not be
// started, and a second Run one press away. The queue refuses that
// press ("already running on this spec"), so the row was promising
// what the page could not keep.
//
// ONE rule, read off the SPEC's state: while any job is in flight —
// queued, running, or parked at a gate — the row offers exactly what
// that state allows. Every test here is about an OPENED row, because
// a collapsed one has no phase box, no model and no Run to lock in the
// first place (its narrower promise is in the spec 103 block above).
describe("spec 105: a busy row offers only what its state allows", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  /** The line an open row reveals under its header: since spec 109 the
   *  phase boxes, Run and Cancel are here, never in the header's cell —
   *  and since spec 117 the model and "also touches" too. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's buttons are. An OPEN row stacks them in the cell
   *  that leads its phase lines (`stackcell`, spanning them all); a
   *  SHUT row offers its one action in the header's LAST cell. Takes
   *  the whole row group, since the two live on different lines
   *  (2026-08-19 — spec 124's leading COLUMN pushed the table
   *  sideways and was taken back out). */
  const actionCell = (chunk: string) => {
    const stack = chunk.match(/<td class="stackcell"[^>]*>([\s\S]*?)<\/td>/)?.[1];
    if (stack !== undefined) return stack;
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[cells.length - 1] ?? "";
  };
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";
  /** The Run button itself, with whatever attributes it carries. */
  const runBtn = (line: string) => line.match(/<button [^>]*>(?:<[^>]*>)*Run(?: again)?<\/button>/)?.[0] ?? "";

  /** A spec with a job in the given state AND a branch an earlier job
   *  left unmerged — the shape that makes "and nothing else" testable:
   *  there is something to merge, and the row must still not offer it. */
  const spec = (state: QueueRowView["state"], folder = "105-busy") =>
    row({
      id: "j1",
      specFolder: folder,
      steps: ["implement"],
      stepIndex: 0,
      state,
      branchUrls: [{ label: "aide", url: "https://example.test/c", merged: false }],
    });

  /** The same open row's controls line — where every lockable control
   *  on it lives (spec 109). */
  const openControls = (r: QueueRowView, folder = "105-busy") =>
    controlsLine(rows([r], [target(folder)]), folder);

  // --- criterion 1: running or queued, Cancel and only Cancel ---------------

  /** One button of the action stack, from its own form. */
  const control = (cell: string, verb: string) =>
    cell.match(new RegExp(`<form method="post" action="/api/queue/j1/${verb}"[\\s\\S]*?</form>`))?.[0] ?? "";

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec's opened row offers Cancel, and nothing else it can press (criterion 1)`, () => {
      // Since spec 124 the buttons never come and go — a row's stack is
      // the same buttons throughout, and its STATE says which of them
      // will take a click. Cancel is the only one here that will.
      const cell = actionCell(openControls(spec(state)));
      expect(control(cell, "cancel")).not.toContain("disabled");
      expect(control(cell, "approve")).toContain("disabled");
      // The branch is unmerged and Merge still cannot be pressed:
      // merging mid-job means cancelling the job first.
      expect(control(cell, "merge")).toContain("disabled");
      expect(control(cell, "merge")).toContain(`title="implement is ${state === "running" ? "running" : "queued"}"`);
    });
  }

  // --- criterion 2: every phase box locks, with the reason on it -------------

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec locks every phase box, not the ones its job named (criterion 2)`, () => {
      const line = openControls(spec(state));
      for (const step of ["analyze", "review-plan", "implement", "archive"]) {
        expect(box(line, step)).toContain("disabled");
        expect(box(line, step)).toContain(`title="implement is ${state === "running" ? "running" : "queued"}"`);
      }
    });
  }

  test("the step being worked carries the spinner; the rest keep their own look (criterion 2)", () => {
    const line = openControls(spec("running"));
    expect(box(line, "implement")).toContain('class="phase busy"');
    // Not part of this job, so unticked — inert, but not padlocked
    // (spec 145): the padlock is for a control with nothing else on it
    // to say why it will not take a click.
    expect(box(line, "analyze")).toContain('class="phase default"');
    expect(box(line, "analyze")).not.toContain(ICON_LOCK);
  });

  test("a queued job spins nothing — its own step still reads as ticked (criterion 2)", () => {
    const line = openControls(spec("queued"));
    // The job named `implement` and nothing else. Queued is not yet
    // running, so no box spins — but the tick that was made before Run
    // was pressed is still what the row says (spec 145).
    expect(box(line, "implement")).toContain('class="phase checked"');
    for (const step of ["analyze", "review-plan", "archive"]) {
      expect(box(line, step)).toContain('class="phase default"');
    }
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(box(line, step)).not.toContain('class="phase off"');
      expect(box(line, step)).not.toContain(ICON_LOCK);
    }
  });

  /** Spec 145's own case, and spec 142's measurement: all four steps
   *  ticked and started as one job, with three of them not reached yet.
   *  The three said nothing about belonging to the running job — they
   *  were drawn exactly like a step the job never named. */
  test("a step queued behind the running one stays ticked, without the padlock (criterion 2)", () => {
    const line = openControls(
      row({
        id: "j1",
        specFolder: "105-busy",
        steps: ["analyze", "review-plan", "implement", "archive"],
        stepIndex: 0,
        state: "running",
      }),
    );
    // The one being worked, in the same job — its spinner is untouched.
    expect(box(line, "analyze")).toContain('class="phase busy"');
    for (const step of ["review-plan", "implement", "archive"]) {
      const b = box(line, step);
      expect(b).toContain(`value="${step}" checked`);
      expect(b).toContain("disabled");
      expect(b).toContain('class="phase checked"');
      expect(b).not.toContain('class="phase off"');
      expect(b).not.toContain(ICON_LOCK);
    }
  });

  // --- criterion 3: Run, the model and the "more" fields lock too ------------

  test("the Run button is disabled while the spec is busy, and says why (criterion 3)", () => {
    const run = runBtn(openControls(spec("running")));
    expect(run).toContain("disabled");
    expect(run).toContain('title="implement is running"');
    // The old title told the reader to do the exact thing this rule
    // removes; it must not survive anywhere on the row.
    expect(run).not.toContain("tick a phase it does not hold");
  });

  test("the model select and 'also touches' both lock (criterion 3)", () => {
    const html = rows([spec("running")], [target("105-busy")]);
    const line = controlsLine(html, "105-busy");
    // The model select is on the phase lines since spec 123; the rule
    // it obeys is this one, unchanged.
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).toContain("disabled");
    expect(line.match(/<input type="checkbox" name="extraProjects"[^>]*>/)![0]).toContain("disabled");
  });

  // There is no disclosure left to carry the reason on a summary, so
  // each of them says it itself — which is where the promise always
  // actually lived.
  test("each locked field carries the same reason (criterion 3)", () => {
    const html = rows([spec("running")], [target("105-busy")]);
    const line = controlsLine(html, "105-busy");
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).toContain(
      'title="implement is running"',
    );
    const chip = line.match(/<label class="phase[^"]*" data-project="[^"]*"[^>]*>/)![0];
    expect(chip).toContain('title="implement is running"');
  });

  // --- criterion 4: a gate offers Approve and Cancel, and locks the rest -----

  test("a gated spec's opened row offers Approve and Cancel, and no pressable Merge (criterion 4)", () => {
    // Both are one click away in the row's own stack (spec 124), and
    // Merge stands with them, unpressable and saying why.
    const cell = actionCell(openControls(spec("awaiting-approval")));
    expect(control(cell, "approve")).not.toContain("disabled");
    expect(control(cell, "cancel")).not.toContain("disabled");
    expect(control(cell, "merge")).toContain("disabled");
    expect(control(cell, "merge")).toContain('title="implement is waiting for approval"');
  });

  test("a gated spec locks the boxes, the model and Run exactly as a running one does (criterion 4)", () => {
    const html = rows([spec("awaiting-approval")], [target("105-busy")]);
    const line = controlsLine(html, "105-busy");
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(box(line, step)).toContain("disabled");
      expect(box(line, step)).toContain('title="implement is waiting for approval"');
    }
    expect(runBtn(line)).toContain("disabled");
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).toContain("disabled");
  });

  // --- criterion 5: a settled spec is the ordinary row it always was ---------

  for (const state of ["done", "failed", "stopped", "cancelled", "interrupted"] as const) {
    test(`a ${state} spec's row is fully interactive again, Merge included (criterion 5)`, () => {
      const html = rows([spec(state)], [target("105-busy")]);
      const line = controlsLine(html, "105-busy");
      for (const step of ["analyze", "review-plan", "implement", "archive"]) {
        expect(box(line, step)).not.toContain("disabled");
      }
      expect(runBtn(line)).not.toContain("disabled");
      expect(actionCell(controlsLine(html, "105-busy"))).toContain('action="/api/queue/j1/merge"');
      expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).not.toContain("disabled");
      expect(line.match(/<input type="checkbox" name="extraProjects"[^>]*>/)![0]).not.toContain(
        "disabled",
      );
    });
  }

  test("a spec with no job at all is untouched by the rule (criterion 5)", () => {
    const html = rows([], [target("105-never-run")]);
    const line = controlsLine(html, "105-never-run");
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(box(line, step)).not.toContain("disabled");
    }
    expect(runBtn(line)).not.toContain("disabled");
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).not.toContain("disabled");
  });

  // Merge belongs to work that is finished; it comes back the moment
  // the job settles, so the rule takes nothing away permanently.
  test("Merge becomes pressable as soon as the spec stops being busy (criterion 5)", () => {
    expect(control(actionCell(openControls(spec("running"))), "merge")).toContain("disabled");
    expect(control(actionCell(openControls(spec("done"))), "merge")).not.toContain("disabled");
  });
});

// --- spec 109: an expanded row reveals its controls BELOW the header ---------

// Opening a row used to pile the run form, the Approve/Cancel form and
// the Merge button into the header's action cell, on top of whatever
// that cell already offered while shut. The cell has no width of its
// own, so it wrapped — and the header line the reader was scanning
// moved down at the moment they acted on it.
//
// The header is the SAME line now, open or shut: its action cell always
// draws what a collapsed row draws. What opening reveals is a
// full-width row beneath it — the phase boxes, Run, and Cancel — built
// the way the phase lines already are, because a full-width row cannot
// widen a column it is not inside.
describe("spec 109: an expanded row reveals its controls below the header line", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const open = (folder: string) => ({ filter: { open: `aide/${folder}` } });

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The line this spec adds: an open row's controls, under the header
   *  rather than inside it — everything an open row offers, since spec
   *  117 folded the rarely-set fields onto it too. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's buttons are. An OPEN row stacks them in the cell
   *  that leads its phase lines (`stackcell`, spanning them all); a
   *  SHUT row offers its one action in the header's LAST cell. Takes
   *  the whole row group, since the two live on different lines
   *  (2026-08-19 — spec 124's leading COLUMN pushed the table
   *  sideways and was taken back out). */
  const actionCell = (chunk: string) => {
    const stack = chunk.match(/<td class="stackcell"[^>]*>([\s\S]*?)<\/td>/)?.[1];
    if (stack !== undefined) return stack;
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[cells.length - 1] ?? "";
  };

  const branch = [{ label: "aide", url: "https://example.test/c", merged: false }];

  /** The two things a header row is ALLOWED to differ by, removed before
   *  the two renders are compared:
   *  1. the fold control itself, which exists to say which way it points
   *     (its class, `aria-expanded`, its title and the `?open=` it links to)
   *  2. the hidden `view.open` a form carries so pressing it keeps the
   *     reader's filter — a field with no width, and one a COLLAPSED row
   *     grows too the moment some OTHER row on the page is opened.
   *  What is left is every visible byte of the line, which is what "the
   *  header never changes when a row is expanded" is about. */
  /** ...and the ACTION CELL, the row's LAST: a shut row offers the one
   *  thing the spec waits on there, an open row offers its whole stack
   *  beside the phase lines instead, so that one cell is deliberately
   *  different open and shut. What must still hold is everything a
   *  reader scans — name, pips, state, started, cost — and it is the
   *  rest of the line that says so. */
  const stable = (line: string) =>
    line
      .replace(/<a class="fold[\s\S]*?<\/a>/, "")
      .replace(/<input type="hidden" name="view\.open"[^>]*>/g, "")
      .replace(/<td[^>]*>[\s\S]*?<\/td><\/tr>$/, "");

  const shutAndOpen = (list: QueueRowView[], targets: QueueTarget[], folder: string) => {
    const shut = stable(head(rows(list, targets), folder));
    const opened = stable(head(rows(list, targets, open(folder)), folder));
    expect(shut).not.toBe("");
    expect(opened).not.toBe("");
    return { shut, opened };
  };

  // --- criterion 1: the header line is the same line, open or shut ----------

  test("an idle spec's header row is byte-identical open or shut (criterion 1)", () => {
    const { shut, opened } = shutAndOpen([], [target("109-idle", { title: "Held still", percent: 50 })], "109-idle");
    expect(opened).toBe(shut);
  });

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec's header row is byte-identical open or shut (criterion 1)`, () => {
      const { shut, opened } = shutAndOpen(
        [row({ id: "j1", specFolder: "109-busy", state, branchUrls: branch })],
        [target("109-busy")],
        "109-busy",
      );
      expect(opened).toBe(shut);
    });
  }

  test("a gated spec's header row is byte-identical open or shut (criterion 1)", () => {
    const { shut, opened } = shutAndOpen(
      [row({ id: "j1", specFolder: "109-gated", state: "awaiting-approval" })],
      [target("109-gated")],
      "109-gated",
    );
    expect(opened).toBe(shut);
  });

  test("a settled spec with an unmerged branch keeps its header line too (criterion 1)", () => {
    const { shut, opened } = shutAndOpen(
      [row({ id: "j1", specFolder: "109-merge", state: "done", branchUrls: branch })],
      [target("109-merge")],
      "109-merge",
    );
    expect(opened).toBe(shut);
  });

  // --- criterion 2: what opening actually reveals ---------------------------

  test("an opened idle row reveals its phase lines, and the stack in its own cell (criterion 2)", () => {
    const html = rows([], [target("109-idle")], open("109-idle"));
    const line = controlsLine(html, "109-idle");
    expect(line).toContain('name="steps" value="analyze"');
    // Spec 124: Run and the form it posts are in the header's action
    // cell; the boxes it posts are on the phase lines under it.
    const cell = actionCell(controlsLine(html, "109-idle"));
    expect(cell).toContain('<form id="rowrun-aide/109-idle" method="post" action="/api/queue"');
    expect(cell).toContain(">Run</button>");
    expect(cell).not.toContain('name="steps"');
    expect(line.replace(head(html, "109-idle"), "")).toContain('name="steps" value="analyze"');
  });

  test("a collapsed row emits no controls line at all (criterion 2)", () => {
    expect(rows([], [target("109-idle")])).not.toContain("data-controls");
  });

  // --- criteria 3-5: which control lands on which line ----------------------

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec offers Cancel in the header's action stack (criterion 3)`, () => {
      const html = rows(
        [row({ id: "j1", specFolder: "109-busy", state, branchUrls: branch })],
        [target("109-busy")],
        open("109-busy"),
      );
      const cell = actionCell(controlsLine(html, "109-busy"));
      expect(cell).toContain('action="/api/queue/j1/cancel"');
      // Exactly once on the page: the stack is the one place a row's
      // actions are drawn now (spec 124).
      expect(html.match(/action="\/api\/queue\/j1\/cancel"/g)).toHaveLength(1);
    });
  }

  test("a gated row keeps Approve and Cancel together in its stack (criterion 4)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "109-gated", state: "awaiting-approval" })],
      [target("109-gated")],
      open("109-gated"),
    );
    const cell = actionCell(controlsLine(html, "109-gated"));
    // Spec 109 split the two across two lines; spec 124 put every
    // button a row has in one stack, so the reader looks in one place.
    expect(cell).toContain('action="/api/queue/j1/approve"');
    expect(cell).toContain('action="/api/queue/j1/cancel"');
    // Exactly once on the page, not once per line.
    expect(html.match(/action="\/api\/queue\/j1\/approve"/g)).toHaveLength(1);
    expect(html.match(/action="\/api\/queue\/j1\/cancel"/g)).toHaveLength(1);
  });

  // Spec 132 took Merge out of the SHUT row — the State column says
  // "ready to merge the code" there instead, with no button on it. What
  // spec 109 guards is unchanged where the button is still drawn: once
  // per row, in the stack, and never on a phase line of its own.
  test("Merge is offered exactly once, in the open row's stack (criterion 5)", () => {
    const list = [row({ id: "j1", specFolder: "109-merge", state: "done", branchUrls: branch })];
    const shutHtml = rows(list, [target("109-merge")]);
    const openHtml = rows(list, [target("109-merge")], open("109-merge"));
    expect(shutHtml).not.toContain("/merge");
    expect(shutHtml).toContain(">ready to merge the code<");
    for (const html of [openHtml]) {
      expect(html.match(/action="\/api\/queue\/j1\/merge"/g)).toHaveLength(1);
      expect(actionCell(controlsLine(html, "109-merge"))).toContain('action="/api/queue/j1/merge"');
    }
    // Once per row, wherever it sits: on a shut row the header's last
    // cell, on an open row the stack beside the phase lines — and no
    // phase LINE carries an action of its own.
    const openGroup = controlsLine(openHtml, "109-merge");
    expect(openGroup.replace(/<td class="stackcell"[\s\S]*?<\/td>/, "")).not.toContain("/merge");
  });

  // --- criterion 6: the order of the lines an open row grows ----------------

  test("the header comes first, then the phase lines, with nothing between (criterion 6)", () => {
    const html = rows([], [target("109-idle")], open("109-idle"));
    const at = (s: string) => html.indexOf(s);
    // Spec 117 folded "more" into the controls line rather than leaving
    // a second line under it; spec 124 folded the controls line itself
    // into the header's own cell. An open row is a header and its
    // phases, and nothing else.
    expect(html).not.toContain("data-more");
    expect(html).not.toContain("data-controls");
    expect(at('data-folder="109-idle"')).toBeLessThan(at('<tr class="subrow'));
  });

  // --- criterion 7: the "more" fields still reach the form that moved -------

  test("the rarely-set fields submit with the Run form beside them (criterion 7)", () => {
    const html = rows([], [target("109-idle")], open("109-idle"));
    const line = controlsLine(html, "109-idle");
    const id = line.match(/<form id="([^"]+)"/)![1];
    const fields = [
      ...line.slice(line.indexOf("</form>")).matchAll(
        /<(?:select|input)\b[^>]*name="extraProjects"[^>]*>/g,
      ),
    ];
    expect(fields.length).toBe(1);
    for (const f of fields) expect(f[0]).toContain(`form="${id}"`);
    // And the model, from the phase lines it moved to (spec 123).
    for (const sel of html.matchAll(/<select\b[^>]*name="model\.[^"]*"[^>]*>/g)) {
      expect(sel[0]).toContain(`form="${id}"`);
    }
  });

  // The line those fields lived on is gone (spec 124): they sit in the
  // header row's own action cell now, under the buttons. What still
  // has to hold is that the cell they moved into has a width of its
  // own, so the row cannot be shoved sideways by what it offers.
  test("the action cell they moved into has a declared width", async () => {
    const { CSS } = await import("../src/render/css.ts");
    expect(CSS).not.toContain("data-more");
    expect(CSS).not.toContain("data-controls");
    const rule = CSS.match(/\.stackcell \{[^}]*\}/)![0];
    expect(rule).toMatch(/width:\s*[\d.]+rem;/);
  });

  // `.row` on its own is block-level `flex`, which would put the
  // rarely-set fields on a line directly UNDER the run form — the
  // two-line shape spec 117 exists to remove, rebuilt in CSS. They
  // have to sit BESIDE it, which is what `inline-flex` buys.
  test("the rarely-set fields sit beside the run form, not under it (spec 117)", async () => {
    const { CSS } = await import("../src/render/css.ts");
    const rule = CSS.match(/\n\.extra \{[^}]*\}/)![0];
    expect(rule).toContain("display: inline-flex");
    expect(rule).toContain("font-size: var(--fs-s)");
  });
});

// --- spec 108: one rule for what a phase shows -------------------------------

// The row for spec 81 said three things at once: pips and phase lines
// read the JOB HISTORY (a July analysis re-run, cancelled, spoke for an
// analysis that was long since done and merged), the checkbox read the
// files unioned with that same history, and archive read "done" from a
// job that had finished without moving anything.
//
// One rule now, for every phase: the FILES say what has happened, the
// last attempt is a qualifier when it disagrees, and archive says "held
// back" with its reason when a run declined to move the folder.
describe("spec 108: one rule per phase", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-19T12:00:00Z"),
    );
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** The Run button's own line, under the header since spec 109. */
  /** Everything one row draws: its header line and, when it is open,
   *  the phase lines under it — where the boxes live since spec 124. */
  const runLine = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");
  // The pips carry the phase's own reader-facing name as their title,
  // which is how one is told from the next three.
  const pipFor = (html: string, label: string) =>
    head(html).match(new RegExp(`<span class="pip ([a-z]+)" title="${label}"`))?.[1] ?? "";
  // The three phases that CAN be true from the files, for a spec whose
  // only open question is archive.
  const BUILT = ["analyze", "review-plan", "implement"];

  test("a phase the files show done, with no job ever queued, reads done (criterion 1)", () => {
    const html = rows([], [target("108-hand-analysed", { done: ["analyze"] })]);
    expect(pipFor(html, "analyze")).toBe("past");
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain("b-done");
    expect(analyze).not.toContain("not run yet");
    expect(analyze).not.toContain("last re-run");
  });

  test("a cancelled re-run never overturns a finished analysis (criterion 2)", () => {
    const html = rows(
      [row({ id: "recancelled", specFolder: "108-recancelled", steps: ["analyze"], state: "cancelled" })],
      [target("108-recancelled", { done: ["analyze"] })],
    );
    expect(pipFor(html, "analyze")).toBe("past");
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain("b-done");
    expect(analyze).toContain("last re-run cancelled");
  });

  // Criterion 3's "Run again" wording was retired 2026-08-19: the
  // button says Run whatever has already run.
  test("with every phase but archive done the button still just reads Run", () => {
    const html = rows([], [target("108-ready", { done: BUILT })]);
    expect(pipFor(html, "archive")).toBe("todo");
    expect(subRow(html, "archive")).toContain("not run yet");
    expect(runLine(html)).not.toContain("Run again");
    expect(runLine(html)).toContain(">Run</button>");
  });

  test("an archive run that declined reads held back, not done (criterion 4)", () => {
    const html = rows(
      [row({ id: "declined", specFolder: "108-held", steps: ["archive"], state: "done" })],
      [
        target("108-held", {
          done: BUILT,
          archiveHeldBack: { reason: "the Slack webhook (Phase 4, still unchecked)" },
        }),
      ],
    );
    expect(pipFor(html, "archive")).toBe("todo");
    const archive = subRow(html, "archive");
    expect(archive).toContain("held back");
    // Spec 143: the REASON is the row's panel's, said once for the
    // whole row. The phase line keeps the word that is its own answer.
    expect(archive).not.toContain("the Slack webhook (Phase 4, still unchecked)");
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "the Slack webhook (Phase 4, still unchecked)",
    );
    // The one thing it must never read as, which is what it read as
    // before this spec: an ordinary finished step.
    expect(archive).not.toContain("b-done");
  });

  test("an archive run in flight outranks a stale held-back note (criterion 6)", () => {
    const html = rows(
      [row({ id: "retry", specFolder: "108-retry", steps: ["archive"], state: "running" })],
      [target("108-retry", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    expect(pipFor(html, "archive")).toBe("now");
    expect(subRow(html, "archive")).toContain("b-running");
  });

  test("a finished implement job is not done while the files disagree (criterion 8)", () => {
    const html = rows(
      [row({ id: "lagging", specFolder: "108-lagging", steps: ["implement"], state: "done" })],
      [target("108-lagging", { done: ["analyze", "review-plan"] })],
    );
    expect(pipFor(html, "implement")).toBe("todo");
    const implement = subRow(html, "implement");
    expect(implement).not.toContain("b-done");
    // Never silently hidden: the job's own outcome is still on the line,
    // as the qualifier it now is.
    expect(implement).toContain("the files disagree");
  });

  test("the job page's Steps tab says held back where the row does (criterion 5)", () => {
    const archiveRun = (extra: Partial<JobDetailView> = {}): JobDetailView =>
      detail({
        id: "job-archive",
        steps: ["archive"],
        state: "done",
        results: [
          {
            step: "archive", ok: true, costUsd: 0.51, costMeasured: true,
            terminalReason: "completed", at: "2026-08-19T10:01:00Z",
          },
        ],
        ...extra,
      });
    const held = renderJobDetailPage(
      archiveRun({ archiveHeldBack: "the Slack webhook (Phase 4, still unchecked)" }),
      generatedAt,
      NAV,
      { tab: "steps" },
    );
    expect(held).toContain("held back — the Slack webhook (Phase 4, still unchecked)");
    expect(held).not.toContain("<td>ok</td>");

    // Without a reason the table is exactly what it always was.
    const plain = renderJobDetailPage(archiveRun(), generatedAt, NAV, { tab: "steps" });
    expect(plain).toContain("<td>ok</td>");
    expect(plain).not.toContain("held back");
  });
});

// --- spec 115: the Projects panel left the front page ------------------------
//
// It was here because a generated file had no server behind it to check
// a token against (spec 112). `/projects` is served now, so the panel
// sits on the page that lists what it changes — and `/` is back to one
// panel above the list. Its own tests live in projects-page.test.ts.
describe("the front page after the panel moved", () => {
  const page = (opts: Partial<QueuePageOptions> = {}): string =>
    renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
      runnerAvailable: true,
      targets: [],
      ...opts,
    });

  test("no Projects disclosure under New spec", () => {
    const html = page({ createProjects: ["aide", "atlasaurus"] });
    // The MARKUP, not the word: the stylesheet is inlined into every
    // page and still carries the panel's rules, for the page that has it.
    expect(html).not.toContain('<details class="newspec projectadmin">');
    expect(html).not.toContain('action="/api/queue/projects"');
    expect(html).not.toContain('action="/api/queue/projects/aide/remove"');
  });

  test("help rides before New spec at the right-hand end of either filter row", () => {
    const assertOrder = (html: string) => {
      const filters = html.indexOf('data-filter="state"');
      const help = html.indexOf('<details class="intro"');
      const newSpec = html.indexOf('href="/new"');
      const table = html.indexOf("<table");
      expect(filters).toBeGreaterThan(html.indexOf('<div id="jobrows">'));
      expect([filters, help, newSpec, table]).toEqual(
        [...[filters, help, newSpec, table]].sort((a, b) => a - b),
      );
    };

    assertOrder(page({ createProjects: ["aide"] }));
    assertOrder(
      renderQueuePage(
        [row(), row({ id: "job-2", project: "atlasaurus", specFolder: "12-other" })],
        "2026-08-18T00:00:00Z",
        [{ label: "Projects", path: "/projects" }],
        { runnerAvailable: true, targets: [], createProjects: ["aide"] },
      ),
    );
  });

  test("help owns the automatic margin that keeps both controls at the right", () => {
    const html = page({ createProjects: ["aide"] });
    expect(html).toContain(
      "#jobrows > .row:first-child > details.intro { margin-left: auto; }",
    );
    expect(html).not.toContain(
      "#jobrows > .row:first-child > .btn { margin-left: auto; }",
    );
  });

  test("the nav takes the reader to the page that manages them", () => {
    expect(page()).toContain('href="/projects"');
  });
});

// --- spec 114: a spec with an unmerged dependency says so on the row ---------

// Spec 114 put a badge here — "after 106", one per dependency whose
// branch was still unmerged — so the row said what it was waiting on.
// Taken out again 2026-08-20: the title line already says "depends on
// <folder>" (spec 110) one cell to the left, and the two stood side by
// side saying nearly the same words about the same fact. The state cell
// is the sentence and nothing else again.
describe("a dependency is named once, on the title line, and not in the state cell", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(list, { runnerAvailable: true, targets }, Date.parse("2026-08-19T12:00:00Z"));
  const rowHtml = (html: string, folder: string) =>
    html.match(
      new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?</tr>`),
    )?.[0] ?? "";
  const hintCell = (html: string, folder: string) =>
    (rowHtml(html, folder).split("<td")[3] ?? "").match(
      /<div class="muted small">([\s\S]*?)<\/div><\/td>/,
    )?.[1] ?? "";
  const unmerged = (specFolder: string) =>
    row({
      specFolder,
      state: "done",
      branchUrls: [{ label: "aide", url: "https://example.test/aide", merged: false }],
    });

  test("an unmerged dependency puts nothing in the state cell", () => {
    const html = rows([unmerged("106-x")], [target("106-x"), target("114-b", { dependsOn: ["106"] })]);

    expect(hintCell(html, "114-b")).not.toContain("after");
    // The whole cell is the sentence, and nothing else.
    expect(hintCell(html, "114-b")).toMatch(/^[^<]*$/);
  });

  test("the title line still says what the spec builds on", () => {
    const html = rows([unmerged("106-x")], [target("106-x"), target("114-b", { dependsOn: ["106"] })]);

    expect(rowHtml(html, "114-b")).toContain("depends on 106");
  });
});

// The create exception ends where the archive begins: a create job keeps
// its group on the page while its spec has not landed, but once the
// folder is in archive/ that same exception kept a ghost row with
// nonsense statuses — seen with 111 and 112 on 2026-08-19.
describe("an archived spec's create job is not a row", () => {
  const createJob = (folder: string): QueueRowView => ({
    id: "c1",
    project: "aide",
    specFolder: folder,
    steps: ["create"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-19T10:00:00Z",
  });
  test("visible while unlanded, gone once archived", () => {
    const opts = { runnerAvailable: true, targets: [{ project: "aide", specFolder: "90-other" }] };
    const before = renderQueueRows([createJob("111-x")], opts, Date.parse("2026-08-19T12:00:00Z"));
    expect(before).toContain('data-folder="111-x"');
    const after = renderQueueRows([createJob("111-x")], { ...opts, archived: ["aide/111-x"] }, Date.parse("2026-08-19T12:00:00Z"));
    expect(after).not.toContain('data-folder="111-x"');
  });
});

// Being archived is the proof the phases ran, so an archived spec's row
// has nothing left to argue about — including when the job that made it
// is not a `create`. The check above lived on the create branch alone,
// and a project with no OTHER live target reached the group through the
// "we are not entitled to judge this project" branch instead: every
// phase read "not run yet" under a job reporting done, which the row
// then worded as "the files disagree". Seen on 129 the day it was
// archived (2026-08-20).
describe("an archived spec's non-create job is not a row either", () => {
  const analyzeJob = (folder: string): QueueRowView => ({
    id: "a1",
    project: "aide",
    specFolder: folder,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-19T10:00:00Z",
  });
  // Opened, because the qualifier the bug produces only renders on the
  // phase lines behind the fold — a shut row shows the pips and nothing
  // else, so a closed-row assertion on that sentence would pass either
  // way and prove nothing.
  const opened = (folder: string, archived: string[]) =>
    renderQueueRows(
      [analyzeJob(folder)],
      {
        runnerAvailable: true,
        targets: [],
        archived,
        filter: { open: `aide/${folder}` },
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );

  test("even when its project has no other live target", () => {
    const html = opened("129-x", ["aide/129-x"]);
    expect(html).not.toContain('data-folder="129-x"');
    expect(html).not.toContain("last run reported done, but the files disagree");
  });

  // The other half of the same fixture: without the archive fact, the
  // row is still there AND still says the files disagree. That is what
  // the assertions above are pinned against — remove the archive entry
  // and both of them fire.
  test("the same spec unarchived keeps its row, contradiction and all", () => {
    const html = opened("129-x", []);
    expect(html).toContain('data-folder="129-x"');
    expect(html).toContain("last run reported done, but the files disagree");
  });
});

// A spec made from the New-spec form starts life as a `create` job — a
// claude run that costs money and can fail — and that run used to be
// findable only by knowing the job id, or appended after `archive` as a
// straggler. It is the spec's FIRST phase, and every spec has had one,
// whether or not the queue ran it.
describe("spec 116: create is the first phase line", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const createJob = (specFolder: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({
      id: "c1",
      specFolder,
      steps: ["create"],
      stepIndex: 0,
      state: "done",
      startedAt: "2026-08-19T10:00:00Z",
      ...extra,
    });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-19T12:00:00Z"),
    );
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** Everything one row draws: its header line and, when it is open,
   *  the phase lines under it — where the boxes live since spec 124. */
  const runLine = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");
  const order = (html: string) => [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
  const pipFor = (html: string, label: string) =>
    head(html).match(new RegExp(`<span class="pip ([a-z]+)" title="${label}"`))?.[1] ?? "";
  /** Every pip's title, in order — the only way to prove one is ABSENT. */
  const pipTitles = (html: string) =>
    [...head(html).matchAll(/<span class="pip [a-z]+" title="([^"]+)"/g)].map((m) => m[1]);

  // --- criterion 1: five lines, create first ---------------------------------

  test("a spec with no job at all leads with create (criterion 1)", () => {
    const html = rows([], [target("116-hand-made", { done: ["create", "analyze"] })]);
    expect(order(html)).toEqual(["create", "analyze", "review-plan", "implement", "archive"]);
  });

  // --- criterion 2: no create job means an inert line, not a missing one -----

  test("a hand-made spec's create line reads done, with nothing to click (criterion 2)", () => {
    const html = rows([], [target("116-hand-made", { done: ["create", "analyze"] })]);
    const line = subRow(html, "create");
    expect(line).toContain("b-done");
    expect(line).not.toContain("href=");
    expect(line).not.toContain("not run yet");
    // No model note, no elapsed time, no cost — what a finished attempt
    // fills and an attempt-less line leaves empty. Since spec 123 the
    // model shares the phase name's own cell rather than having one of
    // its own, so the emptiness is inside that cell.
    // The empty span before the name is the checkbox column's place,
    // held so every phase name starts at the same x (spec 124) —
    // `create` is history and has no box to put in it.
    expect(line).toContain(
      '<td class="phasecell"><span class="row"><span class="row"></span>' +
        '<span class="muted">create</span></span></td>',
    );
    expect(line).toContain('<td><span class="badge b-done">done</span></td><td></td><td class="num"></td>');
  });

  // --- criteria 3-4: a real create job, before and after it lands ------------

  test("an unlanded create job's line reads the job's own state (criterion 3)", () => {
    // No target: the folder is what the job is still making, so the
    // files cannot say create has happened.
    const html = rows([createJob("116-landing", { state: "running" })], []);
    expect(order(html)).toEqual(["create", "analyze", "review-plan", "implement", "archive"]);
    const line = subRow(html, "create");
    expect(line).toContain("running");
    expect(line).not.toContain("b-done");
  });

  test("a landed create job's line reads done and links to the run (criterion 4)", () => {
    const html = rows(
      [createJob("116-landed", { model: "sonnet", spentUsd: 0.42 })],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    expect(order(html)[0]).toBe("create");
    const line = subRow(html, "create");
    expect(line).toContain('href="/specs/c1"');
    expect(line).toContain("b-done");
    // The model it ran on shows as the select's pre-filled value when
    // choices are configured — no spelled-out text since 2026-08-19,
    // so without a picker the line simply says nothing about it.
    expect(line).not.toContain("last ran");
    expect(line).toContain("$0.42");
  });

  // --- criterion 5: history, not a fifth pip ---------------------------------

  test("create is never a progress pip (criterion 5)", () => {
    const withJob = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    const withoutJob = rows([], [target("116-hand-made", { done: ["create", "analyze"] })]);
    for (const html of [withJob, withoutJob]) {
      expect(pipTitles(html)).toEqual(["analyze", "review", "implement", "archive"]);
      expect(pipFor(html, "create")).toBe("");
    }
  });

  // --- criterion 6: history, not a control -----------------------------------

  test("create is never a run-form checkbox (criterion 6)", () => {
    const html = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    const line = runLine(html);
    const boxes = [...line.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(boxes).toEqual(["analyze", "review-plan", "implement", "archive"]);
  });

  // --- criterion 7: the status sentence and the button do not move -----------

  test("neither the next-phase sentence nor the Run button notices create (criterion 7)", () => {
    // The same spec twice, differing only in whether create is done. A
    // finished job, so the sentence is the one that names the phase the
    // spec is ready for — "ready for create" is what a widened
    // `QUEUE_STEPS` would produce here, and must not.
    const analyzed = row({ id: "a1", specFolder: "116-status", steps: ["analyze"], state: "done" });
    const withCreate = rows([analyzed], [target("116-status", { done: ["create", "analyze"] })]);
    const withoutCreate = rows([analyzed], [target("116-status", { done: ["analyze"] })]);
    // Spec 132: the sentence is the badge itself once the job is at
    // rest. The dot comes off first — it is the badge's live mark.
    const said = (html: string) =>
      head(html)
        .replace(/<span class="dot"[^>]*><\/span>/g, "")
        .match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
    expect(said(withCreate)).toBe(said(withoutCreate));
    expect(said(withCreate)).toBe("ready for review");
    expect(runLine(withCreate)).toContain(">Run</button>");
    expect(runLine(withoutCreate)).toContain(">Run</button>");
    // And with everything built the button still just reads Run — the
    // again-variant went 2026-08-19.
    const allBuilt = rows([analyzed], [target("116-status", { done: ["analyze", "review-plan", "implement"] })]);
    expect(runLine(allBuilt)).not.toContain("Run again");
    expect(runLine(allBuilt)).toContain(">Run</button>");
  });

  // --- criterion 8: once, at the front, never twice --------------------------

  test("a create job appears once, never also appended after archive (criterion 8)", () => {
    const html = rows(
      [createJob("116-landed"), row({ id: "a1", specFolder: "116-landed", steps: ["analyze"], state: "done" })],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    expect(order(html)).toEqual(["create", "analyze", "review-plan", "implement", "archive"]);
    expect(html.match(/data-step="create"/g)).toHaveLength(1);
  });
});

// --- spec 118: dollars or tokens, the reader's choice -------------------------
//
// Every consumption figure on the page is rendered TWICE — once in
// dollars, once in tokens — and CSS shows exactly one, driven by the
// `data-unit` attribute `unit-script.ts` sets from the reader's stored
// choice. That is the same mechanism the theme already uses, applied to
// text instead of colour, and it is what makes the choice work on a
// generated page opened from a folder with no server in front of it.
//
// A server-rendered test cannot "switch to token mode" — there is no
// browser here to run the script or apply the CSS. What it CAN prove is
// that both figures are in the HTML, in the right span, with the right
// text: given that, the CSS rule (asserted in css-token-guard.test.ts)
// is the whole of the switch.
describe("spec 118: the Units choice in the … menu", () => {
  const menu = (html: string) => html.match(/<details class="menu">[\s\S]*?<\/details>/)![0];

  test("every page offers $ and Tokens, beside Theme", () => {
    for (const page of site) {
      const m = menu(page.html);
      const choices = [...m.matchAll(/data-unit-choice="([^"]+)"[^>]*>([^<]+)</g)].map(
        (x) => [x[1], x[2]],
      );
      expect(choices).toEqual([["usd", "$"], ["tokens", "Tokens"]]);
      expect(m).toContain(">Units</span>");
      // Theme is still there: this joins the menu, it does not replace
      // anything in it.
      expect(m).toContain(">Theme</span>");
    }
  });

  test("the choices are buttons, not links — they go nowhere", () => {
    const m = menu(site[0]!.html);
    expect(m).toMatch(/<button type="button" data-unit-choice="usd"/);
    expect(m).not.toMatch(/<a[^>]*data-unit-choice/);
  });

  test("$ is marked as chosen, because the server cannot know better", () => {
    for (const page of site) {
      const marked = [...menu(page.html).matchAll(/data-unit-choice="([^"]+)" aria-current=/g)].map(
        (x) => x[1],
      );
      expect(marked).toEqual(["usd"]);
    }
  });

  test("one script tag still, carrying both settings", () => {
    for (const page of site) {
      const scripts = [...page.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      // The overview is a redirect and has a second script of its own;
      // every other page has exactly one, and it holds both.
      const shared = scripts[0]!;
      expect(shared).toContain("data-theme-choice");
      expect(shared).toContain("data-unit-choice");
    }
  });
});

describe("spec 118: every consumption figure carries both units", () => {
  const rows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row({ specFolder: "81-queue-and-runner", ...extra })], {
      runnerAvailable: true,
      targets: [],
      filter: { open: "aide/81-queue-and-runner" },
    });

  // Criterion 4: with no stored choice the page reads exactly as it did
  // before this spec — a plain dollar figure, in the dollar span.
  test("the spec row's Cost cell holds the dollar figure it always did", () => {
    expect(rows({ spentUsd: 0.54 })).toContain('<span class="u-usd">$0.54</span>');
  });

  // Criterion 5: and the token figure beside it, for the reader who
  // asked for tokens.
  test("the same cell holds the token figure beside it", () => {
    const html = rows({ spentUsd: 0.54, spentTokens: 5234 });
    expect(html).toContain('<span class="u-usd">$0.54</span>');
    expect(html).toContain('<span class="u-tok">5.2k tok</span>');
  });

  // Criterion 7: a job that ran before this feature has no token count,
  // and a dash is the only honest answer — never a zero, which would
  // read as "this step used nothing".
  test("a job with no token count shows a dash in the token span", () => {
    const html = rows({ spentUsd: 0.54 });
    expect(html).toContain('<span class="u-tok">–</span>');
  });

  // The phase lines are fed by the same cell, from each attempt's own
  // result — the list and the job page must not disagree about a step.
  test("a phase line shows that step's own tokens, not the job's total", () => {
    const html = rows({
      state: "done",
      steps: ["analyze"],
      spentUsd: 2,
      spentTokens: 9000,
      results: [{ step: "analyze", ok: true, costUsd: 0.5, tokens: 1500 }],
    });
    expect(html).toContain('<span class="u-tok">1.5k tok</span>');
  });

  // The description asks for the Cost column "(header and values)" —
  // the word at the top of the column is a consumption label like the
  // figures under it, and a column of token counts headed "Cost" reads
  // as money.
  test("the column heading flips with the figures under it", () => {
    const html = rows({ spentUsd: 0.54 });
    expect(html).toContain('<span class="u-usd">Cost</span><span class="u-tok">Tokens</span>');
  });

  // The regression the money()/costCell() consolidation could lose: a
  // header with nothing spent owes the reader a dash, while an empty
  // phase line stays EMPTY. Two different blanks, one formatter.
  test("a phase line with nothing spent stays empty, and the header still dashes", () => {
    const html = rows({ state: "queued", steps: ["analyze"], spentUsd: 0 });
    // The spec row's own Cost cell: a dash, because a header with
    // nothing spent still owes the reader an answer.
    expect(html).toContain('<td class="num">–</td>');
    // The analyze line's, which is EMPTY rather than dashed — two
    // different blanks, and the one formatter must keep both.
    const line = html.match(/data-step="analyze"[\s\S]*?<\/tr>/)![0];
    expect(line).toContain('<td class="num"></td>');
    expect(line).not.toContain("–");
  });
});

describe("spec 118: the job page's figures carry both units", () => {
  const page = (extra: Partial<JobDetailView> = {}, tab: "overview" | "steps" = "overview") =>
    renderJobDetailPage(detail(extra), "2026-08-17T10:00:00Z", NAV, { tab });

  const step = (extra: Record<string, unknown> = {}) => ({
    step: "analyze",
    ok: true,
    costUsd: 0.42,
    costMeasured: true,
    terminalReason: "completed",
    at: "2026-08-16T10:01:00Z",
    ...extra,
  });

  test("the Steps table's Cost column holds both figures (criteria 4, 5)", () => {
    const html = page({ results: [step({ tokens: 12_300 })] }, "steps");
    expect(html).toContain('<span class="u-usd">$0.42</span>');
    expect(html).toContain('<span class="u-tok">12.3k tok</span>');
  });

  test("a step recorded before this feature dashes rather than guessing (criterion 7)", () => {
    const html = page({ results: [step()] }, "steps");
    expect(html).toContain('<span class="u-usd">$0.42</span>');
    expect(html).toContain('<span class="u-tok">–</span>');
  });

  // The same argument as the list's column heading: a row labelled
  // "Cost so far" above a token count reads as money. The label flips
  // with the figure, and dollar mode is byte-for-byte what it was.
  test("the Steps table's column heading flips too", () => {
    const html = page({ results: [step()] }, "steps");
    expect(html).toContain('<span class="u-usd">Cost</span><span class="u-tok">Tokens</span>');
  });

  test("the Cost so far label flips with its figure", () => {
    const html = page({ spentUsd: 1.5 });
    expect(html).toContain('<span class="u-usd">Cost so far</span><span class="u-tok">Tokens so far</span>');
  });

  test("the job's Cost so far row carries both (criteria 4, 5)", () => {
    const html = page({ spentUsd: 1.5, spentTokens: 2_000_000 });
    expect(html).toContain('<span class="u-usd">$1.50</span>');
    expect(html).toContain('<span class="u-tok">2.0M tok</span>');
  });

  // The live panel had a Cost so far row of its own; spec 150 removed
  // the panel. The job's own row above is the one that is left, and it
  // is asserted directly above this.
});

describe("the day total that used to sit under the list", () => {
  // Spec 118 put "Spent today" under the list; the user had it removed
  // on 2026-08-19 — one more figure about money on a page that should
  // talk about work. The per-row cost/token column is the display.
  test("no page shows a day total", () => {
    const html = renderQueuePage([row()], "2026-08-16T00:00:00Z", NAV, {
      runnerAvailable: true,
      targets: [],
    });
    expect(html).not.toContain("Spent today");
  });
});

// --- spec 123: the model is chosen on the phase line -------------------------

// One dropdown for the whole row used to sit on the controls line
// between Run and the other rarely-set fields, carrying option labels
// like "fable — $12 per step". It landed beside the State column by
// accident of content width, tied to nothing around it, and the phase
// lines below it showed their model as dead text with a wide empty gap
// before it.
//
// The choice belongs where the phase is: each phase line carries its
// own picker, under a "Phase"/"Model" caption, and the budget figure
// moves off the label into the option's own tooltip — the number still
// reachable, no longer read out on every option.
describe("spec 123: each phase line picks its own model", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const CHOICES = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
  ];

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("123-picks")],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: CHOICES,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");
  /** The caption line: a subrow with no phase of its own, above them
   *  all. Marked by a data attribute rather than a class — it needs no
   *  rule of its own, and the render vocabulary is a closed set
   *  (`css-token-guard.test.ts`). */

  // --- criterion 1 -----------------------------------------------------------

  test("the row's own controls carry no shared Model select any more", () => {
    const html = rows([]);
    expect(controlsLine(html, "123-picks")).not.toBe("");
    expect(controlsLine(html, "123-picks")).not.toContain('name="model"');
    // Nor anywhere else on the row: the whole-job field is gone, not moved.
    expect(html).not.toContain('<select name="model"');
  });

  // --- criterion 2 -----------------------------------------------------------

  test("every phase line carries its own select, on the row's Run form", () => {
    const html = rows([]);
    const id = controlsLine(html, "123-picks").match(/<form id="([^"]+)"/)![1];
    for (const step of ["create", "analyze", "review-plan", "implement", "archive"]) {
      const line = subRow(html, step);
      expect(line).not.toBe("");
      const select = line.match(new RegExp(`<select name="model\\.${step}"[^>]*>`))?.[0] ?? "";
      expect(select).not.toBe("");
      // It is written outside the form's own tags, so only the `form`
      // attribute carries it back — an id that drifts runs the job on
      // the defaults instead, silently.
      expect(select).toContain(`form="${id}"`);
    }
  });

  // No "default" entry (asked for 2026-08-19): the select holds real
  // names only, pre-filled with what the configuration would give the
  // step when the phase has not run yet.
  test("the options are the real names, pre-filled with the configured model", () => {
    const line = subRow(rows([], [target("123-picks")], { defaultModels: { default: "sonnet" } }), "analyze");
    expect(line).not.toContain('<option value=""');
    expect(line).toMatch(/<option value="sonnet"[^>]*selected/);
    expect(line).toContain('value="fable"');
  });

  test("a per-step configured model beats the catch-all default", () => {
    const line = subRow(
      rows([], [target("123-picks")], { defaultModels: { analyze: "fable", default: "sonnet" } }),
      "analyze",
    );
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  test("no option label reads out a budget figure", () => {
    const html = rows([]);
    for (const option of html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)) {
      expect(option[1]).not.toContain("$");
    }
  });

  test("the figure is still reachable — it moved to the option's tooltip", () => {
    const line = subRow(rows([]), "analyze");
    expect(line).toContain('title="$12 per step"');
  });

  // --- criterion 3 -----------------------------------------------------------

  /** The caption line above the phase lines. It leads with the stack
   *  cell, which spans them all, so what is asserted about the caption
   *  itself is read past that cell. */
  const caption = (html: string) =>
    (html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");

  test("a Phase/Model caption sits directly above the phase lines", () => {
    const html = rows([]);
    const cap = caption(html);
    expect(cap).toContain(">Phase<");
    expect(cap).toContain(">Model<");
    // Between the spec's own line and the first phase line. (The
    // caption itself is compared with its stack cell stripped, so the
    // ordering is read off the row tag rather than the text.)
    const at = html.indexOf('<tr class="subrow" data-caption="1">');
    expect(at).toBeGreaterThan(html.indexOf('data-folder="123-picks"'));
    expect(at).toBeLessThan(html.indexOf('data-step="create"'));
  });

  // --- criterion 4 -----------------------------------------------------------

  test("with no model configured there is no picker and no caption at all", () => {
    const html = rows([], [target("123-picks")], { modelChoices: undefined });
    expect(controlsLine(html, "123-picks")).not.toBe("");
    expect(html).not.toContain("<select");
    expect(caption(html)).toBe("");
    expect(html).not.toContain(">Phase<");
  });

  // --- criterion 11 ----------------------------------------------------------

  // "last ran: X" is not spelled out any more (asked for 2026-08-19) —
  // the select's pre-filled value IS the answer.
  test("a phase that has run pre-fills its select with the model it ran on", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" })],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).not.toContain("last ran");
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  test("a phase run more than once keeps its attempt count", () => {
    const html = rows(
      [
        row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" }),
        row({ id: "j2", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "sonnet" }),
      ],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).toContain("2 attempts");
    expect(line).toContain('<select name="model.analyze"');
  });

  // --- the gap the description asked to close --------------------------------

  test("the phase name and its picker share one cell, so nothing sits between them", () => {
    const line = subRow(rows([]), "analyze");
    // Two columns merged into one, with the flex-gap container that
    // holds a name and a control together whatever the table's
    // auto-sized widths turn out to be.
    expect(line).toContain('<td class="phasecell"><span class="row">');
  });

  // --- the lock spec 105 put on the shared field follows it here -------------

  test("a busy spec's phase pickers lock exactly as the shared one did", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("123-picks")],
    );
    const select = subRow(html, "analyze").match(/<select name="model\.analyze"[^>]*>/)![0];
    expect(select).toContain("disabled");
    expect(select).toContain('title="implement is running"');
  });

  test("a settled spec's phase pickers are live again", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["implement"], stepIndex: 0, state: "done" })],
      [target("123-picks")],
    );
    const select = subRow(html, "analyze").match(/<select name="model\.analyze"[^>]*>/)![0];
    expect(select).not.toContain("disabled");
  });

  // A collapsed row has no phase lines, so it has no picker either —
  // the same promise spec 103 made about the shared field.
  test("a collapsed row offers no picker", () => {
    const html = rows([], [target("123-picks")], { filter: {} });
    expect(html).not.toContain("<select");
    expect(html).not.toContain('<tr class="subrow');
  });
});

// --- spec 124: one phase list, and the actions in a stack of their own -------
//
// An expanded row used to say its phases TWICE: a horizontal strip of
// checkboxes on the controls line (a green check behind every phase
// already done) and, two rows down, the phase lines saying "done" in
// their own State column. One fact, drawn twice with two different
// marks.
//
// The checkbox moves onto the phase's own line and drops the check;
// the controls line goes with it. The action buttons leave the last
// column for the FIRST one, stacked, always in the markup — state
// decides which are enabled, so a Merge that becomes available cannot
// widen a column and shove every row on the page sideways.
describe("spec 124: one phase list, and the actions in a stack of their own", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("124-stack")],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** A phase's own line. The stack cell rides on whichever sub-row
   *  comes first (it spans them all), and it is not part of the phase
   *  line — so it is taken off here. */
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";

  /** Every cell of one row, in order — the content between one cell's
   *  opening tag and the next one's. */
  const cells = (tr: string): string[] =>
    tr
      .split(/<t[dh]\b[^>]*>/)
      .slice(1)
      .map((s) => s.replace(/<\/t[dh]>[\s\S]*$/, ""));
  /** How many COLUMNS a row declares: a plain cell is one, a spanning
   *  cell is what it says. The number every row kind has to agree on. */
  const columnUnits = (tr: string): number =>
    [...tr.matchAll(/<t[dh]\b([^>]*)>/g)].reduce(
      (n, m) => n + Number(m[1]!.match(/colspan="(\d+)"/)?.[1] ?? 1),
      0,
    );
  /** The whole row group: the header line and the phase lines under it. */
  const group = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's buttons are. An OPEN row stacks them in the cell
   *  that leads its phase lines and spans them all; a SHUT row offers
   *  its one action in the header's LAST cell. (Spec 124 gave them a
   *  column of their own at the front, which put every button in the
   *  page's left gutter and pushed the whole table sideways — taken
   *  back out 2026-08-19, the stack itself kept.) */
  const actionCell = (chunk: string): string => {
    const stack = chunk.match(/<td class="stackcell"[^>]*>([\s\S]*?)<\/td>/)?.[1];
    if (stack !== undefined) return stack;
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const c = cells(headRow);
    return c[c.length - 1] ?? "";
  };

  const CHOICES = [{ name: "sonnet", budgetUsd: 3 }];
  const branch = [{ label: "aide", url: "https://example.test/c", merged: false }];

  // --- the structural invariant, before any behaviour ------------------------

  // Four functions decide a row's cells (`sortableHead`, `specHeadRow`,
  // `phaseCaptionRow`, `phaseSubRows`) and nothing in the type system
  // makes them agree. A row short of a column does not fail loudly —
  // it shifts every column after it, on some rows and not others.
  test("every row kind declares the same six columns, action last", () => {
    const html = renderQueuePage(
      [row({ id: "j1", specFolder: "124-stack", state: "done", branchUrls: branch })],
      "2026-08-19T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      {
        runnerAvailable: true,
        targets: [target("124-stack")],
        projects: ["aide"],
        modelChoices: CHOICES,
        filter: { open: "aide/124-stack" },
      },
    );
    const thead = html.match(/<thead><tr>.*?<\/tr><\/thead>/)?.[0] ?? "";
    const spechead = head(html, "124-stack");
    // The full first sub-row, stack cell included — `subRow` takes that
    // cell off, and this test is about the columns it fills.
    const firstSub = html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect([thead, spechead, firstSub, subRow(html, "analyze")].every(Boolean)).toBe(true);
    // Six on every row that starts its own: the header, the spec line,
    // and the first sub-row, whose stack cell spans the rest.
    for (const tr of [thead, spechead, firstSub]) {
      expect([tr.slice(0, 40), columnUnits(tr)]).toEqual([tr.slice(0, 40), 6]);
    }
    // Five on the lines the spanning cell covers — six columns all the
    // same, one of them filled from the row above.
    expect(columnUnits(subRow(html, "analyze"))).toBe(5);
    // The spare cell is at the END: the header's own blank `<th>`, and
    // the cell a shut row's one action goes in.
    expect(thead).toMatch(/<th><\/th><\/tr><\/thead>$/);
    // And the stack leads the phase lines, spanning every one of them.
    expect(firstSub).toContain('<td class="stackcell" rowspan="6">');
  });

  // --- criteria 1, 3, 4, 5, 15: the checkbox lives on the phase line ---------

  test("each runnable phase carries its own box, on its own line (criterion 1)", () => {
    const html = rows([]);
    const id = "rowrun-aide/124-stack";
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      const line = subRow(html, step);
      expect(line).toContain(`<input type="checkbox" name="steps" value="${step}"`);
      expect(box(line, step)).toContain(`form="${id}"`);
    }
    // The browser posts checkboxes in document order, so the order the
    // LINES are drawn in is the order `steps` arrives in.
    const order = [...html.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["analyze", "review-plan", "implement", "archive"]);
  });

  test("create's line carries no box at all — it is history (criterion 15)", () => {
    const line = subRow(rows([]), "create");
    expect(line).not.toContain("<input");
    expect(line).not.toContain("data-phase");
  });

  test("no strip of phase boxes and no controls line survive (criterion 2)", () => {
    const html = rows([], [target("124-stack")], { modelChoices: CHOICES });
    expect(html).not.toContain("data-controls");
    // The only `.phases` group left on this page is "also touches",
    // and this row has no other project to offer.
    expect(html).not.toContain('<span class="phases">');
    // Every box the row draws is on a phase line, so each is inside a
    // `<tr>` that names its own step.
    for (const m of html.matchAll(/<label class="phase[^"]*" data-phase="([^"]+)"/g)) {
      expect(subRow(html, m[1]!)).toContain(`data-phase="${m[1]}"`);
    }
  });

  test("a spec nothing has run pre-ticks analyze and review-plan (criterion 3)", () => {
    const html = rows([]);
    expect(box(subRow(html, "analyze"), "analyze")).toContain('value="analyze" checked');
    expect(box(subRow(html, "review-plan"), "review-plan")).toContain('value="review-plan" checked');
    expect(box(subRow(html, "implement"), "implement")).not.toContain("checked");
    expect(box(subRow(html, "archive"), "archive")).not.toContain("checked");
  });

  // The whole reason this spec exists: "done" was said by the State
  // column AND by a green check on the box. The box says nothing about
  // it any more — and stays tickable, because a rerun is the same
  // submission it always was.
  test("a done phase's box carries no check and no dimming (criterion 4)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "124-stack", state: "done" })],
      [target("124-stack", { done: ["analyze", "review-plan"] })],
    );
    for (const step of ["analyze", "review-plan"]) {
      const b = box(subRow(html, step), step);
      expect(b).not.toContain("already done");
      expect(b).not.toContain("phase done");
      expect(b).not.toContain("checked");
      expect(b).not.toContain("disabled");
      // Said once, by the column whose job it is.
      expect(subRow(html, step)).toContain('class="badge b-done"');
    }
    expect(box(subRow(html, "implement"), "implement")).toContain('value="implement" checked');
  });

  test("the running phase's box spins; the others go inert with the reason (criterion 5)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "124-stack", steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("124-stack")],
    );
    expect(box(subRow(html, "implement"), "implement")).toContain('class="phase busy"');
    for (const step of ["analyze", "review-plan", "archive"]) {
      const b = box(subRow(html, step), step);
      // Not in this job's steps, so unticked — and unticked is what it
      // looks like, no padlock over it (spec 145).
      expect(b).toContain('class="phase default"');
      expect(b).toContain("disabled");
      expect(b).toContain('title="implement is running"');
    }
    // Nothing is offered as ticked while nothing can be started.
    expect(html).not.toContain('value="analyze" checked');
  });

  // --- criteria 6-12: the action stack ---------------------------------------

  test("the stack leads the phase lines; the header keeps its own cells (criterion 6)", () => {
    const html = rows([]);
    expect(actionCell(group(html, "124-stack"))).toContain(">Run</button>");
    // The header row is the six cells it always was, cost second to
    // last and the shut row's action cell after it (empty while open).
    expect(cells(head(html, "124-stack"))).toHaveLength(6);
    expect(head(html, "124-stack")).toMatch(/<td class="num">[^<]*<\/td><td><\/td><\/tr>$/);
  });

  test("a spec with a job always offers Approve and Cancel, enabled or not (criterion 7)", () => {
    for (const [state, approve, cancel] of [
      ["done", true, true],
      ["running", true, false],
      ["awaiting-approval", false, false],
    ] as const) {
      const cell = actionCell(
        group(rows([row({ id: "j1", specFolder: "124-stack", state })], [target("124-stack")]), "124-stack"),
      );
      expect(cell).toContain('action="/api/queue/j1/approve"');
      expect(cell).toContain('action="/api/queue/j1/cancel"');
      const btnOf = (verb: string) =>
        cell.match(new RegExp(`action="/api/queue/j1/${verb}"[^>]*>.*?<button[^>]*>`))?.[0] ?? "";
      expect([state, "approve", btnOf("approve").includes("disabled")]).toEqual([state, "approve", approve]);
      expect([state, "cancel", btnOf("cancel").includes("disabled")]).toEqual([state, "cancel", cancel]);
    }
  });

  test("a spec no job has ever touched offers Run alone (criterion 8)", () => {
    const cell = actionCell(group(rows([]), "124-stack"));
    expect(cell).toContain(">Run</button>");
    expect(cell).not.toContain("/approve");
    expect(cell).not.toContain("/cancel");
    expect(cell).not.toContain("/merge");
  });

  test("Merge is disabled, never absent, while a job's spec has no open branch (criterion 9)", () => {
    const cell = actionCell(
      group(rows([row({ id: "j1", specFolder: "124-stack", state: "done" })], [target("124-stack")]), "124-stack"),
    );
    expect(cell).toContain("mergeform");
    const merge = cell.match(/<form method="post" action="\/api\/queue\/j1\/merge"[\s\S]*?<\/form>/)![0];
    expect(merge).toContain("disabled");
    expect(merge).toContain('title="no branch is open yet"');
    // And a real branch turns it on, with the name of what it will land.
    const live = actionCell(
      group(
        rows([row({ id: "j1", specFolder: "124-stack", state: "done", branchUrls: branch })], [target("124-stack")]),
        "124-stack",
      ),
    ).match(/<form method="post" action="\/api\/queue\/j1\/merge"[\s\S]*?<\/form>/)![0];
    expect(live).not.toContain("disabled");
    // Spec 132: what it will land is on the State line now; the button
    // itself is one word. The names stay in the title.
    expect(live).toContain(">Merge</button>");
    expect(live).toContain('title="aide"');
  });

  test("a busy spec's Merge is there and disabled, saying why (criterion 9)", () => {
    const merge = actionCell(
      group(
        rows(
          [row({ id: "j1", specFolder: "124-stack", steps: ["implement"], stepIndex: 0, state: "running", branchUrls: branch })],
          [target("124-stack")],
        ),
        "124-stack",
      ),
    ).match(/<form method="post" action="\/api\/queue\/j1\/merge"[\s\S]*?<\/form>/)![0];
    expect(merge).toContain("disabled");
    expect(merge).toContain('title="implement is running"');
  });

  test("Resolve appears only after a conflict on this very row (criterion 10)", () => {
    const list = [row({ id: "j1", specFolder: "124-stack", state: "failed", branchUrls: branch })];
    const withConflict = rows(list, [target("124-stack")], {
      error: "cannot merge — conflict",
      errorSpec: "aide/124-stack",
      errorReason: "conflict",
    });
    expect(actionCell(group(withConflict, "124-stack"))).toContain(">Resolve</button>");
    expect(actionCell(group(rows(list), "124-stack"))).not.toContain(">Resolve</button>");
  });

  // Spec 135: Merge demotes itself on a row that has just told the
  // reader why it could not be done, and until now nothing took the
  // role it vacated. Resolving IS what to do next there, so the pair is
  // asserted as a pair — exactly one primary, and it is Resolve.
  test("a conflict refusal leaves Resolve primary and Merge demoted", () => {
    const cell = actionCell(
      group(
        rows([row({ id: "j1", specFolder: "124-stack", state: "failed", branchUrls: branch })], [target("124-stack")], {
          error: "cannot merge — conflict",
          errorSpec: "aide/124-stack",
          errorReason: "conflict",
        }),
        "124-stack",
      ),
    );
    const form = (cls: string) =>
      cell.match(new RegExp(`<form[^>]*class="${cls}"[\\s\\S]*?</form>`))?.[0] ?? "";
    expect(form("resolveform")).toContain('class="btn primary"');
    // Exactly one of the pair is primary, and it is not Merge. (Run is
    // primary on this row too — that is the row's own action, not this
    // pair's, so the count is taken over the pair and not the cell.)
    expect(form("mergeform")).not.toContain("primary");
  });

  test("the rarely-set fields end the stack, on no line of their own (criterion 11)", () => {
    const html = rows([], [target("124-stack")], { projects: ["aide", "paceup"] });
    const cell = actionCell(group(html, "124-stack"));
    expect(cell).toContain('<span class="stack">');
    expect(cell).toContain('<span class="row extra">');
    expect(cell).toContain('name="extraProjects" value="paceup"');
    expect(cell).not.toContain('name="extraProjects" value="aide"');
    // After the buttons, quietly — never before them.
    expect(cell.indexOf('class="row extra"')).toBeGreaterThan(cell.indexOf(">Run</button>"));
    // And nowhere else on the page.
    expect(html.replace(cell, "")).not.toContain('name="extraProjects"');
  });

  test("a shut row's action cell is what a collapsed row has always offered (criterion 12)", () => {
    const gated = [row({ id: "j1", specFolder: "124-stack", state: "awaiting-approval" })];
    const shut = actionCell(group(rows(gated, [target("124-stack")], { filter: {} }), "124-stack"));
    expect(shut).toContain('action="/api/queue/j1/approve"');
    expect(shut).not.toContain("/cancel");
    expect(shut).not.toContain("mergeform");
    expect(shut).not.toContain(">Run<");
    expect(shut).not.toContain('class="stack"');
    // Nothing pending at all is an empty cell — the container the
    // shut row has always drawn, and nothing in it.
    const idle = actionCell(group(rows([], [target("124-stack")], { filter: {} }), "124-stack"));
    expect(idle).not.toContain("<form");
    expect(idle).not.toContain("<button");
  });

  // The run form itself is a carrier now: the button that submits it
  // and every box it posts are written OUTSIDE its tags, reaching it by
  // `form="…"` alone (the trick spec 123 introduced for the model).
  test("the Run form carries the hidden fields, and the button posts it by id", () => {
    const cell = actionCell(group(rows([], [target("124-stack")], { token: "s3cret" }), "124-stack"));
    expect(cell).toContain('<form id="rowrun-aide/124-stack" method="post" action="/api/queue"');
    expect(cell).toContain('name="project" value="aide"');
    expect(cell).toContain('name="specFolder" value="124-stack"');
    expect(cell).toContain('name="token" value="s3cret"');
    expect(cell).toMatch(/<button[^>]*form="rowrun-aide\/124-stack"[^>]*>Run<\/button>/);
    expect(cell).not.toContain('name="steps"');
  });

  test("Run locks while the spec is busy, with the row's own reason", () => {
    const cell = actionCell(
      group(
        rows(
          [row({ id: "j1", specFolder: "124-stack", steps: ["implement"], stepIndex: 0, state: "running" })],
          [target("124-stack")],
        ),
        "124-stack",
      ),
    );
    const run = cell.match(/<button[^>]*>Run<\/button>/)![0];
    expect(run).toContain("disabled");
    expect(run).toContain('title="implement is running"');
  });
});

// Spec 125: a step run by Codex says two things the page has to honour.
// There is no `claude-usage` for a Codex session, so the Live panel is
// not "unknown" — it is absent, because nothing will ever fill it. And
// there is no dollar figure anywhere in Codex's output, so the Cost
// column shows the token count and a dash where the money would be.
describe("a job run by Codex", () => {
  test("shows no Live right now panel — nothing watches a Codex session", () => {
    const html = renderJobDetailPage(
      detail({ state: "running", tool: "codex" }),
      "2026-08-20T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).not.toContain("Live right now");
  });

  // Spec 125's other half — that a running CLAUDE job still showed the
  // panel — is gone with the panel itself (spec 150). Both tools are
  // asserted panel-free in "Live right now is gone" below.

  test("a Codex step's Cost column is tokens and a dash, never $0.00", () => {
    const html = renderJobDetailPage(
      detail({
        state: "done",
        results: [
          {
            step: "implement", ok: true, tool: "codex", costUsd: 0, costMeasured: false,
            tokens: 9_562, terminalReason: "completed", at: "2026-08-20T10:01:00Z",
          },
        ],
      }),
      "2026-08-20T10:05:00Z",
      NAV,
      { tab: "steps" },
    );
    expect(html).not.toContain("$0.00");
    expect(html).toContain("9.6k tok");
  });
});

// The picker is where a tool is CHOSEN, so the option has to say which
// one it is before it is picked — two entries that differ only in which
// CLI they start would otherwise be two identical-looking names.
describe("the model picker names the tool", () => {
  const codexTarget: QueueTarget = { project: "aide", specFolder: "125-codex" };

  test("a codex entry is distinguishable from a claude one", () => {
    const html = renderQueueRows(
      [],
      {
        runnerAvailable: true,
        targets: [codexTarget],
        modelChoices: [
          { name: "sonnet", budgetUsd: 3 },
          { name: "codex-fast", budgetUsd: 5, tool: "codex" },
        ],
        filter: { open: openKeys([], [codexTarget]) },
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );
    expect(html).toContain("codex-fast");
    expect(html).toMatch(/<option value="codex-fast"[^>]*>[^<]*codex[^<]*<\/option>/);
    // The claude entries are left exactly as they were — the default
    // tool is not a label anyone needs.
    expect(html).toMatch(/<option value="sonnet"[^>]*>sonnet<\/option>/);
  });
});

// --- spec 127: one AI dropdown for the row ----------------------------------
//
// Running a whole row on Codex used to mean changing five model
// dropdowns one at a time and remembering which entries were Codex.
// The row gets ONE control that says which CLI it is about, and the
// five per-phase selects narrow to that tool's models — the per-phase
// pickers spec 123 argued for are untouched, only what each one offers
// answers the new control.
//
// Everything below is about the MARKUP. The filtering itself is
// browser behaviour and is tested where the browser code is
// (`queue-client.test.ts`).
describe("spec 127: the row names its AI once", () => {
  const target = (specFolder = "127-one-ai"): QueueTarget => ({ project: "aide", specFolder });

  const BOTH = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
    { name: "codex-fast", budgetUsd: 5, tool: "codex" as const },
  ];

  const rows = (
    list: QueueRowView[] = [],
    opts: Partial<QueuePageOptions> = {},
    targets: QueueTarget[] = [target()],
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: BOTH,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );

  /** The caption line, read past the stack cell that rides on it. */
  const caption = (html: string) =>
    (html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");

  const pickers = (html: string) => [...html.matchAll(/<select[^>]*data-tool-picker[^>]*>/g)];

  // --- criterion 1 -----------------------------------------------------------

  test("a two-tool config gives the row one AI select, not one per phase", () => {
    const html = rows();
    expect(pickers(html)).toHaveLength(1);
    // And it is on the caption line, above the phases — not inside one.
    expect(caption(html)).toContain("data-tool-picker");
    // Both tools are offered, under names a reader recognises.
    const picker = html.match(/<select[^>]*data-tool-picker[\s\S]*?<\/select>/)![0];
    expect(picker).toContain('value="claude"');
    expect(picker).toContain('value="codex"');
    expect(picker).toContain("Claude Code");
    expect(picker).toContain("Codex");
  });

  // It posts NOTHING: the five `model.<step>` fields are still the whole
  // of what a press sends, so the request shape is untouched.
  test("the AI select carries no name, and rides the row's own run form", () => {
    const html = rows();
    const picker = html.match(/<select[^>]*data-tool-picker[^>]*>/)![0];
    expect(picker).not.toContain("name=");
    const id = html.match(/<form id="([^"]+)"/)![1];
    expect(picker).toContain(`form="${id}"`);
  });

  // --- criterion 2 -----------------------------------------------------------

  test("one tool is nothing to choose between, so no AI select is drawn", () => {
    const html = rows([], { modelChoices: [{ name: "sonnet", budgetUsd: 3 }] });
    // The phase pickers are still there — it is the row control that goes.
    expect(html).toContain('<select name="model.analyze"');
    expect(pickers(html)).toHaveLength(0);
  });

  test("no model configured at all draws no AI select either", () => {
    expect(pickers(rows([], { modelChoices: undefined }))).toHaveLength(0);
  });

  // --- the marker the browser filters on -------------------------------------

  test("every model option says which tool it starts", () => {
    const html = rows();
    expect(html).toMatch(/<option value="sonnet"[^>]*data-tool="claude"/);
    expect(html).toMatch(/<option value="fable"[^>]*data-tool="claude"/);
    expect(html).toMatch(/<option value="codex-fast"[^>]*data-tool="codex"/);
    // Every option on the page carries one — a missing marker is an
    // option the filter would hide whatever the reader picks.
    for (const option of html.matchAll(/<option value="(sonnet|fable|codex-fast)"[^>]*>/g)) {
      expect([option[1], option[0].includes("data-tool=")]).toEqual([option[1], true]);
    }
  });

  // --- criterion 5 -----------------------------------------------------------

  test("a busy row locks its AI select for the same reason as its models", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "127-one-ai", steps: ["implement"], stepIndex: 0, state: "running" })],
      {},
      [target()],
    );
    const picker = html.match(/<select[^>]*data-tool-picker[^>]*>/)![0];
    expect(picker).toContain("disabled");
    expect(picker).toContain('title="implement is running"');
  });

  test("a settled row's AI select is live again", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "127-one-ai", steps: ["implement"], stepIndex: 0, state: "done" })],
    );
    expect(html.match(/<select[^>]*data-tool-picker[^>]*>/)![0]).not.toContain("disabled");
  });

  // --- criterion 6: nothing is filtered before a script runs -----------------

  test("every phase select still offers every configured model, server-side", () => {
    const html = rows();
    for (const step of ["create", "analyze", "review-plan", "implement", "archive"]) {
      const select = html.match(
        new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`),
      )![0];
      for (const m of BOTH) expect([step, select.includes(`value="${m.name}"`)]).toEqual([step, true]);
      expect([step, select.includes("hidden")]).toEqual([step, false]);
    }
  });

  // The row's phases may have run on DIFFERENT tools before this control
  // existed. Nothing about drawing the new select may quietly re-pick
  // for them: what each phase last ran on is what its select still says.
  test("a mixed-tool history keeps every phase's own pre-filled model", () => {
    const html = rows([
      row({ id: "j1", specFolder: "127-one-ai", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" }),
      row({ id: "j2", specFolder: "127-one-ai", steps: ["implement"], stepIndex: 0, state: "done", model: "codex-fast" }),
    ]);
    expect(html.match(/<select name="model\.analyze"[\s\S]*?<\/select>/)![0])
      .toMatch(/<option value="fable"[^>]*selected/);
    expect(html.match(/<select name="model\.implement"[\s\S]*?<\/select>/)![0])
      .toMatch(/<option value="codex-fast"[^>]*selected/);
  });

  // --- the Medium risk in the plan: the caption's pinned columns -------------

  // The caption's first two children are pinned to the checkbox and
  // name widths (`css.ts`), so every phase line's select starts under
  // the word "Model". A control inserted before either of them takes a
  // pinned width and drags the whole caption out of line.
  test("the AI select sits after both pinned caption columns", () => {
    const cap = caption(rows());
    const at = cap.indexOf("data-tool-picker");
    expect(at).toBeGreaterThan(cap.indexOf(">Phase<"));
    expect(at).toBeGreaterThan(cap.indexOf(">Model<"));
  });
});

// --- spec 141: the AI picker says what the row will run on -------------------
//
// The picker was drawn with no `selected` on any option, so a browser
// showed whichever one `modelChoices` happened to list first and called
// it the row's AI. Measured on spec 138's row, 2026-08-20: the select
// read "Claude Code" while four of the five phases below it held Codex
// models. The resting value has to be a stated one, and the model a
// phase with no history falls back to has to be that same tool's.
describe("spec 141: the AI select's resting value is a stated default", () => {
  const target = (specFolder = "141-says-what"): QueueTarget => ({ project: "aide", specFolder });

  /** Codex FIRST, deliberately: the bug is that config order decided
   *  both the picker's resting option and the fallback model, so a list
   *  that leads with Claude cannot tell a fix from its absence. */
  const CODEX_FIRST = [
    { name: "codex-fast", budgetUsd: 5, tool: "codex" as const },
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
  ];

  const rows = (
    list: QueueRowView[] = [],
    opts: Partial<QueuePageOptions> = {},
    targets: QueueTarget[] = [target()],
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: CODEX_FIRST,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );

  const picker = (html: string) => html.match(/<select[^>]*data-tool-picker[\s\S]*?<\/select>/)![0];
  const select = (html: string, step: string) =>
    html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))![0];

  // --- criterion 1 -----------------------------------------------------------

  test("Claude Code is the option marked selected, whatever the config's order", () => {
    const p = picker(rows());
    expect(p).toMatch(/<option value="claude"[^>]*selected/);
    expect(p).not.toMatch(/<option value="codex"[^>]*selected/);
  });

  // --- criterion 2 -----------------------------------------------------------

  test("a phase with no history and no configured model falls back to a Claude one", () => {
    const html = rows();
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      const line = select(html, step);
      // The picked option is a claude entry — not `codex-fast`, which
      // is merely the first thing the configuration lists.
      expect([step, /<option value="sonnet"[^>]*selected/.test(line)]).toEqual([step, true]);
      expect([step, /<option value="codex-fast"[^>]*selected/.test(line)]).toEqual([step, false]);
    }
  });

  test("a configured default still wins over the tool-scoped fallback", () => {
    const line = select(rows([], { defaultModels: { default: "codex-fast" } }), "analyze");
    expect(line).toMatch(/<option value="codex-fast"[^>]*selected/);
  });

  // --- criterion 3: the fallback is reached only when there is no history ----

  test("a phase that ran on Codex still shows the model it ran on", () => {
    const html = rows([
      row({
        id: "j1",
        specFolder: "141-says-what",
        steps: ["implement"],
        stepIndex: 0,
        state: "done",
        model: "codex-fast",
      }),
    ]);
    expect(select(html, "implement")).toMatch(/<option value="codex-fast"[^>]*selected/);
    // And the picker beside it is still resting on its stated default —
    // history is read out by the phase's own select, not by this one.
    expect(picker(html)).toMatch(/<option value="claude"[^>]*selected/);
  });
});

// --- spec 143: a row's long message gets a panel, not the State column -------
//
// Measured on spec 141, 2026-08-20, at 1568px: a 130-character sentence
// out of `4-status.md` was written into the State column — a cell sized
// for a word — where it ran off the right edge of the table and, on an
// open row, was drawn a second time under the archive phase line. Two
// producers feed it (the spec's own held-back reason and the job's
// `error`), and both now write into one wrapping panel row of their
// own, under the head row, once.

describe("spec 143: a long message gets a panel row of its own", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], open = true) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        ...(open ? { filter: { open: openKeys(list, targets) } } : {}),
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );
  /** Everything one spec draws: its head row, its panel and its phase
   *  lines. The duplication this spec removes is only visible across
   *  all three at once, which is why no existing helper caught it. */
  const wholeRow = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  const headRow = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** The State column: third cell of the head row. */
  const stateCell = (html: string) =>
    [...headRow(html).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "")[2] ?? "";
  const panel = (html: string) =>
    html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const subRow = (html: string, phase: string) =>
    (html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "")
      .replace(/<td class="stackcell"[\s\S]*?<\/td>/, "");
  const BUILT = ["analyze", "review-plan", "implement"];
  const REASON =
    'the manual browser check (Phase 4, still "Not started"): fresh load shows ' +
    "Claude Code selected, hand ticks survive one 5s refresh";

  // Criterion 1.
  test("the held-back sentence is written once for the whole row, panel included", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "done" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
    );
    expect([...wholeRow(html).matchAll(/hand ticks survive/g)]).toHaveLength(1);
  });

  // Criterion 1: the State column keeps the word and loses the sentence.
  test("the State column says the short word and never the reason", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "done" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
    );
    expect(stateCell(html)).toContain("archive held back");
    expect(stateCell(html)).not.toContain("hand ticks survive");
  });

  // Criterion 1: the panel itself — full width, and the existing
  // wrapping message component rather than new markup.
  test("the panel is a full-width row under the head row, built from rowMessage", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "done" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
    );
    expect(panel(html)).toContain('data-folder="141-says-what"');
    expect(panel(html)).toContain('colspan="6"');
    expect(panel(html)).toContain("rowmsg");
    expect(panel(html)).toContain("hand ticks survive");
    // Under the head row, not above it.
    expect(html.indexOf('<tr class="specnotice"')).toBeGreaterThan(html.indexOf('<tr class="spechead'));
  });

  // Criterion 1 again, for a row nobody opened: the panel is not a
  // thing you have to expand the row to be told.
  test("a collapsed row gets the panel too", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "done" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
      false,
    );
    expect(panel(html)).toContain("hand ticks survive");
    expect(stateCell(html)).not.toContain("hand ticks survive");
  });

  // Criterion 2: the qualifier loses the reason and keeps everything
  // else it ever said.
  test("the archive phase line keeps its own re-run qualifier without the reason", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "failed" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
    );
    const archive = subRow(html, "archive");
    expect(archive).toContain("held back");
    expect(archive).toContain("last re-run failed");
    expect(archive).not.toContain("hand ticks survive");
  });

  // The second producer, and the one the description names first: a run
  // that was refused or failed writes a full sentence into `error`.
  test("a job's error is written in the panel, not in the State cell (criterion 3)", () => {
    const html = rows(
      [
        row({
          id: "dirty",
          specFolder: "141-says-what",
          steps: ["implement"],
          state: "failed",
          error: "the specs tree is dirty: /Users/ragnar/develop/aide-specs",
        }),
      ],
      [target("141-says-what")],
    );
    expect(panel(html)).toContain("the specs tree is dirty");
    expect(stateCell(html)).not.toContain("the specs tree is dirty");
    expect([...wholeRow(html).matchAll(/the specs tree is dirty/g)]).toHaveLength(1);
    // The bare cell rendering it used to get is gone from both the head
    // row and the phase line.
    expect(subRow(html, "implement")).not.toContain("the specs tree is dirty");
  });

  // Criterion 6: a message from an earlier attempt must not stand next
  // to a run that is under way.
  test("a new run on the row clears the panel", () => {
    for (const state of ["running", "queued"] as const) {
      const html = rows(
        [
          row({ id: "retry", specFolder: "141-says-what", steps: ["archive"], state }),
          row({
            id: "old",
            specFolder: "141-says-what",
            steps: ["archive"],
            state: "failed",
            error: "the specs tree is dirty: /Users/ragnar/develop/aide-specs",
          }),
        ],
        [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
      );
      expect(panel(html)).toBe("");
      expect(wholeRow(html)).not.toContain("hand ticks survive");
      expect(wholeRow(html)).not.toContain("the specs tree is dirty");
    }
  });

  // A spec nothing has ever run has no message and no panel: an empty
  // `.rowmsg` draws nothing, but an empty `<tr>` is still a row.
  test("a row with nothing to say has no panel row at all", () => {
    const html = rows([], [target("141-says-what")]);
    expect(html).not.toContain('<tr class="specnotice"');
  });
});

// --- spec 143: the same message on the phase's own detail page ---------------
//
// Requirement 2 of 1-description.md: the message is also written into
// Activity, where that phase already reports what it did. Today only
// one case reaches it — a run refused before it ever started.

describe("spec 143: the Activity tab carries the message too", () => {
  const archiveJob = (extra: Partial<JobDetailView> = {}): JobDetailView =>
    detail({
      id: "job-archive",
      state: "done",
      steps: ["archive"],
      activity: [],
      results: [
        {
          step: "archive", ok: true, costUsd: 0.1, costMeasured: true,
          terminalReason: "completed", at: "2026-08-20T10:01:00Z",
        },
      ],
      ...extra,
    });
  /** The open tab's own panel. The page's banner already repeats
   *  `job.error` above the tabs on every tab, so a count taken over the
   *  whole page would answer a different question than this block asks. */
  const activityTab = (job: JobDetailView) =>
    renderJobDetailPage(job, "2026-08-20T10:05:00Z", NAV, { tab: "activity" }).match(
      /<div class="tabpanel">[\s\S]*?<\/div>/,
    )?.[0] ?? "";

  // Criterion 4: the archive run that finished successfully and moved
  // nothing. It neither streamed anything nor was refused, so it fell
  // through to "nothing captured" and the reason was nowhere.
  test("an archive job that was held back says so in Activity", () => {
    const html = activityTab(archiveJob({ archiveHeldBack: "the Slack webhook (Phase 4, still unchecked)" }));
    expect(html).toContain("the Slack webhook (Phase 4, still unchecked)");
    expect(html).not.toContain("Nothing has been captured");
  });

  // The note is the SPEC's, and it belongs to archive. A job that ran
  // some other step must not report it as its own.
  test("a job that did not run archive does not show the spec's held-back note", () => {
    const html = activityTab(
      archiveJob({
        steps: ["implement"],
        results: [
          {
            step: "implement", ok: true, costUsd: 0.1, costMeasured: true,
            terminalReason: "completed", at: "2026-08-20T10:01:00Z",
          },
        ],
        archiveHeldBack: "the Slack webhook (Phase 4, still unchecked)",
      }),
    );
    expect(html).not.toContain("the Slack webhook");
    expect(html).toContain("Nothing has been captured");
  });

  // Criterion 5: a job that streamed real work and THEN failed. The
  // transcript ends mid-air and never says why.
  test("a job that streamed and then failed ends its Activity with the reason", () => {
    const html = activityTab(
      archiveJob({
        state: "failed",
        activity: ["Bash ls", "Edit src/render/css.ts"],
        error: "the specs tree is dirty: /Users/ragnar/develop/aide-specs",
      }),
    );
    expect(html).toContain("Edit src/render/css.ts");
    expect(html).toContain("the specs tree is dirty");
  });

  test("the reason is not repeated when the last streamed line already said it", () => {
    const html = activityTab(
      archiveJob({
        state: "failed",
        activity: ["Bash ls", "the tree is dirty"],
        error: "the tree is dirty",
      }),
    );
    expect([...html.matchAll(/the tree is dirty/g)]).toHaveLength(1);
  });

  // Unchanged: a refusal before the run started still reads as one.
  test("a run refused before it started still says so, with its reason", () => {
    const html = activityTab(
      archiveJob({
        state: "failed",
        activity: [],
        results: [
          {
            step: "archive", ok: false, costUsd: 0, costMeasured: false,
            terminalReason: "refused", at: "2026-08-20T10:01:00Z",
          },
        ],
        error: "held back: depends on 80-dependency, whose branch is not merged yet",
      }),
    );
    expect(html).toContain("refused before it started");
    expect(html).toContain("held back: depends on 80-dependency");
  });
});

// --- spec 150: the job page's Overview, cut to what is said nowhere else -----
//
// The Overview's labelled list repeated the heading (Project, Spec), the
// pips (Step) and the row (Work), and then a "Live right now" panel
// answered `State not-live · Subagents – · Cost so far – · Session
// decc8861` for a run in a worktree — a panel that exists for exactly
// that moment and answered with dashes. What is left is the three facts
// the page is the only place for, and the file the phase actually made.

describe("the Overview's facts table (criterion 10)", () => {
  const facts = (html: string): string[] =>
    [...html.matchAll(/<td class="label">([\s\S]*?)<\/td>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  test("exactly three rows: Started, Cost so far, Model", () => {
    const html = renderJobDetailPage(
      detail({ state: "done", model: "sonnet" }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(facts(html)).toEqual(["Started", "Cost so farTokens so far", "Model"]);
  });

  test("the four facts said elsewhere are gone, branch list included", () => {
    const html = renderJobDetailPage(
      detail({
        state: "done",
        branchUrls: [{ label: "aide", url: "https://example.test/compare", merged: false }],
      }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(facts(html)).not.toContain("Project");
    expect(facts(html)).not.toContain("Spec");
    expect(facts(html)).not.toContain("Step");
    expect(facts(html)).not.toContain("Work");
    expect(html).not.toContain("https://example.test/compare");
  });

  // The heading is where the spec is named, and it stays: whichever tab
  // is open, a reader still has to know which job this is.
  test("the spec's own name and title stay above the tabs", () => {
    const html = renderJobDetailPage(
      detail({ state: "done", title: "One page shows the whole spec" }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("One page shows the whole spec");
    expect(html).toContain("02-job-detail-view");
  });
});

describe("Live right now is gone (criterion 9)", () => {
  for (const tool of ["claude", "codex"] as const) {
    test(`a running ${tool} job does not show it`, () => {
      const html = renderJobDetailPage(
        detail({ state: "running", tool }),
        "2026-08-21T10:05:00Z",
        NAV,
        { tab: "overview" },
      );
      expect(html).not.toContain("Live right now");
      expect(html).not.toContain("Subagents");
    });
  }

  for (const state of ["queued", "done", "failed", "cancelled"] as const) {
    test(`nor does a ${state} one`, () => {
      const html = renderJobDetailPage(
        detail({ state }),
        "2026-08-21T10:05:00Z",
        NAV,
        { tab: "overview" },
      );
      expect(html).not.toContain("Live right now");
    });
  }
});

// A phase's own page shows what that phase MADE. Which file that is per
// step is the server's answer (`specPhaseFile`); this is the page
// showing whatever it was handed.
describe("a phase's page shows that phase's own file", () => {
  const withPhase = (label: string, text: string | null) =>
    renderJobDetailPage(
      detail({ state: "done", phase: { label, text } }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );

  test("the file is named and its content shown, preformatted", () => {
    const html = withPhase("2-analysis.md", "## Findings\n\nspecTitle() and specDescription().");
    expect(html).toContain("2-analysis.md");
    expect(html).toContain("specTitle() and specDescription().");
    expect(html).toContain("<pre");
  });

  test("its text is escaped — a spec file is text off disk, not markup", () => {
    const html = withPhase("2-analysis.md", "<b>not bold</b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>not bold</b>");
  });

  test("a phase that has written nothing yet says so", () => {
    const html = withPhase("2-analysis.md", null);
    expect(html).toContain("has not been written yet");
  });

  test("a job whose step made no file of its own shows the facts and nothing else", () => {
    const html = renderJobDetailPage(detail({ state: "done" }), "2026-08-21T10:05:00Z", NAV, {
      tab: "overview",
    });
    expect(html).not.toContain("<pre");
    expect(html).toContain("Started");
  });

  test("it belongs to the Overview — the other tabs are unchanged", () => {
    const job = detail({
      state: "done",
      phase: { label: "4-status.md", text: "## Phase 1: RED" },
      activity: ["Bash ls"],
    });
    expect(renderJobDetailPage(job, "2026-08-21T10:05:00Z", NAV, { tab: "activity" })).not.toContain(
      "Phase 1: RED",
    );
  });
});
