// Split out of history-and-freshness.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  computeSpecTotalDurationMs,
  renderQueueRows,
  type ArchivedSpecView,
  type QueueRowView,
  type QueueTarget,
} from "../../src/render.ts";
import { durationLabel } from "../../src/render/ui/job-state.ts";

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

  test("a phase nobody has run shows nothing at all", () => {
    const html = page([
      job("a1", "aa-spec", {
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:04:12Z" }],
      }),
    ]);
    expect(phaseCell(html, "archive")).toBe("");
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

  test("a spec with a phase in flight sums only what has settled, excluding its own live elapsed time (spec 281)", () => {
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
    // Analyze's 10 minutes only — implement is still running at NOW
    // (12:00), and its own elapsed 2h50m must not be swept in.
    expect(headCell(html, "aa-spec")).toContain("10m00s");
    expect(headCell(html, "aa-spec")).not.toContain("2h");
  });

  test("a spec with no job ever run for it shows a dash", () => {
    const html = page([], [target("aa-spec", { createdAt: "2026-06-01T09:00:00Z" })]);
    expect(headCell(html, "aa-spec")).toContain("–");
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

  test("adds the phases up, and answers in milliseconds", () => {
    expect(computeSpecTotalDurationMs(rows())).toBe(20 * 60 * 1000);
  });

  // The exact case 1-description.md names as the motivation: a spec
  // stopped by an error still owes a total — analyze finished, nothing
  // else has run yet — and the old `done`-keyed guard blanked exactly
  // this row.
  test("a spec still missing a phase sums what it has", () => {
    expect(computeSpecTotalDurationMs([rows()[0]!])).toBe(5 * 60 * 1000);
  });

  // The other half of the old guard: a job in flight used to blank the
  // WHOLE total, not just its own still-ticking span. `spentUsd` never
  // waited for a job to finish before summing (`group-builders.ts`), and
  // this now matches it — the live job here is on `create`, a phase
  // neither of `rows()`'s jobs has touched, so it adds a live, skipped
  // attempt rather than superseding a settled one.
  test("a job in flight elsewhere does not blank the total for phases already settled", () => {
    const withRunning = [
      ...rows(),
      row("a3", { steps: ["create"], state: "running", startedAt: "2026-08-20T09:00:00Z" }),
    ];
    expect(computeSpecTotalDurationMs(withRunning)).toBe(20 * 60 * 1000);
  });

  test("a spec nothing has ever run for measures nothing", () => {
    expect(computeSpecTotalDurationMs([])).toBeUndefined();
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

  // REQ-2: the same phase timings, summed by each of the two pipelines
  // this page has — the live one (job records, via this function) and
  // the archived one (`readerGroup`'s reduce over each phase file's own
  // `Time spent:` line) — must agree. This is not provably ONE shared
  // source (2-analysis.md, "REQ-2's 'same computation source'..."), so it
  // proves parity on equivalent inputs rather than asserting one
  // implementation calls the other.
  test("agrees with the archived figure for the same underlying phase timings (REQ-2)", () => {
    const liveMs = computeSpecTotalDurationMs(rows());
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
