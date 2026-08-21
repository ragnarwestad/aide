// Spec 150: the dashboard never showed a spec — it showed jobs.
//
// Every link on a spec's row went to one queue RUN, whose Overview
// showed the `## Description` prose and then that run's own figures.
// Nothing on the dashboard showed 2-analysis.md, 3-solution.md or
// 4-status.md — the files the analyze, review-plan and implement steps
// exist to write — so a reader who wanted to know what a phase produced
// left the dashboard for GitHub or the filesystem.
//
// The spec page is the whole spec as it stands now: four files, in
// order, each stamped with the commit that last touched it.

import { describe, expect, test } from "bun:test";
import { renderJobDetailPage, renderSpecPage, type SpecPageView } from "../src/render.ts";
import type { JobDetailView } from "../src/render.ts";

const NAV = [{ label: "Overview", path: "projects.html" }];
const GENERATED = "2026-08-21T10:05:00Z";
const NOW = Date.parse("2026-08-21T10:05:00Z");

const file = (name: string, text: string | null, extra: Partial<SpecPageView["files"][number]> = {}) => ({
  label: name,
  text,
  sha: "a3f9c21deadbeef",
  at: "2026-08-21T09:14:00+02:00",
  ...extra,
});

const view = (extra: Partial<SpecPageView> = {}): SpecPageView => ({
  project: "aide",
  specFolder: "150-one-page-shows-the-whole-spec",
  title: "One page shows the whole spec",
  files: [
    file("1-description.md", "## Description\n\nThe dashboard never shows a spec.\n"),
    file("2-analysis.md", "## Findings\n\n`discover.ts` has specTitle().\n"),
    file("3-solution.md", "## Recommended solution\n\nApproach 1.\n"),
    file("4-status.md", "## Phase 1: RED\n\n| Task | Status |\n"),
  ],
  updateAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/update",
  ...extra,
});

const lead = (extra: Partial<JobDetailView> = {}): JobDetailView => ({
  id: "job-1234",
  project: "aide",
  specFolder: "150-one-page-shows-the-whole-spec",
  steps: ["implement"],
  stepIndex: 0,
  state: "done",
  spentUsd: 1.5,
  timeoutSec: 1200,
  createdAt: "2026-08-21T09:00:00Z",
  results: [],
  ...extra,
});

const page = (v: SpecPageView = view(), tab?: string) =>
  renderSpecPage(v, GENERATED, NAV, { tab, now: NOW });

// --- criterion 1: the whole spec, in order ----------------------------------

describe("the spec page's Overview is the four files", () => {
  test("all four are shown, in the order they are written and read", () => {
    const html = page();
    const at = (name: string) => html.indexOf(name);
    expect(at("1-description.md")).toBeGreaterThan(-1);
    expect(at("2-analysis.md")).toBeGreaterThan(at("1-description.md"));
    expect(at("3-solution.md")).toBeGreaterThan(at("2-analysis.md"));
    expect(at("4-status.md")).toBeGreaterThan(at("3-solution.md"));
  });

  test("each file's own content is on the page, whole", () => {
    const html = page();
    expect(html).toContain("The dashboard never shows a spec.");
    expect(html).toContain("Approach 1.");
    expect(html).toContain("Phase 1: RED");
  });

  test("each file carries the commit that last changed it, so the version is readable", () => {
    const html = page();
    expect(html).toContain("a3f9c21");
    expect(html).toContain("2026-08-21T09:14:00+02:00");
  });

  test("a file git cannot date is still shown — the content is the point", () => {
    const html = page(
      view({ files: [file("1-description.md", "prose", { sha: undefined, at: undefined })] }),
    );
    expect(html).toContain("prose");
    expect(html).not.toContain("undefined");
  });

  // A spec halfway through the workflow has files that are not written
  // yet. Saying so is the answer; an empty box is not.
  test("a file that has not been written says so, rather than showing nothing", () => {
    const html = page(view({ files: [file("2-analysis.md", null)] }));
    expect(html).toContain("2-analysis.md");
    expect(html).toContain("has not been written yet");
  });

  // Markdown is NOT rendered (the description put that out of scope) —
  // which makes escaping the whole question: a spec file is arbitrary
  // text off disk, and it is full of angle brackets.
  test("a file's text is escaped, never markup", () => {
    const html = page(view({ files: [file("2-analysis.md", "`<script>alert(1)</script>`")] }));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)");
  });
});

// --- criterion 2: a spec that has never run ---------------------------------

describe("a spec with no job at all", () => {
  test("renders, and says it has not started rather than pretending a state", () => {
    const html = page();
    expect(html).toContain("not started");
    expect(html).toContain("The dashboard never shows a spec.");
  });

  test("its Activity and Steps tabs say what an empty job's tabs say", () => {
    expect(page(view(), "activity")).toContain("Nothing has been captured");
    expect(page(view(), "steps")).toContain("No step has finished yet");
  });

  test("its tabs are offered all the same — an empty tab is still a tab", () => {
    const html = page();
    const base = "/specs/aide/150-one-page-shows-the-whole-spec";
    for (const tab of ["overview", "activity", "steps"]) {
      expect(html).toContain(`href="${base}?tab=${tab}"`);
    }
  });
});

