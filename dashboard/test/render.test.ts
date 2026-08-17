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
  test("collisions and the reserved index name get numeric suffixes", () => {
    const tricky = renderSite(
      [project("My Proj"), project("my-proj"), project("index"), project("About"),
       project("Claude Certified Architect")],
      generatedAt,
    );
    // `about` is reserved like `index`: both name a page the nav links
    // to, so a project called either gets suffixed instead of
    // overwriting it.
    expect(tricky.map((p) => p.path).sort()).toEqual([
      "about-2.html",
      "about.html",
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
    expect(page).toContain('<li class="nav-label">Projects</li>');
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

  test("an unmerged branch is called out on the queue row (criterion 1)", () => {
    const html = queueRows({ branchUrls: at(false) });
    expect(html).toContain("not merged");
    // The link a reader already uses is untouched beside it.
    expect(html).toContain(`href="${BRANCH}"`);
  });

  test("once the branch lands the caveat goes, and the link stays (criterion 2)", () => {
    const html = queueRows({ branchUrls: at(true) });
    expect(html).not.toContain("not merged");
    expect(html).toContain(`href="${BRANCH}"`);
  });

  test("the job page's Work row says the same thing (criterion 3)", () => {
    expect(jobPage({ branchUrls: at(false) })).toContain("not merged");
    expect(jobPage({ branchUrls: at(true) })).not.toContain("not merged");
  });

  test("no branch, no badge — on either page (criterion 4)", () => {
    expect(queueRows({ branchUrls: [] })).not.toContain("not merged");
    expect(queueRows({})).not.toContain("not merged");
    expect(jobPage({ branchUrls: [] })).not.toContain("not merged");
    expect(jobPage({})).not.toContain("not merged");
  });

  // Spec 89: the two branches share a NAME and nothing else. One badge
  // over both was the blind spot — the project's landed, the specs
  // repo's did not, and the page said nothing.
  test("two repos get two links and two independent badges", () => {
    const html = queueRows({
      branchUrls: [
        { label: "aide", url: "https://example.test/aide", merged: true },
        { label: "aide-specs", url: "https://example.test/aide-specs", merged: false },
      ],
    });
    expect(html.match(/not merged/g)).toHaveLength(1);
    expect(html).toContain("https://example.test/aide-specs");
    expect(html).toContain("aide-specs");
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
    expect(html).not.toContain("<link ");
    // The job page belongs to /specs, so that nav entry is the current one.
    expect(html).toContain('<a class="current" href="/specs">Specs</a>');
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

  const rows = (list: QueueRowView[]) =>
    renderQueueRows(list, { runnerAvailable: true, targets: [] }, Date.parse("2026-08-17T12:00:00Z"));

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
    expect(head).toContain('class="state s-running"');
    expect(head).not.toContain('class="state s-done"');
  });

  test("with nothing in flight the header shows the latest outcome (criterion 5)", () => {
    const html = rows([
      job("j1", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain('class="state s-done"');
    expect(head).not.toContain('class="state s-failed"');
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
    expect(html.match(/not merged/g)).toHaveLength(1);
    // The link comes from the most recently active job, not an older one.
    expect(html).toContain("https://example.test/compare");
    expect(html).not.toContain("https://example.test/old");
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain("not merged");
  });

  test("the action sits once on the header, never on a phase line (criterion 12)", () => {
    const html = rows([
      job("j1", "analyze", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "running", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    expect(html.match(/<form method="post" action="\/api\/queue\/j2\/cancel">/g)).toHaveLength(1);
    // Approve/cancel is the SPEC's one action and belongs on the header.
    // A phase line carries its own run form (spec 87) and nothing else.
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

// --- spec 87: a phase runs from where it sits --------------------------------

// The place where you can SEE that review-plan has not run was not the
// place where you could run it. Now it is: every phase line carries the
// one-step job it names, and the model to run it on.
describe("a phase runs from its own line (criteria 1-6)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "87-run-from-the-list", steps: [step], stepIndex: 0, state: "done", ...extra });

  const rows = (list: QueueRowView[], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets: [], ...opts },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  test("the form posts the one step its line names, to the endpoint the top form uses", () => {
    const html = rows([job("j1", "analyze")]);
    const implement = subRow(html, "implement");
    expect(implement).toContain('<form method="post" action="/api/queue"');
    expect(implement).toContain('name="project" value="aide"');
    expect(implement).toContain('name="specFolder" value="87-run-from-the-list"');
    expect(implement).toContain('name="steps" value="implement"');
    // One step per form: the analyze line must not offer to run implement.
    expect(subRow(html, "analyze")).toContain('name="steps" value="analyze"');
  });

  test("a phase never run says Run; one that has says Rerun (criteria 1-2)", () => {
    const html = rows([job("j1", "analyze")]);
    expect(subRow(html, "analyze")).toContain(">Rerun<");
    expect(subRow(html, "review-plan")).toContain(">Run<");
  });

  test("the line offers the configured models, and a default that changes nothing (criteria 3-4)", () => {
    const html = rows([job("j1", "analyze")], {
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12 }],
    });
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain('name="model"');
    expect(analyze).toContain('value="fable"');
    expect(analyze).toContain('<option value="">');
  });

  test("with no model configured the line offers no dropdown at all", () => {
    const html = rows([job("j1", "analyze")]);
    expect(subRow(html, "analyze")).not.toContain('name="model"');
  });

  test("the token rides along when the page carries one", () => {
    const html = rows([job("j1", "analyze")], { token: "s3cret" });
    expect(subRow(html, "analyze")).toContain('name="token" value="s3cret"');
  });

  test("a phase with an unfinished attempt is disabled; its siblings are not (criterion 5)", () => {
    for (const state of ["queued", "running", "awaiting-approval"] as const) {
      const html = rows([
        job("j1", "analyze", { state, startedAt: "2026-08-17T11:00:00Z" }),
        job("j2", "implement", { state: "done", startedAt: "2026-08-17T10:00:00Z" }),
      ], { modelChoices: [{ name: "fable", budgetUsd: 12 }] });
      const analyze = subRow(html, "analyze");
      expect(analyze).toContain("<button type=\"submit\" disabled>");
      // The dropdown goes with it: a choice you cannot act on is a trap.
      expect(analyze).toContain('<select name="model" disabled>');
      expect(subRow(html, "implement")).not.toContain("disabled");
      expect(subRow(html, "archive")).not.toContain("disabled");
    }
  });

  test("once the attempt finishes the same line is enabled again (criterion 6)", () => {
    const html = rows([job("j1", "analyze", { state: "done" })]);
    expect(subRow(html, "analyze")).not.toContain("disabled");
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
      { runnerAvailable: true, targets, ...opts },
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

  test("the analyze line of a never-run spec runs it (criterion 2)", () => {
    const html = rows([], [target("90-never-run")]);
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain('<form method="post" action="/api/queue"');
    expect(analyze).toContain('name="project" value="aide"');
    expect(analyze).toContain('name="specFolder" value="90-never-run"');
    expect(analyze).toContain('name="steps" value="analyze"');
    expect(analyze).toContain(">Run<");
    expect(analyze).not.toContain("disabled");
  });

  test("a never-run spec reads 'not started' and links to no job (criterion 3)", () => {
    const html = rows([], [target("90-never-run")]);
    const line = head(html, "90-never-run");
    // Hyphen in the class, space in the text: one is the filter key, the
    // other is what the reader sees.
    expect(line).toContain('<span class="state s-not-started">not started</span>');
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
    expect(html).toMatch(/>All <span class="tabcount">2<\/span>/);
    expect(html).toMatch(/>Not started <span class="tabcount">1<\/span>/);
    expect(html).toMatch(/>Active <span class="tabcount">0<\/span>/);
    expect(html).toMatch(/>Done <span class="tabcount">1<\/span>/);
    expect(html).toMatch(/>Problems <span class="tabcount">0<\/span>/);

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

  test("every spec row carries an expanded fold control (criterion 11)", () => {
    const html = rows([target("90-x")]);
    const line = head(html, "90-x");
    expect(line).toContain('aria-expanded="true"');
    // Percent-encoded, because `queueHref` encodes each value. The raw
    // key appears in no href under any implementation.
    expect(line).toContain("fold=aide%2F90-x");
  });

  test("a folded spec loses its phase lines, not its header (criterion 12)", () => {
    const html = rows([target("90-x")], { fold: "aide/90-x" });
    const line = head(html, "90-x");
    expect(line).not.toBe("");
    expect(html).not.toContain('<tr class="subrow');
    expect(line).toContain('aria-expanded="false"');
    // Its own control now UNfolds: the encoded key is gone from its href.
    expect(line).not.toContain("fold=aide%2F90-x");
  });

  test("folding one spec leaves the other's phases alone (criterion 13)", () => {
    const html = rows([target("90-x"), target("90-y")], { fold: "aide/90-x" });
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(html).toContain(`data-step="${step}"`);
    }
    // The other spec's own fold href gains the folded key too — the
    // whole filter travels through `queueHref`.
    expect(head(html, "90-y")).toContain("fold=aide%2F90-x%2Caide%2F90-y");
  });

  test("a fold key naming no spec leaves every real spec expanded (criterion 14)", () => {
    const html = rows([target("90-x")], { fold: "aide/nope" });
    expect(html.match(/<tr class="subrow/g)).toHaveLength(4);
    expect(head(html, "90-x")).toContain('aria-expanded="true"');
  });

  test("the filter, sort and project links keep the fold (criterion 15)", () => {
    const html = rows([target("90-x"), target("90-y")], { fold: "aide/90-x", state: "not-started" });
    // Every state chip and every sortable column header keeps it.
    const links = [...html.matchAll(/<a data-nav href="([^"]+)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(4);
    for (const href of links) expect(href).toContain("fold=aide%2F90-x");
  });
});
