// Spec 150: the dashboard never showed a spec — it showed jobs.
//
// Every link on a spec's row went to one queue RUN, whose Overview
// showed the `## Description` prose and then that run's own figures.
// Nothing on the dashboard showed 2-analysis.md, 3-solution.md or
// 4-status.md — the files the analyze and implement steps exist to
// write — so a reader who wanted to know what a phase produced
// left the dashboard for GitHub or the filesystem.
//
// The spec page is the whole spec as it stands now: four files, in
// order, each stamped with the commit that last touched it.

import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderSpecEditPage,
  renderSpecPage,
  type SpecCheckView,
  type SpecEditPageView,
  type SpecPageView,
} from "../src/render.ts";
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

// --- spec 162: the Edit link, and the page it opens -------------------------
//
// One of the four files is a person's to write. `2-analysis.md` and
// `3-solution.md` are the analyze step's output and a hand edit there
// is overwritten the next time it runs; `4-status.md`
// has been the runner's since spec 154. So the link is on
// `1-description.md` and on nothing else — including the phase file the
// JOB page shows through the same `specFilePanel`.

describe("the Edit link", () => {
  test("is on the description and on none of the other three files", () => {
    const html = page();
    const href = "/specs/aide/150-one-page-shows-the-whole-spec/edit";
    expect(html).toContain(`href="${href}"`);
    expect(html.split(`href="${href}"`)).toHaveLength(2);
    expect(html).toContain("Edit");
  });

  test("is absent when the description is not among the files shown", () => {
    const html = page(view({ files: [file("2-analysis.md", "## Findings\n")] }));
    expect(html).not.toContain("/edit");
  });

  // Spec 163: an archived spec is a RECORD. Editing was built for a
  // description that is edited WHILE the work is live (spec 162), and
  // Save on an archived spec would have written, committed and pushed
  // into `archive/`.
  test("is gone on an archived spec, replaced by a note that says why", () => {
    const html = page(view({ archived: true }));
    expect(html).not.toContain("/edit");
    expect(html).toContain("archived");
  });

  // The job page draws its phase's file through the same function. A
  // step's own output is not a thing to hand-edit, and an Edit link
  // there would post the wrong file's text at the description's route.
  test("never appears on a job page's phase file", () => {
    const html = renderJobDetailPage(
      lead({ phase: { label: "2-analysis.md", text: "## Findings\n", sha: "a3f9c21", at: "2026-08-21T09:14:00+02:00" } }),
      GENERATED,
      NAV,
      { now: NOW },
    );
    expect(html).toContain("2-analysis.md");
    expect(html).not.toContain("/edit");
  });
});

