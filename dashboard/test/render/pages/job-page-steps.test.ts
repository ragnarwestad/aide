// Which step the job page opens, what a phase's own page shows, and how
// a stopped run's reason reaches the reader.
//
// Split out of job-page.test.ts 2026-09-04; the tests are unchanged and
// keep their names.

import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueueRows,
  type JobDetailView,
} from "../../../src/render.ts";
import { stateChip, stateLabel } from "../../../src/render/ui/job-state.ts";
import { resolveOpenStep, specFilePanel, stepResults } from "../../../src/render/pages/job-page.ts";
import {
  NAV,
  detail,
  row,
} from "./fixtures.ts";


// Criteria 1, 2, 4, 5: what the job IS, everything it has already run,
// and what it is doing right now.

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

// Spec 360: `specFilePanel` and `stepResults` gained an optional `mark`
// parameter for the SPEC page's own "(?)" help popover — this page (the
// JOB detail page) draws no mark of its own and calls both with none, so
// the default must be a true no-op, byte-identical to the shape either
// function drew before the parameter existed.
describe("spec 360: specFilePanel/stepResults' optional mark is a no-op by default", () => {
  const FILE = { label: "2-analysis.md", text: "## Findings", sha: "a3f9c21deadbeef", at: "2026-08-21T09:14:00Z" };

  test("specFilePanel with no mark draws the plain <h2>, same as the job detail page's own render", () => {
    const html = specFilePanel(FILE, Date.parse("2026-08-21T10:05:00Z"));
    expect(html).not.toContain('<details class="intro">');
    expect(html.match(/<h2>[\s\S]*?<\/h2>/)![0]).toMatch(/^<h2>2-analysis\.md <span class="muted small">committed .* a3f9c21<\/span><\/h2>$/);
  });

  test("specFilePanel appends a passed mark at the end of the <h2>, before its close", () => {
    const html = specFilePanel(FILE, Date.parse("2026-08-21T10:05:00Z"), '<details class="intro">x</details>');
    const h2 = html.match(/<h2>[\s\S]*?<\/h2>/)![0];
    expect(h2.endsWith('<details class="intro">x</details></h2>')).toBe(true);
  });

  test("stepResults' empty state with no mark is unchanged", () => {
    expect(stepResults([])).toBe('<p class="muted">No step has finished yet.</p>');
  });

  test("stepResults' empty state appends a passed mark after the sentence", () => {
    expect(stepResults([], undefined, { mark: '<details class="intro">x</details>' })).toBe(
      '<p class="muted">No step has finished yet. <details class="intro">x</details></p>',
    );
  });

  test("stepResults' populated header row ends in a plain <th>At</th> with no mark", () => {
    const html = stepResults([
      { step: "analyze", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", at: "2026-08-19T09:00:00Z" },
    ]);
    expect(html).toContain("<th>At</th></tr></thead>");
    expect(html).not.toContain('<details class="intro">');
  });

  test("stepResults' populated header row appends a passed mark inside the last <th>", () => {
    const html = stepResults(
      [{ step: "analyze", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", at: "2026-08-19T09:00:00Z" }],
      undefined,
      { mark: '<details class="intro">x</details>' },
    );
    expect(html).toContain('<th>At<details class="intro">x</details></th></tr></thead>');
  });
});

// spec 395: a step whose own work is still landing has no `at` yet —
// the Steps tab must show a dash for it, not `esc(undefined)` throwing
// or printing the literal word "undefined".
describe("spec 395: a step still landing renders no timestamp, not undefined", () => {
  test("stepResults renders a dash when a result's own at is absent", () => {
    const html = stepResults([
      { step: "archive", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed" },
    ]);
    expect(html).toContain('<td class="muted small">–</td></tr>');
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

describe("red-suite presentation", () => {
  test("the stopped label identifies the red suite, distinct from a budget stop", () => {
    expect(stateLabel(row({ state: "stopped", stopReason: "tests-red" } as never))).toBe(
      "stopped — tests red",
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

// The test run on the merge belongs to archiving, whatever file it lives
// in. A reader who opened the Steps tab after a refused merge saw four
// rows reading "ok" and no sign of the tests that refused it — the page
// telling them the opposite of what the row on the specs list said.
describe("a step whose merge was refused does not read ok", () => {
  const REFUSED: JobDetailView = detail({
    steps: ["create", "analyze", "implement", "archive"],
    stepIndex: 3,
    state: "stopped",
    stopReason: "tests-red",
    errorReason: "tests-red",
    landingError: { key: "landing.stepStopped", values: { step: "archive" } },
    errorDetail: "(fail) some suite > a test that failed [12ms]\n 1 fail",
    results: [
      { step: "implement", ok: true, costUsd: 1, costMeasured: true, terminalReason: "completed", at: "2026-09-09T09:00:00Z" },
      { step: "archive", ok: true, costUsd: 1, costMeasured: true, terminalReason: "completed", at: "2026-09-09T09:10:00Z" },
    ],
  });
  const cellsFor = (html: string, step: string): string =>
    html.match(new RegExp(`<tr><td>[^<]*(?:<[^>]+>)*${step}</td>.*?</tr>`))?.[0] ?? "";

  test("the archive row says the merge stopped, and the others still say ok", () => {
    const html = stepResults(REFUSED.results, undefined, {
      landingRefused: { step: "archive", word: "merge stopped", detail: REFUSED.errorDetail },
    });
    expect(cellsFor(html, "archive")).toContain("merge stopped");
    expect(cellsFor(html, "archive")).not.toContain(">ok<");
    expect(cellsFor(html, "implement")).toContain("ok");
  });

  test("its open panel names the tests that failed", () => {
    const html = stepResults(REFUSED.results, undefined, {
      tabHref: "/specs/aide/1-x?tab=steps",
      openStep: "1",
      landingRefused: { step: "archive", word: "merge stopped", detail: "(fail) some suite > a test that failed" },
    });
    expect(html).toContain("(fail) some suite &gt; a test that failed");
  });
});

// Spec 433: which of create's two paths ran shows on the Steps tab —
// "created (no AI)" for the deterministic path, the ordinary "ok" for
// every other finished step, an AI-run create included.
describe("a no-AI create reads distinctly from an AI-run one (spec 433)", () => {
  const cellsFor = (html: string, step: string): string =>
    html.match(new RegExp(`<tr><td>[^<]*(?:<[^>]+>)*${step}</td>.*?</tr>`))?.[0] ?? "";

  test("create with tool: \"none\" reads \"created (no AI)\"", () => {
    const html = stepResults([
      { step: "create", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", tool: "none" },
    ]);
    expect(cellsFor(html, "create")).toContain("created (no AI)");
    expect(cellsFor(html, "create")).not.toContain(">ok<");
  });

  test("an AI-run create still reads ok", () => {
    const html = stepResults([
      { step: "create", ok: true, costUsd: 0.4, costMeasured: true, terminalReason: "completed", tool: "claude" },
    ]);
    expect(cellsFor(html, "create")).toContain(">ok<");
    expect(cellsFor(html, "create")).not.toContain("no AI");
  });
});
