import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueueRows,
  type JobDetailView,
} from "../../../src/render.ts";
import { stateChip, stateLabel } from "../../../src/render/ui/job-state.ts";
import { resolveOpenStep } from "../../../src/render/pages/job-page.ts";
import {
  external,
  NAV,
  detail,
  row,
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

// --- spec 240: which Steps row is open survives the page's own reload -------
//
// Approach A (a bare `<details>` per row) was rejected in `3-solution.md`
// for the exact reason `queue-list.ts` already rejected it for its own
// row-fold: both pages reload themselves every 10 seconds via a real
// `<meta http-equiv="refresh">`, a full navigation rather than a DOM
// patch, so a `<details open>` set by a click is gone on the very next
// refresh. The open row has to be a property of the URL instead.
describe("spec 240: resolveOpenStep", () => {
  test("no query and nothing running: nothing is open (AC2)", () => {
    expect(resolveOpenStep(undefined, false)).toBeUndefined();
  });

  test("no query but something running: the running row opens by default (AC3)", () => {
    expect(resolveOpenStep(undefined, true)).toBe("live");
  });

  test("an explicit step index wins over the running default", () => {
    expect(resolveOpenStep("0", true)).toBe("0");
  });

  test("the literal close value wins even while something is running (AC4)", () => {
    expect(resolveOpenStep("none", true)).toBeUndefined();
  });
});

describe("spec 240: a closed step stays closed across the page's own reload", () => {
  const runningJob = (): JobDetailView =>
    detail({
      runningStep: { step: "analyze", logs: ["Bash ls"] },
      results: [
        {
          step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
          terminalReason: "completed", at: "2026-08-16T10:01:00Z",
        },
      ],
    });

  test("with no step= at all, the running row opens by default (AC3)", () => {
    const html = renderJobDetailPage(runningJob(), "2026-08-16T10:05:00Z", NAV, { tab: "steps" });
    expect(html).toContain("Bash ls");
  });

  // The regression test for Approach A's rejected failure mode: render
  // the SAME closed state twice, standing in for the periodic reload,
  // and confirm it stays closed both times rather than snapping back
  // open the way a client-only `<details>` would have.
  test("step=none stays closed across a second render of the same state (AC4)", () => {
    const first = renderJobDetailPage(runningJob(), "2026-08-16T10:05:00Z", NAV, {
      tab: "steps",
      step: "none",
    });
    const second = renderJobDetailPage(runningJob(), "2026-08-16T10:05:10Z", NAV, {
      tab: "steps",
      step: "none",
    });
    for (const html of [first, second]) {
      expect(html).not.toContain("Bash ls");
      expect(html).toContain("$0.42");
    }
  });
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

  test("it belongs to the Overview — the other tab is unchanged", () => {
    const job = detail({
      state: "done",
      phase: { label: "4-status.md", text: "## Phase 1: RED" },
    });
    expect(renderJobDetailPage(job, "2026-08-21T10:05:00Z", NAV, { tab: "steps" })).not.toContain(
      "Phase 1: RED",
    );
  });
});

// --- spec 152: a figure that was over-charged says so wherever it is summed ---
//
// A killed step is charged its whole budget, because a SIGKILLed run
// prints no usage and the accounting must over-charge what it could not
// measure. `costMeasured: false` records that, and the job page's Steps
// table has marked it "est." per step since spec 118 — but the two
// TOTALS built on top of those steps had no access to the flag, so
// 149's spec total read "41.13 USD" as if it were money spent.
describe("provider-limit presentation", () => {
  test("the stopped label identifies the provider limit", () => {
    expect(stateLabel(row({ state: "stopped", stopReason: "provider-limit" } as never))).toBe(
      "stopped — provider limit",
    );
  });

  test("the specs list and job detail show the structured explanation", () => {
    const error = "seven day provider limit; resets 2026-08-24 12:00 UTC";
    const stopped = row({ state: "stopped", stopReason: "provider-limit", error } as never);
    expect(renderQueueRows([stopped], { runnerAvailable: true, targets: [] })).toContain(error);
    expect(renderJobDetailPage(detail({ ...stopped } as never), "2026-08-24T10:00:00Z", NAV)).toContain(error);
  });
});

describe("job-cap presentation", () => {
  test("the stopped label identifies the job cap, distinct from a budget stop", () => {
    expect(stateLabel(row({ state: "stopped", stopReason: "job-cap" } as never))).toBe(
      "stopped — job cap",
    );
  });
});

describe("the stopped badge carries its error as a tooltip", () => {
  test("a stopped row with an error gets the error as the badge's title", () => {
    const error = "the job cap ($4) would be exceeded by the next step";
    const html = stateChip(row({ state: "stopped", stopReason: "job-cap", error } as never));
    expect(html).toContain(`title="${error}"`);
  });

  test("a stopped row with no error gets no title attribute", () => {
    const html = stateChip(row({ state: "stopped", stopReason: "timeout" } as never));
    expect(html).not.toContain("title=");
  });

  test("a queued row parked with a held-back error gets no title attribute", () => {
    const html = stateChip(
      row({ state: "queued", error: "held back: the daily cap ($20) would be exceeded" } as never),
    );
    expect(html).not.toContain("title=");
  });
});
