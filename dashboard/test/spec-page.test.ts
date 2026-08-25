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
//
// Spec 212: one TAB per file rather than all four stacked on Overview.
// Overview is the front page — where the spec stands, what it depends
// on, and the checks that are still holding it back as real boxes with
// a Save of their own — and the four documents are four tabs beside it.
// The reload that used to run on every tab is scoped to the two that
// move while a step runs, because a page that reloads on a timer wipes
// a half-typed textarea and a half-ticked list.

import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderResetSpecPage,
  renderSpecPage,
  type Phase,
  type SpecCheckView,
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
  saveAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save",
  tickAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/tick",
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

// --- spec 212, criteria 1-3: one tab per document ---------------------------
//
// Four documents stacked on one tab is thousands of lines of
// preformatted text before the reader reaches whatever they came for.
// One tab each, and Overview carries no file text at all.

describe("spec 212: Overview is the front page, not the four files", () => {
  test("no document's text is stacked on it any more", () => {
    const html = page();
    expect(html).not.toContain('class="specfile"');
    expect(html).not.toContain("The dashboard never shows a spec.");
    expect(html).not.toContain("Approach 1.");
  });

  // What Overview IS for: where the spec stands and what is still
  // holding it back. The state chip and the Update button sit in the
  // banner above the tabs, and are on the page whichever tab is open.
  test("the state chip, the Update button and the title are still there", () => {
    const html = page();
    expect(html).toContain("not started");
    expect(html).toContain("Update");
    expect(html).toContain("One page shows the whole spec");
  });

  test("every document is offered as a tab of its own", () => {
    const html = page();
    const base = "/specs/aide/150-one-page-shows-the-whole-spec";
    for (const tab of ["overview", "description", "analysis", "solution", "status", "steps"]) {
      expect([tab, html.includes(`href="${base}?tab=${tab}"`)]).toEqual([tab, true]);
    }
  });
});

describe("spec 212: each document tab shows its own file and no other", () => {
  const only = (tab: string, present: string, absent: string[]) => {
    const html = page(view(), tab);
    expect(html).toContain(present);
    for (const other of absent) expect([tab, other, html.includes(other)]).toEqual([tab, other, false]);
  };

  test("the analysis tab is the analysis alone", () => {
    only("analysis", "`discover.ts` has specTitle().", [
      "The dashboard never shows a spec.",
      "Approach 1.",
      "Phase 1: RED",
    ]);
  });

  test("the solution tab is the solution alone", () => {
    only("solution", "Approach 1.", [
      "The dashboard never shows a spec.",
      "`discover.ts` has specTitle().",
      "Phase 1: RED",
    ]);
  });

  test("the status tab is the status alone", () => {
    only("status", "Phase 1: RED", [
      "The dashboard never shows a spec.",
      "`discover.ts` has specTitle().",
      "Approach 1.",
    ]);
  });

  test("each carries the commit that last changed it, so the version is readable", () => {
    for (const tab of ["analysis", "solution", "status"]) {
      const html = page(view(), tab);
      expect([tab, html.includes("a3f9c21")]).toEqual([tab, true]);
      expect([tab, html.includes("2026-08-21T09:14:00+02:00")]).toEqual([tab, true]);
    }
  });

  // The three the analyze and implement steps write are read-only, for
  // the reason they are read-only today: a hand edit there is
  // overwritten the next time the step runs.
  test("the three the steps write carry no textarea and no Edit link", () => {
    for (const tab of ["analysis", "solution", "status"]) {
      const html = page(view(), tab);
      expect([tab, html.includes("<textarea")]).toEqual([tab, false]);
      expect([tab, html.includes("/edit")]).toEqual([tab, false]);
    }
  });

  test("a file git cannot date is still shown — the content is the point", () => {
    const html = page(
      view({
        files: [file("2-analysis.md", "prose", { sha: undefined, at: undefined })],
      }),
      "analysis",
    );
    expect(html).toContain("prose");
    expect(html).not.toContain("undefined");
  });

  // A spec halfway through the workflow has files that are not written
  // yet. Saying so is the answer; an empty box is not.
  test("a file that has not been written says so, rather than showing nothing", () => {
    const html = page(view({ files: [file("2-analysis.md", null)] }), "analysis");
    expect(html).toContain("2-analysis.md");
    expect(html).toContain("has not been written yet");
  });

  // A tab whose file the view does not carry at all — an archived spec
  // read out of a folder missing one — must not render "undefined".
  test("a tab whose file is not among the view's renders the missing note", () => {
    const html = page(view({ files: [file("1-description.md", "prose")] }), "solution");
    expect(html).toContain("3-solution.md");
    expect(html).not.toContain("undefined");
  });

  // Markdown is NOT rendered (the description put that out of scope) —
  // which makes escaping the whole question: a spec file is arbitrary
  // text off disk, and it is full of angle brackets.
  test("a file's text is escaped, never markup", () => {
    const html = page(view({ files: [file("2-analysis.md", "`<script>alert(1)</script>`")] }), "analysis");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)");
  });
});

