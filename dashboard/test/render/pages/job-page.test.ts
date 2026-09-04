import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  type JobDetailView,
} from "../../../src/render.ts";
import {
  external,
  NAV,
  detail,
} from "./fixtures.ts";


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
        steps: ["analyze", "implement", "archive"],
        stepIndex: 2,
        results: [
          {
            step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
            terminalReason: "completed", at: "2026-08-16T10:01:00Z",
          },
          {
            step: "implement", ok: true, costUsd: 1.07, costMeasured: true,
            terminalReason: "completed", at: "2026-08-16T10:03:00Z",
          },
        ],
      }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "steps" },
    );
    expect(html).toContain("analyze");
    expect(html).toContain("implement");
    expect(html).toContain("$0.42");
    expect(html).toContain("$1.07");
  });

  test("a job with no finished steps says so rather than showing an empty table", () => {
    const html = renderJobDetailPage(detail(), "2026-08-16T10:05:00Z", NAV, { tab: "steps" });
    expect(html).toContain("No step has finished yet");
  });

  // Spec 364, REQ-5: an "Effort" row beside the existing "Model" row —
  // added during plan review so this page does not show Model with no
  // Effort beside it for a step that ran with one.
  test("shows the effort a step ran at, beside Model", () => {
    const html = renderJobDetailPage(
      detail({ model: "sonnet", effort: "high" }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain(">Model<");
    expect(html).toContain(">Effort<");
    expect(html).toContain(">high<");
  });

  test("a step with no effort chosen reads 'not set'", () => {
    const html = renderJobDetailPage(detail({ model: "sonnet" }), "2026-08-16T10:05:00Z", NAV, { tab: "overview" });
    expect(html).toContain(">not set<");
  });

  // Criteria 4 and 5 were the "Live right now" panel, and spec 150
  // removed it outright: it existed for the one moment a step runs and
  // answered `State not-live · Subagents – · Cost so far – · Session
  // decc8861`, because claude-usage does not recognise a session run in
  // a worktree under `~/aide-worktrees/` — which is where every run has
  // worked since spec 91. Its absence is asserted in its own block
  // further down ("Live right now is gone").

  // Since spec 240 a step's own transcript lives on its own Steps row,
  // expanded through `step=`, rather than on a job-level Activity tab.
  test("a step's own log is rendered as the parser produced it, already escaped (AC1)", () => {
    const html = renderJobDetailPage(
      detail({
        results: [
          {
            step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
            terminalReason: "completed", at: "2026-08-16T10:01:00Z",
            logs: ["Bash <code>ls</code>".replace(/</g, "&lt;").replace(/>/g, "&gt;")],
          },
        ],
      }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "steps", step: "0" },
    );
    expect(html).toContain("&lt;code&gt;");
    expect(html).not.toContain("<code>ls</code>");
  });

  // A run refused by aide-run-spec never starts claude, so there is no
  // transcript to keep — and "nothing has been captured" reads as a
  // lost transcript rather than a run that never began. The reader
  // expanded this step precisely because they want to know what
  // happened (AC7).
  test("a step refused before it started says THAT, not that nothing was captured (AC7)", () => {
    const html = renderJobDetailPage(
      detail({
        state: "failed",
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
      { tab: "steps", step: "0" },
    );
    expect(html).toContain("refused before it started");
    // The banner already carries the job's own error, on every tab.
    expect(html).toContain("cannot fast-forward main");
    expect(html).not.toContain("Nothing has been captured from this step");
  });

  test("a refusal with no error text still says the step never started", () => {
    const html = renderJobDetailPage(
      detail({
        state: "failed",
        results: [
          {
            step: "archive", ok: false, costUsd: 0, costMeasured: false,
            terminalReason: "refused", at: "2026-08-17T10:00:00Z",
          },
        ],
      }),
      "2026-08-17T10:05:00Z",
      NAV,
      { tab: "steps", step: "0" },
    );
    expect(html).toContain("refused before it started");
  });

  test("a step with no transcript kept says so, rather than showing a blank panel", () => {
    const html = renderJobDetailPage(
      detail({
        results: [
          {
            step: "analyze", ok: true, costUsd: 0.1, costMeasured: true,
            terminalReason: "completed", at: "2026-08-16T10:01:00Z",
          },
        ],
      }),
      "2026-08-16T10:05:00Z",
      NAV,
      { tab: "steps", step: "0" },
    );
    expect(html).toContain("Nothing has been captured from this step");
  });

  test("the page is self-contained and carries the shared nav", () => {
    const html = renderJobDetailPage(detail(), "2026-08-16T10:05:00Z", NAV);
    expect(html).not.toContain("<script src");
    // The two the manifest needs, and nothing else — see the same
    // assertion under "self-contained (criterion 5)" for why.
    expect(external(html)).toEqual(["/manifest.webmanifest", "/apple-touch-icon.png"]);
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

  // Spec 252, Criterion 1: the page's own "← Back" tracks wherever the
  // reader came from, rather than the bare `/` it always fell back to —
  // the first test this control has ever had.
  test("← Back tracks the given backHref", () => {
    const html = renderJobDetailPage(
      detail({ backHref: "/?state=all&q=archive" }),
      "2026-08-16T10:05:00Z",
      NAV,
    );
    expect(html).toContain('<a class="backlink" href="/?state=all&amp;q=archive">← Back</a>');
  });

  test("← Back falls back to / when nothing was given", () => {
    const html = renderJobDetailPage(detail(), "2026-08-16T10:05:00Z", NAV);
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });

  // Spec 296: the spec folder title sits beside ← Back, on one line,
  // rather than in `pageShell()`'s own separate heading above it.
  test("the title sits inside .backhead, right after ← Back, and appears as <h1> exactly once", () => {
    const html = renderJobDetailPage(detail(), "2026-08-16T10:05:00Z", NAV);
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/">← Back</a><h1>02-job-detail-view</h1></div>',
    );
    expect(html.match(/<h1>02-job-detail-view<\/h1>/g)?.length ?? 0).toBe(1);
  });
});

// The two things the page says — what the job is, what it has done and
// is doing — ran together under plain headings, so a reader scrolled
// past the one they came for. One tab each.
//
// Spec 240 cut this from three tabs to two: Activity and Steps used to
// be two sibling tabs sharing one hidden attempt selection, with the
// tab bar's own counts reading off whichever attempt Activity had
// picked — a coupling invisible on the tab where the pick was made.
// Steps is now the one tab, and a step's own transcript is reached by
// expanding that step's row (`step=`) rather than by a tab of its own.
describe("the job page is split into tabs", () => {
  const withParts = (extra: Partial<JobDetailView> = {}): JobDetailView =>
    detail({
      title: "A running job is a black box",
      runningStep: { step: "analyze", logs: ["Bash ls"] },
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
    expect(html).toContain('href="/specs/job-1234?tab=steps"');
  });

  test("the open tab is marked, and it is the only one", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV, { tab: "steps" });
    // The page proper, without the site's own tab bar above it — spec
    // 119 put a second marked tab there, and Specs is legitimately
    // current on a job page.
    const page = html.replace(/<nav[^>]*>[\s\S]*?<\/nav>/, "");
    expect(page.match(/aria-current="page"/g)).toHaveLength(1);
    expect(page).toMatch(/aria-current="page"[^>]*>Logs/);
  });

  // While a step is running, what it is DOING is what you opened the
  // page for — Steps is the only tab left that shows it, through the
  // running row (open by default).
  test("a running job opens on the steps tab, without being asked (AC3)", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV);
    expect(html).toMatch(/aria-current="page"[^>]*>Logs/);
    expect(html).toContain("Bash ls");
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

  // The coupling spec 239 left behind: a job's finished step and its
  // running step now sit on the SAME tab, so both are visible together
  // rather than one hiding behind a count on a tab nobody opened.
  test("the steps tab shows the running step's own log and every finished step's row", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV, { tab: "steps" });
    expect(html).toContain("Bash ls");
    expect(html).toContain("$0.42");
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

  // Spec 212 gave the spec page seven tabs and the job page three,
  // through ONE tab-bar renderer that takes the list as an argument;
  // spec 240 drops both to six and two. A job page that grew the spec
  // page's tabs would be that renderer reading the wrong list, which is
  // exactly what sharing it risks.
  test("a job has two tabs and only two, whatever the spec page offers", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV);
    const bar = html.match(/<nav class="tabbar subtabs">[\s\S]*?<\/nav>/)?.[0] ?? "";
    // No caption beside them since 2026-08-23: these are tabs, and the
    // page they sit on already says what it is about.
    expect(bar).not.toContain('class="lbl"');
    expect(bar.match(/<a class="tab" data-nav/g)).toHaveLength(2);
    for (const gone of ["tab=description", "tab=analysis", "tab=solution", "tab=status", "tab=activity"]) {
      expect([gone, bar.includes(gone)]).toEqual([gone, false]);
    }
  });

  // One finished step, plus the running row (AC6): the count is
  // finished steps + 1 while something is running.
  test("the tab says how much is behind it, so a reader knows before clicking (AC6)", () => {
    const html = renderJobDetailPage(withParts(), "2026-08-16T10:05:00Z", NAV);
    expect(html).toMatch(/>Logs \(2\)</);
  });

  test("an empty tab is still offered, and says why it is empty", () => {
    const html = renderJobDetailPage(detail(), "2026-08-16T10:05:00Z", NAV, { tab: "steps" });
    expect(html).toContain('href="/specs/job-1234?tab=steps"');
    expect(html).toContain("No step has finished yet");
  });
});
