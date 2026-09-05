// Split out of history-and-freshness.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  computeSpecTotalDurationMs,
  renderQueueRows,
  type ArchivedSpecView,
  type QueueRowView,
  type QueueTarget,
} from "../../../src/render.ts";
import { durationLabel } from "../../../src/render/ui/job-state.ts";
import { phaseDuration } from "../../../src/render/pages/queue-list/data-model/phases.ts";

// --- spec 199: time becomes something worth reading -------------------------
//
// A phase says how long it TOOK. Nothing stores a per-step duration —
// a job has one `startedAt` however many steps it ran — so a step's
// own span is sliced out of the boundaries that do exist: the previous
// step's end, or the job's own start for the first one. Getting that
// wrong by reaching for the job's whole span instead is the one
// mistake this block exists to catch.
describe("a phase says how long it took", () => {
  const NOW = "2026-08-16T12:00:00Z";

  const job = (id: string, spec: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: spec,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T08:00:00Z",
    ...extra,
  });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // `renderQueueRows`, not `renderQueuePage`: the page reads the clock
  // itself and takes no `now`, and every figure in this block is
  // measured against one.
  const page = (rows: QueueRowView[], targets: QueueTarget[] = [], spec = "aa-spec") =>
    renderQueueRows(
      rows,
      { runnerAvailable: true, targets, filter: { open: `aide/${spec}` } },
      Date.parse(NOW),
    );

  /** One phase line's Started cell — which since spec 199 holds that
   *  phase's own duration, not when it began. */
  const phaseCell = (html: string, step: string): string =>
    html
      .match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  /** The spec header row's own Started cell. */
  const headCell = (html: string, folder: string): string =>
    html
      .match(new RegExp(`<tr class="spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  test("a finished single-step phase shows its own span (criterion 3)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze"],
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:04:12Z" }],
      }),
    ]);
    expect(phaseCell(html, "analyze")).toContain("4m12s");
  });

  // The trap: a job that ran two steps has ONE `startedAt`, and the
  // whole job's span belongs to neither step. The second step's own
  // duration runs from where the first one ended.
  test("a two-step job's second phase shows its own slice, not the job's span (criterion 7)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze", "implement"],
        stepIndex: 1,
        startedAt: "2026-08-16T09:00:00Z",
        results: [
          { step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:10:00Z" },
          { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:40:00Z" },
        ],
      }),
    ]);
    expect(phaseCell(html, "analyze")).toContain("10m00s");
    expect(phaseCell(html, "implement")).toContain("30m00s");
    // 40 minutes is the whole job — the answer a reach for
    // `finishedAt - startedAt` would have given.
    expect(phaseCell(html, "implement")).not.toContain("40m");
  });

  // Every phase says how long it took, `0s` included — an empty cell
  // asks the reader whether the phase ran at all, which the badge beside
  // it already answers.
  test("a phase nobody has run reads 0s, not an empty cell", () => {
    const html = page([
      job("a1", "aa-spec", {
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:04:12Z" }],
      }),
    ]);
    expect(phaseCell(html, "archive")).toContain("0s");
  });

  // A running phase carries the instant it began, so the browser can
  // count up from it without waiting for the server to redraw
  // (criterion 4). The server still writes a readable figure into the
  // cell, so the page says something with script switched off.
  test("a running phase carries its start for the page's own clock (criterion 4)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze", "implement"],
        stepIndex: 1,
        state: "running",
        startedAt: "2026-08-16T11:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T11:30:00Z" }],
      }),
    ]);
    const cell = phaseCell(html, "implement");
    expect(cell).toContain('data-elapsed="2026-08-16T11:30:00Z"');
    expect(cell).toContain("30m00s");
  });

  test("a running FIRST step counts from the job's own start (criterion 4)", () => {
    const html = page([
      job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T11:45:00Z" }),
    ]);
    expect(phaseCell(html, "analyze")).toContain('data-elapsed="2026-08-16T11:45:00Z"');
    expect(phaseCell(html, "analyze")).toContain("15m00s");
  });

  // The work, not the calendar. These two jobs are three days apart and
  // the spec took twenty minutes (criteria 5 and 6). The total left the
  // header cell on 2026-08-24 — beside "3 d ago" it read as noise — and
  // spec 281 puts it back as the ONLY thing the cell shows, with the
  // "X ago" text it used to sit beside gone rather than brought back.
  test("a finished spec's phases carry their durations, and so does the header (spec 281)", () => {
    const html = page(
      [
        job("a1", "aa-spec", {
          steps: ["analyze"],
          startedAt: "2026-08-13T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-13T09:05:00Z" }],
        }),
        job("a2", "aa-spec", {
          steps: ["implement", "archive"],
          stepIndex: 1,
          startedAt: "2026-08-16T09:00:00Z",
          results: [
            { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:10:00Z" },
            { step: "archive", ok: true, costUsd: 1, at: "2026-08-16T09:15:00Z" },
          ],
        }),
      ],
      [target("aa-spec", { createdAt: "2026-08-13T08:00:00Z", done: ["analyze", "implement", "archive"] })],
    );
    // 5 + 10 + 5 minutes of work, on the lines that did it AND on the
    // header now — the same figure rather than two different ones.
    expect(headCell(html, "aa-spec")).toContain("20m00s");
    expect(headCell(html, "aa-spec")).not.toContain("3 d ago");
    expect(phaseCell(html, "analyze")).toContain("5m00s");
    expect(phaseCell(html, "implement")).toContain("10m00s");
    expect(phaseCell(html, "archive")).toContain("5m00s");
  });

  // Spec 281: the header cell answers "how long", not "when made" — a
  // spec still missing a phase is exactly the case spec 207's guard used
  // to blank entirely.
  test("a spec still missing a phase shows the sum of what has settled (spec 281)", () => {
    const html = page(
      [
        job("a1", "aa-spec", {
          steps: ["analyze"],
          startedAt: "2026-08-13T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-13T09:12:00Z" }],
        }),
      ],
      [target("aa-spec", { createdAt: "2026-08-13T08:00:00Z", done: ["analyze"] })],
    );
    expect(headCell(html, "aa-spec")).toContain("12m00s");
  });

  // REQ-2: a running phase's own elapsed-so-far now counts toward the
  // header total (reversing spec 281's exclusion), and the cell carries
  // `data-elapsed` so the browser's existing per-second tick
  // (`queue-client.ts`) keeps counting it up with no further redraw.
  test("a spec with a phase in flight sums what has settled plus the live phase's elapsed time, and ticks (REQ-2)", () => {
    const html = page(
      [
        job("a1", "aa-spec", {
          steps: ["analyze", "implement"],
          stepIndex: 1,
          state: "running",
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:10:00Z" }],
        }),
      ],
      [target("aa-spec", { createdAt: "2026-08-16T08:00:00Z", done: ["analyze"] })],
    );
    // Analyze's 10 minutes settled, plus implement's own elapsed time
    // from 09:10 to NOW (12:00): 2h50m. Total: 3h00m.
    expect(headCell(html, "aa-spec")).toContain("3h00m");
    // The synthetic since = implement's start (09:10) minus the settled
    // 10 minutes = 09:00 — so `now - since` reproduces the same total.
    expect(headCell(html, "aa-spec")).toContain('data-elapsed="2026-08-16T09:00:00.000Z"');
  });

  test("a spec with no job ever run for it reads 0s", () => {
    const html = page([], [target("aa-spec", { createdAt: "2026-06-01T09:00:00Z" })]);
    expect(headCell(html, "aa-spec")).toContain("0s");
    // And never a date: the column answers "how long", and a date under
    // that heading is a different question wearing its clothes.
    expect(headCell(html, "aa-spec")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

// Spec 207: the summing the spec list has always done, lifted out of
// the render so the archive-time write calls the SAME function. The
// figure stored in `4-status.md` and the figure the list drew cannot
// drift apart if there is only one of them.
//
// Spec 281 dropped the function's two completion guards, and the `done`
// parameter they read: the list now shows this sum on a LIVE row too,
// not only once the whole workflow is behind it, so it can no longer
// refuse to answer while the spec is still working.
//
// Called directly rather than through a page: what is under test is the
// math, and a route test proves nothing about it that this doesn't.
describe("computeSpecTotalDurationMs (spec 207, spec 281)", () => {
  const row = (id: string, extra: Partial<QueueRowView>): QueueRowView => ({
    id,
    project: "aide",
    specFolder: "aa-spec",
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-13T08:00:00Z",
    ...extra,
  });

  /** The same three jobs the list's own "sum, not span" test uses: five
   *  minutes of analyze, ten of implement, five of archive, three days
   *  apart. */
  const rows = (): QueueRowView[] => [
    row("a1", {
      steps: ["analyze"],
      startedAt: "2026-08-13T09:00:00Z",
      results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-13T09:05:00Z" }],
    }),
    row("a2", {
      steps: ["implement", "archive"],
      stepIndex: 1,
      startedAt: "2026-08-16T09:00:00Z",
      results: [
        { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:10:00Z" },
        { step: "archive", ok: true, costUsd: 1, at: "2026-08-16T09:15:00Z" },
      ],
    }),
  ];

  const NOW = Date.parse("2026-08-20T00:00:00Z");

  test("adds the phases up, and answers in milliseconds", () => {
    expect(computeSpecTotalDurationMs(rows(), NOW)?.ms).toBe(20 * 60 * 1000);
  });

  // The exact case 1-description.md names as the motivation: a spec
  // stopped by an error still owes a total — analyze finished, nothing
  // else has run yet — and the old `done`-keyed guard blanked exactly
  // this row.
  test("a spec still missing a phase sums what it has", () => {
    expect(computeSpecTotalDurationMs([rows()[0]!], NOW)?.ms).toBe(5 * 60 * 1000);
  });

  // REQ-2: a phase in flight elsewhere now CONTRIBUTES its own elapsed
  // time to the total (reversing the old exclusion), and the result
  // carries the synthetic `since` the header cell needs to tick from.
  // The live job here is on `create`, a phase neither of `rows()`'s jobs
  // has touched, so its elapsed time adds on top of both settled phases.
  test("a job in flight elsewhere adds its own elapsed time to the settled total, and marks it live (REQ-2)", () => {
    const withRunning = [
      ...rows(),
      row("a3", { steps: ["create"], state: "running", startedAt: "2026-08-20T09:00:00Z" }),
    ];
    const now = Date.parse("2026-08-20T09:05:00Z");
    const total = computeSpecTotalDurationMs(withRunning, now);
    // 20 minutes settled (analyze + implement) + 5 minutes of create's
    // own elapsed time so far.
    expect(total?.ms).toBe(25 * 60 * 1000);
    expect(total?.live).toBe(true);
    // since = create's start (09:00) minus the settled 20 minutes = 08:40.
    expect(total?.since).toBe("2026-08-20T08:40:00.000Z");
  });

  test("a spec nothing has ever run for measures nothing", () => {
    expect(computeSpecTotalDurationMs([], NOW)).toBeUndefined();
  });

  // REQ-1: a phase re-run as two separate settled job attempts (an
  // earlier failed/retried run, then a later one) contributes BOTH —
  // the bug 1-description.md names: "a phase re-run three times
  // contributes once" (now: contributes every time).
  test("a phase retried as a second settled job attempt contributes both durations (REQ-1)", () => {
    const withRetry = [
      ...rows(),
      // A second, later attempt at "analyze" — a re-run of the same
      // step from a different job, three days after the first.
      row("a4", {
        steps: ["analyze"],
        startedAt: "2026-08-19T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-19T09:08:00Z" }],
      }),
    ];
    // 5 (first analyze) + 10 (implement) + 5 (archive) + 8 (second
    // analyze attempt) = 28 minutes, not 23 — the second attempt is not
    // dropped in favor of the newest-only answer.
    expect(computeSpecTotalDurationMs(withRetry, NOW)?.ms).toBe(28 * 60 * 1000);
  });

  // The list draws this figure on a live row now (spec 281) — the
  // inverse of the rule this block asserted from spec 207 until then.
  test("the spec list draws the figure, on a spec still missing a phase", () => {
    const html = renderQueueRows(
      [rows()[0]!],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "aa-spec", createdAt: "2026-08-13T08:00:00Z", done: ["analyze"] }],
        filter: { open: "aide/aa-spec" },
      },
      Date.parse("2026-08-16T12:00:00Z"),
    );
    expect(html).toContain("5m00s");
  });

  // REQ-3/REQ-5: the same phase timings, summed by each of the two
  // pipelines this page has — the live one (job records, via this
  // function) and the archived one (`readerGroup`'s reduce over each
  // phase file's own `Time spent:` line) — must agree, for the no-retry
  // case both pipelines can represent (3-solution.md, "Behavior delta").
  // This is not provably ONE shared source (2-analysis.md, "REQ-2's
  // 'same computation source'..."), so it proves parity on equivalent
  // inputs rather than asserting one implementation calls the other. It
  // also now proves REQ-3/REQ-5's "same rule" claim under the new
  // summing behavior (every attempt), not only the old latest-only one —
  // `rows()` has no retried phase, so both pipelines see one attempt per
  // step either way.
  test("agrees with the archived figure for the same underlying phase timings (REQ-3, REQ-5)", () => {
    const liveMs = computeSpecTotalDurationMs(rows(), NOW)?.ms;
    const archived: ArchivedSpecView = {
      project: "aide",
      folder: "aa-spec",
      archivedAt: "2026-08-16T09:15:00Z",
      done: ["analyze", "implement", "archive"],
      models: {},
      phaseOutcomes: {
        analyze: { timeSpentMs: 5 * 60 * 1000 },
        implement: { timeSpentMs: 10 * 60 * 1000 },
        archive: { timeSpentMs: 5 * 60 * 1000 },
      },
    };
    const html = renderQueueRows([], {
      runnerAvailable: true,
      targets: [],
      archivedSpecs: [archived],
      filter: { state: "archived" },
    });
    expect(liveMs).toBeDefined();
    expect(html).toContain(durationLabel(liveMs!));
  });
});

// spec 384: a step's own recorded start, not the boundary before it --------
//
// The finished-step branch now prefers `StepResult.startedAt` — set once
// the runner actually spawned that step — over the previous step's own
// end. The in-flight branch stops treating a job merely `queued` for its
// next step as though that step were already running: held back for a
// dependency, an open acceptance row, a landing, a full concurrency slot
// or the daily cap, it owes no duration until it is actually spawned.
//
// Every existing test above sets neither `startedAt` nor
// `stepStartedAt` on its fixtures, which is exactly REQ-3's own
// regression guard: none of them are touched here.
describe("phaseDuration prefers a step's own recorded start (spec 384)", () => {
  const row = (extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id: "a1",
    project: "aide",
    specFolder: "aa-spec",
    steps: ["analyze", "implement"],
    stepIndex: 1,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T08:00:00Z",
    ...extra,
  });

  test("a finished step's own recorded start wins over the previous step's end (REQ-2)", () => {
    const r = row({
      startedAt: "2026-08-16T09:00:00Z",
      results: [
        { step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:10:00Z" },
        // implement's own recorded start sits an hour after analyze
        // ended — the gap this fix now excludes.
        { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T10:40:00Z", startedAt: "2026-08-16T10:30:00Z" },
      ],
    });
    const d = phaseDuration(r, "implement", Date.parse("2026-08-16T12:00:00Z"));
    expect(d?.ms).toBe(10 * 60 * 1000);
    // Not the boundary-based figure (09:10 to 10:40 = 90 minutes), which
    // is what today's formula would have returned.
    expect(d?.ms).not.toBe(90 * 60 * 1000);
  });

  // The literal "listed at over ten hours... nine and a half held back"
  // case 1-description.md opens with.
  test("a queued job between two steps shows no live duration, however long the previous step's own end sits in the past (REQ-4)", () => {
    const r = row({
      state: "queued",
      startedAt: "2026-08-16T09:00:00Z",
      results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:10:00Z" }],
    });
    const d = phaseDuration(r, "implement", Date.parse("2026-08-16T20:00:00Z"));
    expect(d).toBeNull();
  });
});
