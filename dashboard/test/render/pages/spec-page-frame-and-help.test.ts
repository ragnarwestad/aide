// The spec page as a page of this site: its frame, the steps panel it
// borrows from the job page, and the (?) each tab carries.
//
// Split out of spec-page-overview-and-tabs.test.ts 2026-09-04; the
// tests are unchanged and keep their names.

// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { renderJobDetailPage, renderSpecPage, type SpecCheckView } from "../../../src/render.ts";
import { GENERATED, NAV, NOW, lead, page, view } from "./spec-page-fixtures.ts";

// --- spec 212, criteria 1-3: one tab per document ---------------------------
//
// Four documents stacked on one tab is thousands of lines of
// preformatted text before the reader reaches whatever they came for.
// One tab each, and Checks (Overview until spec 294 renamed it and made
// Description the front page instead) carries no file text at all.

describe("the spec page is a page of this site like any other", () => {
  // Spec 437: the spec page is a subpage — it draws no site-level tab
  // bar, so ← Back is the only way off it.
  test("it is self-contained, and draws no site-level tab bar", () => {
    const html = page();
    expect(html).not.toContain("<script src");
    expect(html).toContain('<a class="brand" href="/">');
    expect(html).not.toContain('<nav class="tabbar">');
  });

  test("a tab name nobody offers falls back to the Description tab instead of a blank page", () => {
    const html = page(view(), "../secrets");
    // The description document's own text, not the spec's title: the
    // title used to stand in for "the page is not blank" and no longer
    // appears on the page at all. This says the same thing about the
    // tab the fallback actually lands on.
    expect(html).toContain("The dashboard never shows a spec.");
    expect(html).toMatch(/aria-current="page"[^>]*>Description/);
  });

  // Spec 437 removed the site-level tab bar this test used to strip
  // out before counting — nothing left to strip.
  test("the open tab is marked, and it is the only one on the page", () => {
    const html = page(view(), "steps");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Logs/);
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
    // The open one is marked the way the site's tabs mark theirs — the
    // Description tab, since it is the new default (spec 294).
    expect(html).toMatch(
      /<a class="tab" data-nav data-goto href="[^"]*\?tab=description" aria-current="page">Description<\/a>/,
    );
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

// --- spec 311: every tab says what it is for --------------------------------

describe("spec 311: every tab carries its own (?) explaining what it shows", () => {
  test("Description's (?) names the file and what Save does while the spec is active (REQ-3)", () => {
    const html = page(view(), "description");
    expect(html).toContain(
      "The problem as it was reported, kept in <code>1-description.md</code>. " +
        "While the spec is active and no job is running, Save here rewrites, commits and " +
        "pushes it; an archived spec, or one with a job in flight, shows the same file read-only.",
    );
  });

  // The claim is checked against the SAME render, not pinned as a fixed
  // fact — "no Save" has to stay true only while the render actually
  // shows none (REQ-6, Risk analysis: dependency spec 310 would change
  // this the moment the Analysis tab grows a Save of its own).
  test("Analysis' (?) names the file, /aide-analyze, and its Save claim matches the render (REQ-6)", () => {
    const html = page(view(), "analysis");
    expect(html).toContain(
      "What <code>/aide-analyze</code> found when it read the code for this problem, " +
        "kept in <code>2-analysis.md</code> and written by that step. " +
        "While the spec is active and no job is running, Save here rewrites, commits and " +
        "pushes it; an archived spec, or one with a job in flight, shows the same file read-only.",
    );
    // The claim and the render together, which is what REQ-6 asks: spec
    // 310 gave this tab a Save, so the text says so and the box is there.
    expect(html).toContain("<textarea");
  });

  test("Solution's (?) states the recommended-approach rule (REQ-4)", () => {
    const html = page(view(), "solution");
    expect(html).toContain(
      "Where it lists more than one Approach, only the one marked recommended gets built — " +
        "the rest are the record of what was weighed, not options still open.",
    );
  });

  test("Status' (?) names the file, /aide-implement, and points at the Checks tab (REQ-3)", () => {
    const html = page(view(), "status");
    expect(html).toContain(
      "Progress through the plan, kept in <code>4-status.md</code> and updated by " +
        "<code>/aide-implement</code> as it runs. While the spec is active and no job is " +
        "running, Save here rewrites, commits and pushes it; an archived spec, or one with a " +
        "job in flight, shows the same file read-only. The same file's Acceptance criteria " +
        "rows are what the Checks tab lets a person tick.",
    );
  });

  test("Checks' (?) states the Acceptance-only gate and names the Phase tables as the implement run's own record (REQ-5)", () => {
    const html = page(view(), "checks");
    expect(html).toContain(
      "only the <code>## Acceptance criteria</code> rows below can be " +
        "ticked, and only they hold the next archive run back",
    );
    expect(html).toContain("are <code>/aide-implement</code>'s own record of that run");
  });

  test("Logs' (?) says what the table lists and that nothing on it is editable (REQ-3)", () => {
    const html = page(view(), "steps");
    expect(html).toContain(
      "Every workflow step this spec's jobs have run — create, analyze, implement, " +
        "archive — each with its own cost and how it ended. Nothing here is editable",
    );
  });

  // Spec 360: the mark moved from a preceding sibling to inside the
  // panel's own first-line element — one assertion per tab shape,
  // covering both states of Checks and Logs (REQ-1, REQ-2, REQ-3, REQ-7).
  test("every tab's (?) sits inside its own first line, never as a preceding sibling", () => {
    const MARK = '<details class="intro">';
    // The page shell's own "About" panel carries an unrelated <h2>
    // (`About</h2>`, in the nav menu markup on every page) — the tab's
    // OWN panel is scoped to `.tabpanel`, not the whole page.
    const tabpanel = (html: string): string => html.match(/<div class="tabpanel">[\s\S]*/)?.[0] ?? "";

    // REQ-1: the document tabs' <h2>, both the writable branch (no job,
    // not archived) and the read-only one (archived).
    for (const tab of ["description", "analysis", "solution", "status"]) {
      for (const v of [view(), view({ archived: true })]) {
        const h2 = tabpanel(page(v, tab)).match(/<h2>[\s\S]*?<\/h2>/)?.[0] ?? "";
        expect([tab, v.archived, h2.includes(MARK)]).toEqual([tab, v.archived, true]);
      }
    }

    // REQ-2: Checks, both states.
    const emptyChecksP =
      tabpanel(page(view({ checks: { rows: [] } }), "checks")).match(
        /<p class="muted">No acceptance criteria to tick\.[\s\S]*?<\/p>/,
      )?.[0] ?? "";
    expect(emptyChecksP).toContain(MARK);

    const rows = [{ phase: "Acceptance criteria", line: "| x | ⬜ | |", task: "x", done: false }];
    const checksHeadP =
      tabpanel(page(view({ checks: { rows, phase: "Acceptance criteria", baseSha: "abc" } }), "checks")).match(
        /<p class="checkshead">[\s\S]*?<\/p>/,
      )?.[0] ?? "";
    expect(checksHeadP).toContain(MARK);

    // REQ-2: Logs, both states.
    const emptyLogsP =
      tabpanel(page(view(), "steps")).match(/<p class="muted">No step has finished yet\.[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(emptyLogsP).toContain(MARK);

    const step = {
      step: "analyze", ok: true, costUsd: 0, costMeasured: true,
      terminalReason: "completed", at: "2026-08-19T09:00:00Z",
    };
    const logsThead =
      tabpanel(page(view({ lead: lead(), steps: [step] }), "steps")).match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    // The mark sits inside the header row's last <th> — right after "At"
    // and before that cell's own closing tag, not before the row's start.
    expect(logsThead).toContain(`<th>At${MARK}`);
    expect(logsThead.indexOf(MARK)).toBeLessThan(logsThead.indexOf("</th></tr>"));

    // REQ-3, REQ-7: never `.tabpanel`'s own leading sibling.
    for (const tab of ["description", "analysis", "solution", "status", "checks", "steps"]) {
      const html = page(view(), tab);
      const panelStart = html.indexOf('<div class="tabpanel">') + '<div class="tabpanel">'.length;
      expect([tab, html.startsWith(MARK, panelStart)]).toEqual([tab, false]);
    }
  });
});

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

  test("no picker markup is drawn on any tab — the picker itself is gone", () => {
    const older = dummyResults(1, 1, 0);
    const newer = dummyResults(3, 2, 10);
    const v = view({ lead: lead({ id: "newer" }), steps: [...older, ...newer] });
    for (const tab of ["checks", "description", "analysis", "solution", "status", "steps"]) {
      expect([tab, page(v, tab).includes('data-filter="attempt"')]).toEqual([tab, false]);
    }
  });
});

// Spec 422, REQ-1/REQ-2: the document tabs' own Save form and the
// Checks tab's tick form went through nav-overlay.ts's .specform submit
// path with no data-overlay of their own — a bare spinner for the two
// or three seconds a Save takes to commit and push. Localized the same
// way the four confirmation pages already are.
describe("the Save form and the Checks tick form ask for the covering layer, localized (spec 422)", () => {
  const tickableCheck: SpecCheckView = {
    phase: "Acceptance criteria",
    line: "| A check | ⬜ | |",
    task: "A check",
    done: false,
  };

  test("the Description tab's Save form carries data-overlay=\"saving…\"", () => {
    const html = page(view(), "description");
    const form = html.match(/<form[^>]*class="[^"]*specform[^"]*"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('data-overlay="saving…"');
  });

  test("the Checks tab's tick form carries data-overlay=\"saving…\"", () => {
    const v = view({ checks: { rows: [tickableCheck], phase: "Acceptance criteria", baseSha: "abc" } });
    const html = page(v, "checks");
    const form = html.match(/<form class="specform"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('data-overlay="saving…"');
  });

  test("in Norwegian (nb), the Description tab's Save form carries the Norwegian text", () => {
    const html = page(view(), "description", "nb");
    const form = html.match(/<form[^>]*class="[^"]*specform[^"]*"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('data-overlay="lagrer…"');
  });

  test("in Norwegian (nb), the Checks tab's tick form carries the Norwegian text", () => {
    const v = view({ checks: { rows: [tickableCheck], phase: "Acceptance criteria", baseSha: "abc" } });
    const html = page(v, "checks", "nb");
    const form = html.match(/<form class="specform"[^>]*>/)?.[0] ?? "";
    expect(form).toContain('data-overlay="lagrer…"');
  });
});