describe("a spec with a lead job", () => {
  const withLead = (extra: Partial<JobDetailView> = {}) => view({ lead: lead(extra) });

  test("the banner shows the job's own state, not the not-started one", () => {
    const html = page(withLead({ state: "running" }));
    expect(html).not.toContain("not started");
  });

  test("the Activity tab is the lead job's, word for word", () => {
    const html = page(withLead({ activity: ["Bash ls"] }), "activity");
    expect(html).toContain("Bash ls");
  });

  test("the Steps tab is the lead job's, word for word", () => {
    const html = page(
      withLead({
        results: [
          {
            step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
            terminalReason: "completed", at: "2026-08-21T09:01:00Z",
          },
        ],
      }),
      "steps",
    );
    expect(html).toContain("$0.42");
  });

  test("the tab counts come from the lead job, so a reader knows before clicking", () => {
    const html = page(withLead({ activity: ["Bash ls", "Read x"] }));
    expect(html).toMatch(/>Activity · 2</);
  });

  // The page is about the SPEC, so it opens on the spec — even while a
  // step is running. The job page keeps its own rule (a running job
  // opens on the activity), because that page is about the run.
  test("it opens on the Overview, running or not", () => {
    const html = page(withLead({ state: "running" }));
    expect(html).toMatch(/aria-current="page"[^>]*>Overview/);
  });
});

// --- criteria 3, 4: the Update button ---------------------------------------

describe("the Update button", () => {
  test("posts to the spec's own update action", () => {
    const html = page();
    expect(html).toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/update"');
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toContain("Update");
  });

  test("a refusal is shown on the page the button was pressed from", () => {
    const html = page(view({ error: "the specs checkout has uncommitted changes" }));
    expect(html).toContain("the specs checkout has uncommitted changes");
  });

  test("what the pull DID is shown the same way", () => {
    const html = page(view({ notice: { note: "pulled a3f9c21 → 7b1e004", ok: true } }));
    expect(html).toContain("pulled a3f9c21 → 7b1e004");
  });
});

// --- the frame --------------------------------------------------------------

describe("the spec page is a page of this site like any other", () => {
  test("it is self-contained and carries the shared nav, with Specs current", () => {
    const html = page();
    expect(html).not.toContain("<script src");
    expect(html).toContain('<a class="brand" href="/">');
    expect(html).toMatch(/<nav[^>]*>[\s\S]*aria-current="page"[^>]*>Specs<\/a>/);
  });

  test("a tab name nobody offers falls back to the Overview instead of a blank page", () => {
    const html = page(view(), "../secrets");
    expect(html).toContain("The dashboard never shows a spec.");
    expect(html).toMatch(/aria-current="page"[^>]*>Overview/);
  });

  test("the open tab is marked, and it is the only one on the page proper", () => {
    const html = page(view(), "steps");
    const body = html.replace(/<nav[^>]*>[\s\S]*?<\/nav>/, "");
    expect(body.match(/aria-current="page"/g)).toHaveLength(1);
    expect(body).toMatch(/aria-current="page"[^>]*>Steps/);
  });

  test("the tab group is captioned for the spec, not for a job", () => {
    expect(page()).toContain('<span class="lbl">Spec</span>');
    expect(page()).not.toContain('<span class="lbl">Job</span>');
  });

  test("no Live right now panel exists here either", () => {
    expect(page(view({ lead: lead({ state: "running" }) }))).not.toContain("Live right now");
  });
});

// The two pages share the tab bar, the activity block and the steps
// table rather than each carrying a copy — `development.md` names the
// two-copies-of-one-shape problem three times over (`WORKFLOW_STEPS`,
// `DEPENDENCY_GATED_STEPS`, project readiness) as this repo's own
// recurring cost, and a second tab bar would have been the fourth.
// Byte-for-byte, so a change to one that is not a change to the other
// is a failure here rather than a drift nobody sees.
describe("the shared panels are the job page's own", () => {
  const job = lead({
    activity: ["Bash ls", "Read x"],
    results: [
      {
        step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
        terminalReason: "completed", at: "2026-08-21T09:01:00Z",
      },
    ],
  });

  /** What sits inside `.tabpanel`, without the frame around it. */
  const panelOf = (html: string): string =>
    html.match(/<div class="tabpanel">([\s\S]*?)<\/div>\s*<\/main>/)?.[1] ?? "NO PANEL";

  for (const tab of ["activity", "steps"] as const) {
    test(`the ${tab} panel is identical on both pages`, () => {
      const onSpec = panelOf(renderSpecPage(view({ lead: job }), GENERATED, NAV, { tab, now: NOW }));
      const onJob = panelOf(renderJobDetailPage(job, GENERATED, NAV, { tab, now: NOW }));
      expect(onSpec).not.toBe("NO PANEL");
      expect(onSpec).toBe(onJob);
    });
  }

  test("and so are the two empty states, for a spec no job has ever run", () => {
    const empty = view();
    // Not the extractor failing on both sides and agreeing about it.
    expect(panelOf(renderSpecPage(empty, GENERATED, NAV, { tab: "steps", now: NOW }))).toContain(
      "No step has finished yet",
    );
    expect(panelOf(renderSpecPage(empty, GENERATED, NAV, { tab: "activity", now: NOW }))).toBe(
      panelOf(renderJobDetailPage(lead({ activity: [] }), GENERATED, NAV, { tab: "activity", now: NOW })),
    );
    expect(panelOf(renderSpecPage(empty, GENERATED, NAV, { tab: "steps", now: NOW }))).toBe(
      panelOf(renderJobDetailPage(lead(), GENERATED, NAV, { tab: "steps", now: NOW })),
    );
  });
});