// --- spec 212, criteria 4, 5: the reload is scoped to the two tabs that move -
//
// The page reloaded itself every ten seconds on every tab, which is
// precisely why editing lived on a page of its own. Overview and the
// four document tabs now carry forms, so they stop reloading; Activity
// and Steps keep it, because they are the two that move while a step
// runs and neither holds a form.

describe("spec 212: which tabs reload themselves", () => {
  for (const tab of ["overview", "description", "analysis", "solution", "status"]) {
    test(`${tab} does not refresh itself under the reader`, () => {
      expect([tab, page(view(), tab).includes('http-equiv="refresh"')]).toEqual([tab, false]);
    });
  }

  for (const tab of ["steps"]) {
    test(`${tab} still reloads every ten seconds`, () => {
      expect(page(view(), tab)).toContain('<meta http-equiv="refresh" content="10">');
    });
  }

  // A tab name nobody offers falls back to Overview, and the fallback
  // decides the reload too — not the raw string off the query.
  test("a tab name nobody offers falls back to Overview, reload and all", () => {
    expect(page(view(), "../secrets")).not.toContain('http-equiv="refresh"');
  });
});

// --- criterion 2: a spec that has never run ---------------------------------

describe("a spec with no job at all", () => {
  test("renders, and says it has not started rather than pretending a state", () => {
    const html = page();
    expect(html).toContain("not started");
    expect(page(view(), "description")).toContain("The dashboard never shows a spec.");
  });

  test("its Steps tab says what an empty job's tab says", () => {
    expect(page(view(), "steps")).toContain("No step has finished yet");
  });

  test("its tabs are offered all the same — an empty tab is still a tab", () => {
    const html = page();
    const base = "/specs/aide/150-one-page-shows-the-whole-spec";
    for (const tab of ["overview", "description", "steps"]) {
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

  test("the Steps tab's running row is the lead job's, word for word", () => {
    const html = page(withLead({ runningStep: { step: "analyze", logs: ["Bash ls"] } }), "steps");
    expect(html).toContain("Bash ls");
  });

  test("the Steps tab is the lead job's, word for word", () => {
    const results = [
      {
        step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
        terminalReason: "completed", at: "2026-08-21T09:01:00Z",
      },
    ];
    const html = page(view({ lead: lead({ results }), steps: results }), "steps");
    expect(html).toContain("$0.42");
  });

  test("the tab counts come from the lead job when nothing is selected, so a reader knows before clicking", () => {
    const html = page(withLead({ runningStep: { step: "analyze", logs: ["Bash ls"] } }));
    expect(html).toMatch(/>Logs \(1\)</);
  });

  // The page is about the SPEC, so it opens on the spec — even while a
  // step is running. The job page keeps its own rule (a running job
  // opens on the steps tab), because that page is about the run.
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
    expect(html).toContain("One page shows the whole spec");
    expect(html).toMatch(/aria-current="page"[^>]*>Overview/);
  });

  test("the open tab is marked, and it is the only one on the page proper", () => {
    const html = page(view(), "steps");
    const body = html.replace(/<nav[^>]*>[\s\S]*?<\/nav>/, "");
    expect(body.match(/aria-current="page"/g)).toHaveLength(1);
    expect(body).toMatch(/aria-current="page"[^>]*>Logs/);
  });

  // Real tabs, not chips with a caption beside them (2026-08-23): the
  // same bar the site's own two tabs are, one level in. The caption
  // said "Spec" above a page that says nothing else, and a chip is for
  // choosing among values while these move between views.
  test("the tabs are a tab bar, with no caption beside them", () => {
    const html = page();
    expect(html).toContain('<nav class="tabbar subtabs">');
    expect(html).not.toContain('<span class="lbl">Spec</span>');
    expect(html).not.toContain('<span class="lbl">Job</span>');
    expect(html).not.toContain('data-filter="tab"');
    // The open one is marked the way the site's tabs mark theirs.
    expect(html).toMatch(/<a class="tab" data-nav href="[^"]*\?tab=overview" aria-current="page">Overview<\/a>/);
  });

  test("no Live right now panel exists here either", () => {
    expect(page(view({ lead: lead({ state: "running" }) }))).not.toContain("Live right now");
  });
});

// The two pages share the tab bar and the steps table rather than each
// carrying a copy — `development.md` names the two-copies-of-one-shape
// problem three times over (`WORKFLOW_STEPS`, `DEPENDENCY_GATED_STEPS`,
// project readiness) as this repo's own recurring cost, and a second
// tab bar would have been the fourth.
//
// Since spec 240 `stepResults()` takes each caller's own `tabHref` (a
// job's own id on the job page, the project/folder pair on the spec
// page) so a step's expand link points back to the right page — so the
// two panels are no longer byte-identical, the same way the tab bar's
// own `basePath` never was. What stays shared is the FUNCTION and the
// facts it renders from the same job data.
describe("the steps panel renders through the job page's own function", () => {
  const job = lead({
    runningStep: { step: "analyze", logs: ["Bash ls"] },
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

  test("the same job's steps render the same facts on both pages", () => {
    const onSpec = panelOf(
      renderSpecPage(view({ lead: job, steps: job.results }), GENERATED, NAV, { tab: "steps", now: NOW }),
    );
    const onJob = panelOf(renderJobDetailPage(job, GENERATED, NAV, { tab: "steps", now: NOW }));
    expect(onSpec).not.toBe("NO PANEL");
    for (const fact of ["Bash ls", "$0.42", "analyze"]) {
      expect(onSpec).toContain(fact);
      expect(onJob).toContain(fact);
    }
  });

  test("and so is the empty state, for a spec no job has ever run", () => {
    const empty = view();
    expect(panelOf(renderSpecPage(empty, GENERATED, NAV, { tab: "steps", now: NOW }))).toContain(
      "No step has finished yet",
    );
    expect(panelOf(renderJobDetailPage(lead(), GENERATED, NAV, { tab: "steps", now: NOW }))).toContain(
      "No step has finished yet",
    );
  });
});

// --- spec 242: every attempt's steps in one flat list, no picker ------------
//
// The picker showed one attempt's steps at a time and hid the others
// behind pills a reader had to compare by eye. Direction: remove it.
// Every step from every attempt in this spec's current work round is
// shown together, oldest first, each row tagged with the attempt it
// belongs to — only when there is more than one, exactly as the picker
// itself drew nothing for a single-attempt spec.

describe("spec 242: every attempt's steps in one flat list", () => {
  /** `n` dummy finished steps, each carrying `attempt` when the caller
   *  passes one — the server always tags a multi-attempt spec's rows,
   *  never a single-attempt one's. `startIndex` keeps two calls' `at`
   *  values apart; the render layer never sorts by it, only the array
   *  order (already the caller's) decides what shows first. */
  const dummyResults = (n: number, attempt?: number, startIndex = 0) =>
    Array.from({ length: n }, (_, i) => ({
      step: "analyze", ok: true, costUsd: 0, costMeasured: true,
      terminalReason: "completed", at: `2026-08-19T09:${String(startIndex + i).padStart(2, "0")}:00Z`,
      ...(attempt === undefined ? {} : { attempt }),
    }));

  test("a spec with one job draws no Attempt marker and no picker markup (AC1)", () => {
    const v = view({ lead: lead(), steps: dummyResults(1) });
    const html = page(v, "steps");
    expect(html).not.toContain("Attempt ");
    expect(html).not.toContain('data-filter="attempt"');
  });

  test("two attempts' steps appear together, tagged, in chronological order (AC2)", () => {
    const older = dummyResults(1, 1, 0);
    const newer = dummyResults(3, 2, 10);
    const v = view({ lead: lead({ id: "newer" }), steps: [...older, ...newer] });
    const html = page(v, "steps");
    expect((html.match(/>Attempt 1</g) ?? []).length).toBe(1);
    expect((html.match(/>Attempt 2</g) ?? []).length).toBe(3);
    // Chronological: the older job's row (Attempt 1) comes before the
    // newer job's three rows (Attempt 2).
    expect(html.indexOf(">Attempt 1<")).toBeLessThan(html.indexOf(">Attempt 2<"));
  });

  test("the tab bar reads the true total across both attempts (AC3 — problem 1)", () => {
    const older = dummyResults(1, 1, 0);
    const newer = dummyResults(3, 2, 10);
    const v = view({ lead: lead({ id: "newer" }), steps: [...older, ...newer] });
    const html = page(v, "steps");
    expect(html).toMatch(/>Logs \(4\)</);
    expect(html).not.toMatch(/>Logs \(1\)</);
    expect(html).not.toMatch(/>Logs \(3\)</);
  });

  test("the live row is tagged with the newest attempt's number, and counted (AC4)", () => {
    const older = dummyResults(1, 1);
    const v = view({
      lead: lead({
        id: "newer", state: "running",
        runningStep: { step: "implement", logs: [], attempt: 2 },
      }),
      steps: older,
    });
    const html = page(v, "steps");
    expect(html).toContain(">Attempt 2<");
    expect(html.indexOf(">Attempt 2<")).toBeLessThan(html.indexOf(" implement</td>"));
    expect(html).toMatch(/>Logs \(2\)</);
  });

  // The chip says what the SPEC is doing right now. An older, failed
  // attempt's rows sitting on the same Steps tab must not change that —
  // a chip that read the oldest row present would say the spec had
  // failed while a step of it was running.
  test("the banner reflects the lead job's state, not an older attempt's (AC5)", () => {
    const older = dummyResults(1, 1);
    const v = view({ lead: lead({ id: "newer", state: "running" }), steps: older });
    const html = page(v, "steps");
    const banner = html.slice(html.lastIndexOf('<div class="pagehead">'), html.indexOf('<nav class="tabbar subtabs"'));
    expect(banner).toContain("running");
    expect(banner).not.toContain("failed");
  });

  test("no picker markup is drawn on any tab — the picker itself is gone", () => {
    const older = dummyResults(1, 1, 0);
    const newer = dummyResults(3, 2, 10);
    const v = view({ lead: lead({ id: "newer" }), steps: [...older, ...newer] });
    for (const tab of ["overview", "description", "analysis", "solution", "status", "steps"]) {
      expect([tab, page(v, tab).includes('data-filter="attempt"')]).toEqual([tab, false]);
    }
  });
});

// --- spec 162, moved onto the page by spec 212: the Description tab ---------
//
// One of the four files is a person's to write. `2-analysis.md` and
// `3-solution.md` are the analyze step's output and a hand edit there
// is overwritten the next time it runs; `4-status.md` has been the
// runner's since spec 154. So the textarea is on `1-description.md`
// and on nothing else.
//
// It used to be a page of its own, reached by an Edit link, for one
// reason: the spec page refreshed itself every ten seconds and a
// textarea under a timer is one poll away from losing what was typed.
// The Description tab does not reload, so the form lives here now and
// the second page is gone.

describe("spec 212: the Edit link that led to a second page is gone", () => {
  test("no tab offers one, and the page it led to is not linked anywhere", () => {
    for (const tab of ["overview", "description", "analysis", "solution", "status"]) {
      expect([tab, page(view(), tab).includes("/edit")]).toEqual([tab, false]);
    }
  });

  // The job page draws its phase's file through the same function.
  test("never appears on a job page's phase file either", () => {
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

describe("the Description tab", () => {
  const edit = (v: SpecPageView = view()) => page(v, "description");

  test("holds the file's current text in a real textarea, in a real form", () => {
    const html = edit();
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save"');
    expect(html).toContain("<textarea");
    expect(html).toContain("The dashboard never shows a spec.");
  });

  test("wide description lines stay on one line and scroll inside the field", () => {
    const html = edit();
    expect(html).toContain('<textarea name="text" rows="30" spellcheck="false" wrap="off">');
    expect(html).toContain('.newspecform textarea { overflow-x: auto; }');
  });

  test("the Save row has one spacing token above it", () => {
    expect(edit()).toContain('.specform .factions { margin-top: var(--sp-1); }');
  });

  // The description says "each with the commit stamp it has today" —
  // the tab that can be edited included.
  test("carries the file's commit stamp, exactly as the read-only tabs do", () => {
    expect(edit()).toContain("a3f9c21");
  });

  // The whole point of the hidden field: the page is rendered once and
  // a reader may sit on it while an analyze step lands a new version.
  test("carries the commit the text was read at, so a save can be refused", () => {
    expect(edit(view({ descriptionBaseSha: "a3f9c21deadbeef" }))).toContain('value="a3f9c21deadbeef"');
  });

  // A spec whose description git has never seen still opens: the field
  // is empty rather than the word "undefined".
  test("a file with no commit yet opens all the same", () => {
    const html = edit(view({ descriptionBaseSha: undefined }));
    expect(html).toContain("<textarea");
    expect(html).not.toContain("undefined");
  });

  // Saving here commits and pushes, which takes two or three seconds,
  // and this page carries no script of its own — so the shell's own
  // must be what marks the button busy. Without it the Save looks
  // untouched for those seconds and reads as a press that did not
  // register (asked for 2026-08-23).
  test("the shell's busy script comes with the page, so Save looks pressed", () => {
    const html = edit();
    expect(html).toContain('data-pending="saving…"');
    // The transpiled listener itself, not just its effect: this page
    // is served with no `script` of its own, so the head tag is the
    // only place it can come from.
    expect(html).toContain('addEventListener("submit"');
    expect(html).toContain("dataset.busy");
    expect(html).not.toContain("<script src");
  });

  test("the text is escaped — a description is arbitrary text off disk", () => {
    const html = edit(view({ files: [file("1-description.md", "</textarea><script>alert(1)</script>")] }));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;/textarea&gt;");
  });

  // A ten-second meta refresh on a page with a textarea on it wipes
  // whatever the reader was half-way through typing. This is why the
  // form could not live here before spec 212.
  test("does not refresh itself under the reader", () => {
    expect(edit()).not.toContain('http-equiv="refresh"');
  });

  test("a refused save has somewhere to show its reason", () => {
    const html = edit(view({ error: "1-description.md has changed since you opened it" }));
    expect(html).toContain("1-description.md has changed since you opened it");
  });

  test("carries the token for a browser that got the page with one", () => {
    expect(edit(view({ token: "s3cret" }))).toContain('name="token" value="s3cret"');
  });

  // Spec 163: an archived spec is a RECORD. Editing was built for a
  // description that is edited WHILE the work is live (spec 162), and
  // Save on an archived spec would have written, committed and pushed
  // into `archive/`.
  test("an archived spec's description is read-only, with the note that says why", () => {
    const html = edit(view({ archived: true }));
    expect(html).not.toContain("<textarea");
    expect(html).toContain("The dashboard never shows a spec.");
    expect(html).toContain("archived");
  });

  // --- spec 174, moved with the form: the New-spec page's own picker -------
  //
  // The dependency line is stored in `1-description.md`'s own text, so
  // the control that changes it stays with that file's own Save — one
  // commit for the description and the line together, exactly as
  // before. Overview shows the same thing read-only.
  describe("the Depends on picker", () => {
    const OPTIONS = [
      { project: "aide", specFolder: "164-a-spec-can-depend" },
      { project: "aide", specFolder: "09-ninth" },
    ];
    const withOptions = (checked: string[] = []) =>
      edit(view({ dependsOnOptions: OPTIONS, dependsOn: checked }));

    test("one checkbox per spec offered, not a text box to type into", () => {
      const html = withOptions();
      expect(html).toContain('name="dependsOn"');
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
      const html = edit(view({ dependsOnOptions: [], dependsOn: [] }));
      expect(html).not.toContain('name="dependsOn"');
      // The note about when a dependency takes effect goes with it:
      // there is nothing on the page for it to be about.
      expect(html).not.toContain("next gated step");
    });

    test("the note about when it takes effect stays beside the picker", () => {
      expect(withOptions()).toContain("next gated step");
    });

    // An archived spec has no form to put the picker in.
    test("an archived spec is offered no picker", () => {
      expect(edit(view({ archived: true, dependsOnOptions: OPTIONS }))).not.toContain('name="dependsOn"');
    });
  });
});

// --- spec 212: what the spec depends on, read-only, on the front page -------

describe("spec 212: the Depends on line on Overview", () => {
  test("names what the spec depends on, and posts nothing", () => {
    const html = page(view({ dependsOn: ["164-a-spec-can-depend", "09-ninth"] }));
    expect(html).toContain("<strong>Depends on</strong>");
    expect(html).toContain("164-a-spec-can-depend");
    expect(html).toContain("09-ninth");
    // The read-only line, not the picker: the control that changes it
    // is on the Description tab, with the file the line is stored in.
    expect(html).not.toContain('name="dependsOn"');
  });

  // The same convention `dependsOnField` keeps for a project with
  // nothing to offer: nothing to say, no line.
  // The words themselves are in the page's own stylesheet, in a
  // comment about the New-spec form's layout — so the claim is about
  // the LINE, not about the document.
  test("a spec that depends on nothing draws no line at all", () => {
    expect(page(view({ dependsOn: [] }))).not.toContain("<strong>Depends on</strong>");
    expect(page(view())).not.toContain("<strong>Depends on</strong>");
  });

  // An archived spec is a record — the line is a fact about it, and a
  // fact is not a control.
  test("an archived spec still shows it, read-only", () => {
    const html = page(view({ archived: true, dependsOn: ["164-a-spec-can-depend"] }));
    expect(html).toContain("164-a-spec-can-depend");
    expect(html).not.toContain('name="dependsOn"');
  });

  // A folder name is arbitrary text off disk.
  test("the folder names are escaped", () => {
    const html = page(view({ dependsOn: ['<img src=x onerror="alert(1)">'] }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

// --- spec 239: the spec's own run history, on Overview -----------------------
//
// The front page's row already draws create → analyze → implement →
// archive for every spec; this tab had nothing of the kind — a reader
// who wanted the whole-spec history left this page for the front one.
// `phasePips` is the same function the front page's row calls, fed the
// same `Phase[]` this spec's own jobs and target already produce
// server-side, never a second count.

describe("spec 239: the phase chain on Overview", () => {
  const STEPS = ["create", "analyze", "implement", "archive"];
  const phase = (step: string, extra: Partial<Phase> = {}): Phase => ({
    step,
    attempts: [],
    history: {},
    ...extra,
  });
  const pipKind = (html: string, step: string): string =>
    html.match(new RegExp(`<span class="pip ([a-z]+)"[^>]* title="${step}">`))?.[1] ?? "";

  test("a spec that has run create, analyze and implement but not archive shows all four phases (criterion 4)", () => {
    const html = page(
      view({
        phases: STEPS.map((step) => phase(step)),
        done: ["create", "analyze", "implement"],
      }),
    );
    expect(html).toContain('class="pips"');
    expect(pipKind(html, "create")).toBe("past");
    expect(pipKind(html, "analyze")).toBe("past");
    expect(pipKind(html, "implement")).toBe("past");
    expect(pipKind(html, "archive")).toBe("todo");
  });

  // Spec 241: `pips()` is caption-free by design (it is shared with the
  // front page's row, which already has the spec's name beside it) —
  // hoisted alone onto Overview it needs a label of its own, the same
  // `checkshead` convention `checklist()` already uses for "Checks".
  test("the pips carry a 'Progress' caption, the front page row's own name for this call (criterion 1)", () => {
    const html = page(view({ phases: STEPS.map((step) => phase(step)), done: ["create"] }));
    expect(html).toContain('<p class="checkshead"><strong>Progress</strong></p>');
  });

  test("a spec with no job ever run still shows the phase chain rather than being omitted (criterion 5)", () => {
    const html = page(view({ phases: STEPS.map((step) => phase(step)), done: [] }));
    expect(html).toContain('class="pips"');
    for (const step of STEPS) expect([step, pipKind(html, step)]).not.toEqual([step, ""]);
  });

  test("an archive held back with a reason reaches the tab the same way the front page's row shows it (criterion 6)", () => {
    const phases = [
      ...STEPS.slice(0, 3).map((step) => phase(step)),
      phase("archive", { heldBack: { reason: "the Slack webhook" } }),
    ];
    const html = page(view({ phases, done: ["create", "analyze", "implement"] }));
    // The pips strip cannot itself tell held-back from not-yet-run apart
    // — the front page's own row does not either (render.test.ts's
    // `pipFor` asserts "todo" for both cases, spec 108). What this pins
    // is that the held-back `Phase` reaches this tab and renders through
    // the identical composer without throwing.
    expect(pipKind(html, "archive")).toBe("todo");
  });

  test("nothing is drawn for a view carrying no phase data at all — no pips and no caption (criterion 2)", () => {
    const html = page(view());
    expect(html).not.toContain('class="pips"');
    expect(html).not.toContain('<strong>Progress</strong>');
  });
});

// --- spec 182, ticked again by spec 212: the spec's remaining checks --------
//
// A check only a person can make — look at the page at 375px and say
// whether it holds — was a row buried near the bottom of the fourth
// file. The rows came to the top of the page instead.
//
// Spec 188 made every row inert and moved the tick onto the Edit form,
// because a second way of changing a spec was one too many to learn.
// Spec 212 gives the boxes back, on the Overview PANEL rather than in
// the banner: the description's own editor is now a tab beside it
// rather than a page behind a link, so a reader still has one place to
// tick — and a form in the banner would ride onto Activity and Steps,
// which reload every ten seconds and would wipe a half-ticked list.

describe("the checks block (specs 182, 188, 212)", () => {
  const PHASE = "Phase 4: REFACTOR - Test suite";
  const check = (extra: Partial<SpecCheckView> = {}): SpecCheckView => ({
    phase: PHASE,
    line: "| Manual check at 375px in a real browser | ⬜ | still outstanding |",
    task: "Manual check at 375px in a real browser",
    done: false,
    ...extra,
  });

  const DONE = check({ task: "Run the full test suite", line: "| Run the full test suite | ✅ | |", done: true });
  const LATER = check({
    phase: "Phase 5: SHIP",
    task: "Watch the first real run",
    line: "| Watch the first real run | ⬜ | |",
  });

  const withChecks = (rows = [check(), DONE], extra: Partial<SpecPageView> = {}) =>
    view({ checks: { rows, phase: PHASE, baseSha: "b7c40e2deadbeef" }, ...extra });

  /** The checks section alone. The page has real forms on it — Update,
   *  for one — so a claim about "the form" is a claim about this
   *  section and not about the document. */
  const section = (html: string): string => {
    const found = html.match(/<section class="checks">[\s\S]*?<\/section>/);
    expect(found).not.toBeNull();
    return found![0];
  };

  test("an open row in the current phase is a real checkbox, in a form with its own Save", () => {
    const html = page(withChecks());
    const checks = section(html);
    expect(checks).toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/tick"');
    expect(checks).toMatch(/<form[^>]*method="post"/);
    expect(checks).toContain('type="checkbox"');
    expect(checks).toContain('name="tick"');
    expect(checks).toContain('value="| Manual check at 375px in a real browser | ⬜ | still outstanding |"');
    expect(checks).toContain("Save");
  });

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} job leaves every check visible but removes the controls`, () => {
      const checks = section(page(withChecks([check(), DONE, LATER], { lead: lead({ state }) })));
      expect(checks).toContain("Manual check at 375px in a real browser");
      expect(checks).toContain("Run the full test suite");
      expect(checks).toContain("Watch the first real run");
      expect(checks).not.toContain('name="tick"');
      expect(checks).not.toContain("<form");
      expect(checks).not.toContain("<button");
    });
  }

  test("a completed job does not make the checks read-only", () => {
    expect(section(page(withChecks([check()], { lead: lead({ state: "done" }) })))).toContain('name="tick"');
  });

  // The Save that commits the description and the Save that commits a
  // tick are two forms posting to two actions — that is what turns one
  // commit carrying both into two commits, each carrying its own file.
  test("its Save is its own, not the description's", () => {
    const checks = section(page(withChecks()));
    expect(checks).not.toContain("/save");
    expect(checks).not.toContain("<textarea");
  });

  // ONE hidden phase for the whole set, not one per row: every box the
  // page offers belongs to the same phase by construction, which is
  // what lets each box's own value be the row's verbatim line (a table
  // row contains `|` and cannot be packed into one field with its
  // phase). `baseSha` is the file's own commit at read time.
  test("the phase and 4-status.md's own commit travel with the form", () => {
    const html = page(withChecks());
    expect(html.match(/name="checksPhase"/g)!).toHaveLength(1);
    expect(html).toContain(`value="${PHASE}"`);
    expect(html).toContain('name="statusBaseSha"');
    expect(html).toContain('value="b7c40e2deadbeef"');
  });

  test("carries the token for a browser that got the page with one", () => {
    expect(section(page(withChecks([check()], { token: "s3cret" })))).toContain('name="token" value="s3cret"');
  });

  // "A check already made" — a done row is still SHOWN, because a list
  // that only ever shrinks says nothing about how far the spec got —
  // but it is not a box to press.
  test("a done row is shown, marked done, and is not a box", () => {
    const html = page(withChecks([DONE]));
    expect(html).toContain("Run the full test suite");
    expect(section(html)).not.toContain('name="tick"');
    expect(html).toContain("check done");
  });

  // "A check nothing is waiting on" — a phase the workflow has not
  // reached is sitting at its template default.
  test("an open row in a later phase is shown but is not a box", () => {
    const html = page(withChecks([check(), LATER]));
    expect(html).toContain("Watch the first real run");
    expect(html.match(/name="tick"/g)!).toHaveLength(1);
  });

  // Every box on the page is inside the ONE form that posts them: a box
  // outside it posts nothing at all when Save is pressed.
  test("no box sits outside the form that Save posts", () => {
    const html = page(withChecks());
    const checks = section(html);
    expect(checks.indexOf('name="tick"')).toBeGreaterThan(checks.indexOf("<form"));
  });

  // Spec 212: the Overview PANEL, not the banner. A form that rode the
  // banner onto Steps would be wiped by that tab's ten-second reload
  // halfway through being ticked.
  test("it is on Overview, and on no tab that reloads itself", () => {
    expect(page(withChecks())).toContain("Manual check at 375px in a real browser");
    const html = page(withChecks(), "steps");
    expect(html.includes("Manual check at 375px in a real browser")).toBe(false);
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
  // Spec 241: an empty checklist used to render nothing at all — combined
  // with a phase-chain that has no caption either, a not-yet-analysed
  // spec's Overview tab showed literally nothing. "no checks yet" is the
  // third value the existing summary span already carries ("all done" /
  // "N still open"), not a new kind of message.
  test("a spec with no rows says 'no checks yet' rather than rendering no block at all (criterion 3)", () => {
    const html = page(view({ checks: { rows: [] } }));
    expect(html).not.toContain('class="checklist"');
    expect(html).toContain('<p class="checkshead"><strong>Checks</strong> <span class="small muted">no checks yet</span></p>');
  });

  test("a spec whose view carries no checks says 'no checks yet' rather than rendering no block at all (criterion 3)", () => {
    const html = page(view());
    expect(html).not.toContain('class="checklist"');
    expect(html).toContain('<p class="checkshead"><strong>Checks</strong> <span class="small muted">no checks yet</span></p>');
  });

  // Nothing left to tick — every row done, or the current phase not
  // named at all — leaves the rows on the page and the form off it.
  test("nothing tickable, no form", () => {
    const html = page(view({ checks: { rows: [DONE], phase: PHASE, baseSha: "b7c40e2" } }));
    expect(html).toContain("Run the full test suite");
    expect(section(html)).not.toContain("<form");
    expect(page(view({ checks: { rows: [check()] } }))).not.toContain('name="tick"');
  });

  // Spec 163: an archived spec is a RECORD. A tick would write, commit
  // and push into `archive/`.
  test("an archived spec is a record — the rows are shown with no control", () => {
    const html = page(withChecks([check()], { archived: true }));
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(section(html)).not.toContain("<form");
    expect(section(html)).not.toContain("<button");
    expect(section(html)).not.toContain('name="tick"');
  });

  // A task cell is arbitrary text off disk, and so is the row it came
  // from — both go into the document, one as text and one as an
  // attribute value.
  test("the row and its task are escaped", () => {
    const html = page(
      withChecks([
        check({ line: '| <img src=x onerror="alert(1)"> | ⬜ | |', task: '<img src=x onerror="alert(1)">' }),
      ]),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  // A `4-status.md` git has never committed has no commit to carry,
  // which is not a mismatch — the same convention the description's own
  // field keeps.
  test("a status file with no commit yet draws the boxes all the same", () => {
    const html = page(view({ checks: { rows: [check()], phase: PHASE } }));
    expect(html).toContain('name="tick"');
    expect(html).not.toContain("undefined");
  });
});

// --- spec 198: reopening a spec is one action -------------------------------
//
// An archived spec whose work has to be done again was reopened by hand
// in a terminal — move the folder, overwrite three files, hunt down the
// branch in two repositories and two places each. Done twice, missed
// something both times. The control belongs where the spec is.
//
// Everything ELSE about an archived spec stays as spec 163 left it: no
// textarea on the Description tab, the same read-only note, and checks
// that are shown but cannot be ticked.
describe("spec 198: the Reopen control", () => {
  const archived = (extra: Partial<SpecPageView> = {}) =>
    page(view({ archived: true, token: "t0ken", ...extra }));

  test("an archived spec offers exactly one action, and it is Reopen", () => {
    const html = archived();
    expect(html).toContain("Reopen");
    expect(html).toContain('action="/api/queue"');
    expect(html).toContain('name="steps" value="reopen"');
  });

  test("it names the spec the server has to resolve, and carries the token", () => {
    const html = archived();
    expect(html).toContain('name="project" value="aide"');
    expect(html).toContain('name="specFolder" value="150-one-page-shows-the-whole-spec"');
    expect(html).toContain('name="token" value="t0ken"');
  });

  // A GET would let a reload re-run it, exactly as the Update button's
  // own comment says of the pull.
  test("it posts", () => {
    expect(archived()).toMatch(/<form[^>]*action="\/api\/queue"[^>]*method="post"|<form[^>]*method="post"[^>]*action="\/api\/queue"/);
  });

  // Reopen sat under the archived note while Update sat up on the head
  // line, so the page's two buttons were in two places (2026-08-23,
  // "Reopen og Update kan vel gjerne stå sammen?"). One group now, at
  // the end of the head line, where `.pagehead` puts what is not the
  // state chip.
  test("Reopen and Update share one group at the end of the head line", () => {
    const group = /<div class="pagehead">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/div>/.exec(archived())?.[1] ?? "";
    expect(group).toContain("Reopen");
    expect(group).toContain("Update");
    // Reopen FIRST: Update is on every spec page, and a button that
    // slid sideways whenever a spec was archived would be moving
    // because something else appeared.
    expect(group.indexOf("Reopen")).toBeLessThan(group.indexOf("Update"));
    // Moved, not copied: one Reopen on the page, and it is this one.
    expect(archived().match(/name="steps" value="reopen"/g)).toHaveLength(1);
  });

  // "This spec is archived — a record, and read-only." was a notice
  // under the title until 2026-08-23. Two things were wrong with it:
  // the page uses that shape for something that just happened, not for
  // something that is the case, and "read-only" is a truth with
  // modifications — Reopen is on the head line, and archive can be run
  // again while the branch is open.
  test("being archived is a labelled fact on Overview, and does not claim read-only", () => {
    const html = archived();
    expect(html).toContain("<strong>Archived</strong>");
    // The About dialog in the shell calls the dashboard itself
    // read-only, so it is the old SENTENCE that must be gone.
    expect(html).not.toContain("a record, and read-only");
    expect(html).not.toContain("This spec is archived");
    // It says what is actually the case instead.
    expect(html).toContain("cannot be edited until the spec is reopened");
    // Not the notice shape: that one is for what just happened.
    expect(html).not.toMatch(/class="rowmsg info"[^>]*>[\s\S]{0,80}archived/);
  });

  test("a live spec says nothing about being archived", () => {
    expect(page(view({ token: "t0ken" }))).not.toContain("<strong>Archived</strong>");
  });

  // A live spec has the whole row on the queue list for this; the
  // archived page is the one place a reopen can be asked for.
  test("a live spec's page offers nothing of the sort", () => {
    expect(page(view({ token: "t0ken" }))).not.toContain("Reopen");
  });

  test("the archived note is unchanged, and nothing on the page edits", () => {
    const html = archived();
    expect(html).not.toContain("/edit");
    expect(html).toContain("archived");
    expect(page(view({ archived: true }), "description")).not.toContain("<textarea");
  });
});

describe("spec 231: the Reset control", () => {
  test("an active spec offers Reset immediately before Update", () => {
    const html = page(view({ resetAction: "/reset-confirm" }));
    const group = /<div class="pagehead">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/div>/.exec(html)?.[1] ?? "";
    expect(group).toContain('href="/reset-confirm"');
    expect(group.indexOf("Reset")).toBeLessThan(group.indexOf("Update"));
  });

  test("Reset is absent for an archived spec and unavailable while busy", () => {
    expect(page(view({ archived: true, resetAction: "/reset-confirm" }))).not.toContain("/reset-confirm");
    const html = page(view({ resetAction: "/reset-confirm", resetUnavailableReason: "a job is running" }));
    expect(html).toContain("Reset");
    expect(html).toContain("a job is running");
    expect(html).not.toContain('href="/reset-confirm"');
  });

  test("the confirmation explains every effect and requires the exact folder", () => {
    const html = renderResetSpecPage("aide", view().specFolder, NAV, GENERATED, { token: "t0ken" });
    for (const text of [
      "0-README.md", "1-description.md", "analysis", "plan", "status",
      "local and remote", "earlier jobs and commits", "Project code", "default-branch history",
    ]) expect(html).toContain(text);
    expect(html).toContain(`data-confirm="${view().specFolder}"`);
    expect(html).toContain('name="confirm"');
    expect(html).toContain('name="token" value="t0ken"');
  });
});
