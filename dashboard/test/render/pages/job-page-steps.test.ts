// Which step the job page opens, what a phase's own page shows, and how
// a stopped run's reason reaches the reader.
//
// Split out of job-page.test.ts 2026-09-04; the tests are unchanged and
// keep their names.

import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderSpecsRows,
  type JobDetailView,
} from "../../../src/render";
import { stateChip } from "../../../src/render/ui/job-state";
import { landingRefusal, resolveOpenStep, specFilePanel, stepResults } from "../../../src/render/pages/job-page";
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
// for the exact reason `specs-list.ts` already rejected it for its own
// row-fold: both pages reload themselves every 10 seconds via a real
// `<meta http-equiv="refresh">`, a full navigation rather than a DOM
// patch, so a `<details open>` set by a click is gone on the very next
// refresh. The open row has to be a property of the URL instead.
// The raw words behind a landing failure are kept on the job beside the
// sentence (2026-09-20): `errorDetail` belongs to what the row waits for
// now, and a job that has moved on has already overwritten it.
describe("a landing refusal's detail", () => {
  test("prefers the landing's own kept detail over the job's current one", () => {
    const refusal = landingRefusal(
      {
        landingError: { key: "landing.stepFailed", values: { step: "create" }, inner: { key: "landing.createAssignNumberFailed" } },
        landingErrorDetail: "aide-create-spec: the specs root moved under the worktree",
        errorDetail: "something else entirely",
      },
      "en",
    );
    expect(refusal?.step).toBe("create");
    expect(refusal?.detail).toContain("the specs root moved under the worktree");
    expect(refusal?.detail).not.toContain("something else entirely");
  });
});

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

  test("specFilePanel appends a passed mark at the end of the <h2>, before its close", () => {
    const html = specFilePanel(FILE, Date.parse("2026-08-21T10:05:00Z"), '<details class="intro">x</details>');
    const h2 = html.match(/<h2>[\s\S]*?<\/h2>/)![0];
    expect(h2.endsWith('<details class="intro">x</details></h2>')).toBe(true);
  });

  test("stepResults' empty state appends a passed mark after the sentence", () => {
    expect(stepResults([], undefined, { mark: '<details class="intro">x</details>' })).toBe(
      '<p class="muted">No step has finished yet. <details class="intro">x</details></p>',
    );
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

// --- spec 152: a figure that could not be measured says so wherever it is summed ---
//
// A killed step reports its cost as unmeasured (0), because a SIGKILLed
// run prints no usage. `costMeasured: false` records that, and the job
// page's Steps table has marked it "est." per step since spec 118 — but
// the two TOTALS built on top of those steps had no access to the flag,
// so 149's spec total read "41.13 USD" as if it were money spent.
describe("provider-limit presentation", () => {
  test("the specs list and job detail show the structured explanation", () => {
    const error = "seven day provider limit; resets 2026-08-24 12:00 UTC";
    const capitalized = "Seven day provider limit; resets 2026-08-24 12:00 UTC";
    const stopped = row({ state: "stopped", stopReason: "provider-limit", error } as never);
    expect(renderSpecsRows([stopped], { runnerAvailable: true, targets: [] })).toContain(capitalized);
    expect(renderJobDetailPage(detail({ ...stopped } as never), "2026-08-24T10:00:00Z", NAV)).toContain(capitalized);
  });

  // The tool's own record, when the step carries one, is what the row
  // says: which AI and model, which window ran out, and what else the
  // tool reported — not the runner's one-line summary of it.
  const limit = {
    tool: "claude",
    window: "five_hour",
    resetsAt: "2026-09-17T10:10:00Z",
    windows: [
      { name: "five_hour", usedPercent: 100, resetsAt: "2026-09-17T10:10:00Z" },
      { name: "seven_day", usedPercent: 23, resetsAt: "2026-09-20T01:00:00Z" },
    ],
    credit: "out_of_credits",
  };

  test("the specs list says the limit in full when the step recorded it", () => {
    const stopped = row({
      state: "stopped",
      stopReason: "provider-limit",
      error: "five hour provider limit reached — press Analyze again once it resets; resets 2026-09-17T10:10:00Z",
      model: "Sonnet",
      steps: ["analyze"],
      results: [{ step: "analyze", ok: false, costUsd: 1.58, terminalReason: "provider-limit", providerLimit: limit }],
    } as never);
    const html = renderSpecsRows([stopped], { runnerAvailable: true, targets: [] });
    expect(html).toContain("Claude (Sonnet): the five-hour limit is used up — resets ");
    expect(html).toContain("The weekly limit: 23 % used. No extra usage is left.");
    expect(html).not.toContain("five hour provider limit reached");
  });

  test("the Logs summary names the limit under the step's result", () => {
    const html = stepResults(
      [{ step: "analyze", ok: false, costUsd: 1.58, costMeasured: true, terminalReason: "provider-limit",
        providerLimit: limit, logs: ["Read spec"] }],
      undefined,
      { tabHref: "/specs/aide/479-x?tab=steps", openStep: "0" },
    );
    expect(html).toContain("Claude: the five-hour limit is used up — resets ");
  });
});

// spec 442: the job detail page's own banner bypasses rowMessage, so it
// capitalizes job.error's rendered sentence directly.
describe("the job detail page's banner capitalizes job.error (spec 442)", () => {
  test("a lowercase-starting error renders with an uppercase first letter", () => {
    const stopped = row({ state: "stopped", stopReason: "timeout", error: "stopped at its own time limit" } as never);
    const html = renderJobDetailPage(detail({ ...stopped } as never), "2026-08-24T10:00:00Z", NAV);
    expect(html).toContain("Stopped at its own time limit");
  });
});

describe("the stopped badge carries its error behind a '(?)' (spec 454)", () => {
  test("a stopped row with an error gets the error inside a helpPopover", () => {
    const error = "seven day provider limit; resets 2026-08-24 12:00 UTC";
    const html = stateChip(row({ state: "stopped", stopReason: "provider-limit", error } as never));
    expect(html).not.toContain(`title="${error}"`);
    expect(html).toContain(`<p>${error}</p>`);
  });

  test("a stopped row with no error gets no title attribute and no mark", () => {
    const html = stateChip(row({ state: "stopped", stopReason: "timeout" } as never));
    expect(html).not.toContain("title=");
    expect(html).not.toContain("<details");
  });

  test("a queued row parked with a held-back error gets no title attribute and no mark", () => {
    const html = stateChip(
      row({ state: "queued", error: "held back: not analyzed yet — run /aide-analyze first" } as never),
    );
    expect(html).not.toContain("title=");
    expect(html).not.toContain("<details");
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
    expect(cellsFor(html, "Archive")).toContain("merge stopped");
    expect(cellsFor(html, "Archive")).not.toContain(">ok<");
    expect(cellsFor(html, "Implement")).toContain("ok");
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
    expect(cellsFor(html, "Create")).toContain("created (no AI)");
    expect(cellsFor(html, "Create")).not.toContain(">ok<");
  });

  test("an AI-run create still reads ok", () => {
    const html = stepResults([
      { step: "create", ok: true, costUsd: 0.4, costMeasured: true, terminalReason: "completed", tool: "claude" },
    ]);
    expect(cellsFor(html, "Create")).toContain(">ok<");
    expect(cellsFor(html, "Create")).not.toContain("no AI");
  });
});

// Spec 452: a summary above each step's own raw log — files, commands,
// final message and the step's already-existing numbers, repeated from
// the SAME fields the row itself draws (AC-5), never a second computed
// copy of them.
describe("the Logs tab's per-step summary (spec 452)", () => {
  const FULL_RESULT = {
    step: "implement",
    ok: true,
    costUsd: 1.23,
    costMeasured: true,
    terminalReason: "completed",
    at: "2026-09-13T10:05:00Z",
    logs: ["Bash bun test"],
    commands: [{ command: "bun test", outcome: { kind: "ok" as const }, durationMs: 1500 }],
    finalMessage: "All done.",
    changedFiles: [{ path: "src/queue/runner.ts", added: 4, removed: 1, binary: false }],
  };

  test("AC-6: neither the summary nor the raw log is in the markup while the row is collapsed", () => {
    const html = stepResults([FULL_RESULT], undefined, { tabHref: "/specs/aide/1-x?tab=steps" });
    expect(html).not.toContain("Changed files");
    expect(html).not.toContain("Bash bun test");
  });

  test("AC-1/AC-2/AC-3/AC-4: the summary renders above the raw log once the row is expanded", () => {
    const html = stepResults([FULL_RESULT], undefined, { tabHref: "/specs/aide/1-x?tab=steps", openStep: "0" });
    const summaryAt = html.indexOf("Changed files");
    const logAt = html.indexOf("Bash bun test");
    expect(summaryAt).toBeGreaterThan(-1);
    expect(logAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeLessThan(logAt);
    expect(html).toContain("src/queue/runner.ts");
    expect(html).toContain("bun test");
    expect(html).toContain("All done.");
  });

  test("AC-5: the summary's own numbers are exactly the row's costUsd/tokens/terminalReason/at, not a recomputed copy", () => {
    const html = stepResults([FULL_RESULT], undefined, { tabHref: "/specs/aide/1-x?tab=steps", openStep: "0" });
    expect(html).toContain("2026-09-13T10:05:00Z");
    expect(html).toContain("$1.23");
    expect(html).toContain("completed");
  });

  test("a binary changed file never reads as a false zero", () => {
    const html = stepResults(
      [{ ...FULL_RESULT, changedFiles: [{ path: "assets/logo.png", added: 0, removed: 0, binary: true }] }],
      undefined,
      { tabHref: "/specs/aide/1-x?tab=steps", openStep: "0" },
    );
    expect(html).toContain("assets/logo.png");
    expect(html).toContain("binary");
  });

  test("AC-7: a step with no log states the log is missing, alongside whatever numbers exist", () => {
    const html = stepResults(
      [
        {
          step: "implement", ok: false, costUsd: 0.5, costMeasured: true, terminalReason: "process-gone",
          at: "2026-09-13T10:05:00Z",
        },
      ],
      undefined,
      { tabHref: "/specs/aide/1-x?tab=steps", openStep: "0" },
    );
    expect(html).toContain("log is missing");
    expect(html).toContain("$0.50");
    expect(html).toContain("process-gone");
    expect(html).not.toContain("Commands");
    expect(html).not.toContain("Changed files");
  });
});

// The Logs tab's filter: four links above an expanded step's raw log.
// Links rather than a widget, for the reason the open row is a link —
// the page reloads itself every ten seconds, and anything held only in
// the browser snaps back to everything while the reader is reading.
describe("filtering a step's raw log", () => {
  const RESULT = {
    step: "implement",
    ok: true,
    costUsd: 0.4,
    costMeasured: true,
    terminalReason: "completed",
    at: "2026-09-17T10:05:00Z",
    logs: ["Bash bun test"],
  };
  const HREF = "/specs/aide/1-x?tab=steps";

  test("the links are on the expanded row, and each carries its own answer in the URL", () => {
    const html = stepResults([RESULT], undefined, { tabHref: HREF, openStep: "0" });

    expect(html).toContain(`href="${HREF}&step=0&only=commands"`);
    expect(html).toContain(`href="${HREF}&step=0&only=files"`);
    expect(html).toContain(`href="${HREF}&step=0&only=errors"`);
    // Unfiltered, "All" is where the reader already is: plain text.
    expect(html).toContain(">All<");
    expect(html).not.toContain(`href="${HREF}&step=0"`);
  });

  test("the step link is marked by data-steplink, open and closed, and is no steplink class (AC-2)", () => {
    for (const openStep of ["0", "none"]) {
      const html = stepResults([RESULT], undefined, { tabHref: HREF, openStep });
      const link = html.match(/<a class="fold[^"]*" data-nav[^>]*>/)?.[0] ?? "";
      expect(link).toContain(" data-steplink ");
      expect(link).toContain(openStep === "0" ? 'class="fold"' : 'class="fold shut"');
      expect(html).not.toContain("steplink\"");
      expect(html).not.toMatch(/class="[^"]*\bsteplink\b/);
    }
  });

  test("a collapsed row has no filter links at all", () => {
    const html = stepResults([RESULT], undefined, { tabHref: HREF });

    expect(html).not.toContain("only=commands");
  });

  test("the filter in force is not a link back to itself", () => {
    const html = stepResults([RESULT], undefined, { tabHref: HREF, openStep: "0", only: "commands" });

    expect(html).not.toContain("only=commands\"");
    expect(html).toContain(`href="${HREF}&step=0&only=files"`);
    // ...and "All" becomes the way back to the whole log.
    expect(html).toContain(`href="${HREF}&step=0"`);
  });

  test("a filter that matched nothing says so, and keeps the links up", () => {
    const html = stepResults([{ ...RESULT, logs: [] }], undefined, {
      tabHref: HREF, openStep: "0", only: "errors",
    });

    expect(html).toContain("No line of this kind");
    expect(html).toContain("only=commands");
  });

  test("an unfiltered step with an empty log still says nothing was captured", () => {
    const html = stepResults([{ ...RESULT, logs: [] }], undefined, { tabHref: HREF, openStep: "0" });

    expect(html).toContain("Nothing has been captured");
    expect(html).not.toContain("No line of this kind");
  });
});
