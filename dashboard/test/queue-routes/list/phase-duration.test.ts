// Split out of history-and-freshness.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderSpecsRows,
  type ArchivedSpecView,
  type QueueRowView,
  type SpecTarget,
} from "../../../src/render";
import { row as queueRow } from "../../design/row-fixtures.ts";

// --- Time becomes something worth reading -------------------------
//
// A phase says how long it TOOK. Nothing stores a per-step duration —
// a job has one `startedAt` however many steps it ran — so a step's
// own span is sliced out of the boundaries that do exist: the previous
// step's end, or the job's own start for the first one. Getting that
// wrong by reaching for the job's whole span instead is the one
// mistake this block exists to catch.
describe("a phase says how long it took", () => {
  const NOW = "2026-08-16T12:00:00Z";

  const job = (id: string, spec: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    queueRow({ id, specFolder: spec, state: "done", createdAt: "2026-08-16T08:00:00Z", ...extra });

  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // `renderSpecsRows`, not `renderSpecsPage`: the page reads the clock
  // itself and takes no `now`, and every figure in this block is
  // measured against one.
  const page = (rows: QueueRowView[], targets: SpecTarget[] = [], spec = "aa-spec") =>
    renderSpecsRows(
      rows,
      { runnerAvailable: true, targets, filter: { open: `aide/${spec}` } },
      Date.parse(NOW),
    );

  /** One phase line's Started cell — which holds that
   *  phase's own duration, not when it began. */
  const phaseCell = (html: string, step: string): string =>
    html
      .match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  /** The spec header row's own Started cell. */
  /** The header's own Time cell, on the second of its two rows since
   *  2026-09-22: the title has the first to itself. */
  const headCell = (html: string, folder: string): string =>
    html
      .match(new RegExp(`<tr class="specstate"[^>]*data-folder="${folder}">.*?</tr>`))?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  // A running phase carries the instant it began, so the browser can
  // count up from it without waiting for the server to redraw
  // The server still writes a readable figure into the
  // cell, so the page says something with script switched off.
  test("a running phase carries its start for the page's own clock", () => {
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
    expect(cell).toContain("30m 00s");
  });

  // A running phase's own elapsed-so-far now counts toward the
  // header total, and the cell carries
  // `data-elapsed` so the browser's existing per-second tick
  // (`specs-client.ts`) keeps counting it up with no further redraw.
  test("a spec with a phase in flight sums what has settled plus the live phase's elapsed time, and ticks", () => {
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
    expect(headCell(html, "aa-spec")).toContain("3h 00m");
    // The synthetic since = implement's start (09:10) minus the settled
    // 10 minutes = 09:00 — so `now - since` reproduces the same total.
    expect(headCell(html, "aa-spec")).toContain('data-elapsed="2026-08-16T09:00:00.000Z"');
  });
});

// --- An archived row reads the queue's own memory too -----------
//
// `readerGroup()` used to sum only each phase file's own `Time spent:`
// stamp — the AI session's own duration, never the worktree, the commit
// or the push around it. Where the queue still remembers the job (a
// recently archived spec, or a small project under its 200-job cap),
// this reads the SAME queue-preferred figure `jobGroup()`/`emptyGroup()`
// already draw, through the one shared `totalDuration()`.
describe("an archived row reads a still-remembered queue job the same way a live row does", () => {
  const NOW = Date.parse("2026-08-16T12:00:00Z");
  const KEY = "aide/aa-spec";

  const job = (id: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    queueRow({ id, specFolder: "aa-spec", state: "done", createdAt: "2026-08-16T08:00:00Z", ...extra });

  const archived = (extra: Partial<ArchivedSpecView> = {}): ArchivedSpecView => ({
    project: "aide",
    folder: "aa-spec",
    done: ["create", "analyze", "implement"],
    models: {},
    phaseOutcomes: { implement: { timeSpentMs: 1000 } },
    ...extra,
  });

  const headCell = (html: string): string =>
    html
      .match(/<tr class="specstate"[^>]*data-folder="aa-spec">.*?<\/tr>/)?.[0]
      ?.match(/<td[^>]*data-col="started"[^>]*>(.*?)<\/td>/)?.[1] ?? "";

  test("a queue-measured phase wins over that phase's own file stamp, even on a locked row", () => {
    const rows = [
      job("a1", {
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:00:04Z" }],
      }),
    ];
    const html = renderSpecsRows(
      rows,
      {
        runnerAvailable: true,
        targets: [],
        archived: [KEY],
        archivedSpecs: [archived()],
        filter: { state: "archived" },
      },
      NOW,
    );
    // analyze: 4s off the queue's own job; implement: 1s off the file
    // stamp, the queue having forgotten it — 5s together.
    expect(headCell(html)).toContain("5s");
  });
});