describe("the edit page", () => {
  const editView = (extra: Partial<SpecEditPageView> = {}): SpecEditPageView => ({
    project: "aide",
    specFolder: "150-one-page-shows-the-whole-spec",
    file: "1-description.md",
    text: "## Description\n\nThe dashboard never shows a spec.\n",
    dependsOnOptions: [],
    dependsOnChecked: [],
    baseSha: "a3f9c21deadbeef",
    saveAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save",
    ...extra,
  });
  const edit = (v: SpecEditPageView = editView()) => renderSpecEditPage(v, GENERATED, NAV);

  test("holds the file's current text in a real textarea, in a real form", () => {
    const html = edit();
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save"');
    expect(html).toContain("<textarea");
    expect(html).toContain("The dashboard never shows a spec.");
  });

  // The whole point of the hidden field: the page is rendered once and
  // a reader may sit on it while an analyze step lands a new version.
  test("carries the commit the text was read at, so a save can be refused", () => {
    expect(edit()).toContain('value="a3f9c21deadbeef"');
  });

  // A spec whose description git has never seen still opens: the field
  // is empty rather than the word "undefined".
  test("a file with no commit yet opens all the same", () => {
    const html = edit(editView({ baseSha: undefined }));
    expect(html).toContain("<textarea");
    expect(html).not.toContain("undefined");
  });

  test("the text is escaped — a description is arbitrary text off disk", () => {
    const html = edit(editView({ text: "</textarea><script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;/textarea&gt;");
  });

  // A ten-second meta refresh on a page with a textarea on it wipes
  // whatever the reader was half-way through typing.
  test("does not refresh itself under the reader", () => {
    expect(edit()).not.toContain("http-equiv=\"refresh\"");
  });

  test("a refused save has somewhere to show its reason", () => {
    const html = edit(editView({ error: "1-description.md has changed since you opened it" }));
    expect(html).toContain("1-description.md has changed since you opened it");
  });

  test("Cancel goes back to the spec, having posted nothing", () => {
    const html = edit();
    expect(html).toContain('href="/specs/aide/150-one-page-shows-the-whole-spec"');
    expect(html).toContain("Cancel");
  });

  test("carries the token for a browser that got the page with one", () => {
    expect(edit(editView({ token: "s3cret" }))).toContain('name="token" value="s3cret"');
  });

  // --- spec 174: the same picker the New-spec page has ---------------------
  //
  // Spec 166 shipped this as a free-text input because its own
  // description asked for "a field" without saying which control. The
  // New-spec page already had the right one — a checkbox per existing
  // spec — so this page calls the same function rather than a second
  // copy of the markup.
  describe("the Depends on picker", () => {
    const OPTIONS = [
      { project: "aide", specFolder: "164-a-spec-can-depend" },
      { project: "aide", specFolder: "09-ninth" },
    ];
    const withOptions = (checked: string[] = []) =>
      edit(editView({ dependsOnOptions: OPTIONS, dependsOnChecked: checked }));

    test("one checkbox per spec offered, not a text box to type into", () => {
      const html = withOptions();
      expect(html).toContain('name="dependsOn"');
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('value="164-a-spec-can-depend"');
      expect(html).toContain('value="09-ninth"');
      expect(html).not.toContain('<input type="text" name="dependsOn"');
    });

    // The same order the New-spec page draws: newest first, because the
    // number is the order a reader thinks in.
    test("newest first, as on the New-spec page", () => {
      const html = withOptions();
      expect(html.indexOf('value="164-a-spec-can-depend"')).toBeLessThan(html.indexOf('value="09-ninth"'));
    });

    test("what the spec already depends on is ticked", () => {
      const html = withOptions(["164-a-spec-can-depend"]);
      expect(html).toMatch(/value="164-a-spec-can-depend"[^>]*checked/);
      expect(html).not.toMatch(/value="09-ninth"[^>]*checked/);
    });

    test("a spec that depends on nothing has nothing ticked", () => {
      // The boxes themselves: the page's stylesheet has a `.checked`
      // rule in it, which a search of the whole document would find.
      const boxes = [...withOptions().matchAll(/<input[^>]*name="dependsOn"[^>]*>/g)].map((m) => m[0]);
      expect(boxes).toHaveLength(2);
      for (const box of boxes) expect(box).not.toContain("checked");
    });

    // A project with one spec in it — the one being edited — has
    // nothing to offer, and the server has already left it out. The
    // field is then absent rather than an empty box (the New-spec page
    // does the same).
    test("nothing to depend on, no field", () => {
      const html = edit(editView({ dependsOnOptions: [], dependsOnChecked: [] }));
      expect(html).not.toContain('name="dependsOn"');
      // The note about when a dependency takes effect goes with it:
      // there is nothing on the page for it to be about.
      expect(html).not.toContain("next gated step");
    });

    test("the note about when it takes effect stays beside the picker", () => {
      expect(withOptions()).toContain("next gated step");
    });
  });

  // --- spec 188: the checks that are still holding the spec back -----------
  //
  // Drawn in the SAME form as the textarea, so one Save posts both. The
  // server has already decided WHICH rows belong here (the current
  // phase's open ones); this page's job is that every one of them is a
  // real checkbox sharing one hidden phase, and that a spec with none
  // draws no section at all.

  describe("the checks", () => {
    const ROW = "| Manual check at 375px in a real browser | ⬜ | still outstanding |";
    const SECOND = "| Read the whole diff once | ⬜ | |";
    const withChecks = (rows = [{ line: ROW, task: "Manual check at 375px in a real browser" }]) =>
      edit(
        editView({
          checks: { phase: "Phase 4: REFACTOR - Test suite", baseSha: "b7c40e2deadbeef", rows },
        }),
      );

    test("one checkbox per row, inside the one form Save posts", () => {
      const html = withChecks();
      expect(html).toContain('name="tick"');
      expect(html).toContain('type="checkbox"');
      expect(html).toContain(`value="${ROW}"`);
      expect(html).toContain("Manual check at 375px in a real browser");
      // ONE posting form on the page: the boxes are Save's, not their
      // own. (The shell's own `<form method="dialog">` posts nothing.)
      expect(html.match(/<form method="post"/g)!).toHaveLength(1);
    });

    // ONE hidden phase for the whole set, not one per row: every row the
    // server offers here belongs to the same phase by construction,
    // which is what lets each box's own value be the row's verbatim line
    // (a table row contains `|` and cannot be packed into one field with
    // its phase).
    test("the phase is one hidden field shared by every box", () => {
      const html = withChecks([
        { line: ROW, task: "Manual check at 375px in a real browser" },
        { line: SECOND, task: "Read the whole diff once" },
      ]);
      expect(html.match(/name="checksPhase"/g)!).toHaveLength(1);
      expect(html).toContain('value="Phase 4: REFACTOR - Test suite"');
      expect(html.match(/name="tick"/g)!).toHaveLength(2);
    });

    // The same file-level guard the description carries, for the file
    // the ticks are written into.
    test("4-status.md's own commit travels with the form", () => {
      expect(withChecks()).toContain('name="statusBaseSha"');
      expect(withChecks()).toContain('value="b7c40e2deadbeef"');
    });

    test("nothing left to tick, no section", () => {
      const html = edit(editView({ checks: { phase: "Phase 4: REFACTOR - Test suite", rows: [] } }));
      expect(html).not.toContain('name="tick"');
      expect(html).not.toContain('name="checksPhase"');
    });

    test("a view with no checks at all draws none", () => {
      expect(edit()).not.toContain('name="tick"');
    });

    // A task cell is arbitrary text off disk, and so is the row it came
    // from — both go into the document, one as text and one as an
    // attribute value.
    test("the row and its task are escaped", () => {
      const html = withChecks([
        { line: '| <img src=x onerror="alert(1)"> | ⬜ | |', task: '<img src=x onerror="alert(1)">' },
      ]);
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img");
    });

    // A file git has never committed has no commit to carry, which is
    // not a mismatch — the same convention the description's own field
    // keeps.
    test("a status file with no commit yet draws the boxes all the same", () => {
      const html = edit(
        editView({ checks: { phase: "Phase 4: REFACTOR - Test suite", rows: [{ line: ROW, task: "Manual check" }] } }),
      );
      expect(html).toContain('name="tick"');
      expect(html).not.toContain("undefined");
    });
  });
});

// --- spec 182, narrowed by spec 188: the spec's remaining checks -----------
//
// A check only a person can make — look at the page at 375px and say
// whether it holds — was a row buried near the bottom of the fourth
// file. The rows come to the top of the page instead, above the tab
// bar, so they are on every tab.
//
// Since spec 188 the banner is a SUMMARY and nothing else: the box that
// wrote and committed on its own press is gone, and a check is ticked
// on the Edit form with the description, under one Save. Every row here
// — open or done, archived or active — is an inert span.

describe("the checks block (specs 182, 188)", () => {
  const check = (extra: Partial<SpecCheckView> = {}): SpecCheckView => ({
    phase: "Phase 4: REFACTOR - Test suite",
    line: "| Manual check at 375px in a real browser | ⬜ | still outstanding |",
    task: "Manual check at 375px in a real browser",
    done: false,
    ...extra,
  });

  const DONE = check({ task: "Run the full test suite", line: "| Run the full test suite | ✅ | |", done: true });

  const withChecks = (rows = [check(), DONE]) => view({ checks: { rows } });

  /** The banner alone. The page has real forms on it — Update, for one
   *  — so "no form" is a claim about this section and not about the
   *  document. */
  const banner = (html: string): string => {
    const found = html.match(/<section class="checks">[\s\S]*?<\/section>/);
    expect(found).not.toBeNull();
    return found![0];
  };

  test("an unticked row is on the page, and carries no control that writes", () => {
    const html = page(withChecks());
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(banner(html)).not.toContain("<form");
    expect(banner(html)).not.toContain("action=");
    expect(banner(html)).not.toContain("<button");
    expect(html).not.toContain("/status/tick");
  });

  // The banner, not the Overview panel: the description says the top of
  // the SPEC's page, and a reader on Activity is reading the same spec.
  test("it is above the tab bar, so every tab shows it", () => {
    for (const tab of ["overview", "activity", "steps"]) {
      const html = page(withChecks(), tab);
      expect([tab, html.includes("Manual check at 375px in a real browser")]).toEqual([tab, true]);
      expect([tab, html.indexOf("375px") < html.indexOf('class="tabbar"')]).toEqual([tab, true]);
    }
  });

  test("a done row is shown too, marked as done and with no control of its own", () => {
    const html = page(withChecks([DONE]));
    expect(html).toContain("Run the full test suite");
    expect(banner(html)).not.toContain("<form");
  });

  test("the unticked ones are told apart from the done ones in the markup", () => {
    const html = page(withChecks());
    expect(html).toContain("check open");
    expect(html).toContain("check done");
  });

  test("the phase a row belongs to travels with it", () => {
    expect(page(withChecks())).toContain("Phase 4");
  });

  // A spec whose 4-status.md has no Phase section at all — never
  // analysed, or a LOW-complexity spec on the simple layout.
  test("a spec with no rows renders no block at all", () => {
    const html = page(view({ checks: { rows: [] } }));
    expect(html).not.toContain('class="checklist"');
  });

  test("a spec whose view carries no checks renders no block at all", () => {
    expect(page(view())).not.toContain('class="checklist"');
  });

  test("an archived spec is a record — the rows are shown with no control", () => {
    const html = page(view({ archived: true, checks: { rows: [check()] } }));
    expect(banner(html)).not.toContain("<form");
    expect(banner(html)).not.toContain("<button");
  });
});
