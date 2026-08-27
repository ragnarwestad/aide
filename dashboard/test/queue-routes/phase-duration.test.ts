// Split out of history-and-freshness.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  computeSpecTotalDurationMs,
  renderQueueRows,
  type QueueRowView,
  type QueueTarget,
} from "../../src/render.ts";

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
  // the spec took twenty minutes (criteria 5 and 6). The TOTAL left the
  // header cell on 2026-08-24 — beside "3 d ago" it read as noise — so
  // the sum now lives only on the phase lines and in what archive
  // writes into 4-status.md; the header carries the date alone.
  test("a finished spec's phases carry their durations; the header only its date", () => {
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
    // 5 + 10 + 5 minutes of work, on the lines that did it; the header
    // cell says when the spec was made and nothing else.
    expect(headCell(html, "aa-spec")).not.toContain("data-total");
    expect(headCell(html, "aa-spec")).toContain("3 d ago");
    expect(phaseCell(html, "analyze")).toContain("5m00s");
    expect(phaseCell(html, "implement")).toContain("10m00s");
    expect(phaseCell(html, "archive")).toContain("5m00s");
  });

  // The header row's own cell is the spec's date, and it does not move
  // because a phase ran.
  test("the header row shows the spec's creation date, whatever its jobs did", () => {
    const html = page(
      [job("a1", "aa-spec", { startedAt: "2026-08-16T11:59:00Z" })],
      [target("aa-spec", { createdAt: "2026-06-01T09:00:00Z" })],
    );
    expect(headCell(html, "aa-spec")).toContain('title="2026-06-01T09:00:00Z"');
  });

  test("a spec git could not date shows a dash rather than a job's time", () => {
    const html = page(
      [job("a1", "aa-spec", { startedAt: "2026-08-16T11:59:00Z" })],
      [target("aa-spec")],
    );
    expect(headCell(html, "aa-spec")).toContain("–");
    expect(headCell(html, "aa-spec")).not.toContain("2026-08-16T11:59:00Z");
  });
});

// Spec 207: the summing the spec list has always done, lifted out of
// the render so the archive-time write calls the SAME function. The
// figure stored in `4-status.md` and the figure the list drew cannot
// drift apart if there is only one of them.
//
// Called directly rather than through a page: what is under test is the
// math and where `done` comes from, and a route test proves neither on
// its own.
describe("computeSpecTotalDurationMs (spec 207)", () => {
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

  const ALL_DONE = ["create", "analyze", "implement", "archive"];

  test("adds the phases up, and answers in milliseconds", () => {
    expect(computeSpecTotalDurationMs(rows(), ALL_DONE)).toBe(20 * 60 * 1000);
  });

  // The whole reason `done` is a PARAMETER. These rows' own results say
  // analyze finished — and `withFreshness` takes analyze back out of
  // `done` when the description was committed after the last analyze
  // ran, which is exactly when the live list shows no total at all. A
  // function that re-derived `done` from the results would store a
  // figure the list itself would not have shown.
  test("`done` is the caller's, never re-derived from the job results", () => {
    expect(computeSpecTotalDurationMs(rows(), ["create", "implement", "archive"])).toBeUndefined();
  });

  test("a phase still ahead of the spec is no total yet", () => {
    expect(computeSpecTotalDurationMs(rows(), ["create", "analyze"])).toBeUndefined();
  });

  test("a spec nothing has ever run for measures nothing", () => {
    expect(computeSpecTotalDurationMs([], ALL_DONE)).toBeUndefined();
  });

  // The list stopped drawing this figure on 2026-08-24 — beside
  // "3 d ago" it read as noise — so the function's remaining reader is
  // the archive step, which writes the same sum into 4-status.md
  // (spec 207). The list not smuggling it back in is worth a line.
  test("the spec list no longer draws the figure", () => {
    const html = renderQueueRows(
      rows(),
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "aa-spec", createdAt: "2026-08-13T08:00:00Z", done: ALL_DONE }],
        filter: { open: "aide/aa-spec" },
      },
      Date.parse("2026-08-16T12:00:00Z"),
    );
    expect(html).not.toContain('data-total="1"');
  });
});
