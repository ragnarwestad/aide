// The stamp a phase's own file carries, which fills the gap no queue job
// can answer for.
//
// Split out of phase-duration.test.ts 2026-09-04; the tests are
// unchanged and keep their names.

// Split out of history-and-freshness.test.ts by theme.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// --- spec 284: a phase's own file stamp fills the gap no queue job can ----
//
// An interactively-created spec's `create` phase never goes through the
// queue, so the live pipeline above (built entirely from job records)
// has nothing for it — but `core/scripts/aide-create-spec --stamp-outcome`
// (spec 274) already wrote the duration into 1-description.md's own
// Tracking info, and `specPhaseOutcome` (spec 247) already knows how to
// read it; it was simply never wired into this page's live row. This
// block proves the fallback fires exactly where — and only where — no
// queue-job record exists for a phase, on both the per-phase line and
// the header's own total.
describe("a phase's own file stamp fills the gap no queue job can (spec 284)", () => {
  const NOW = "2026-08-16T12:00:00Z";
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-phase-fallback-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const withTracking = (...lines: string[]) =>
    ["# 284 - Description", "", "## Tracking info", "", ...lines, "", "## Description", ""].join("\n");

  // create is stamped with a real Time spent and — per 1-description.md's
  // own "structural and final" ruling — never a Cost line at all.
  const stampCreate = (timeSpent: string) =>
    writeFileSync(join(dir, "1-description.md"), withTracking(`- **Time spent:** ${timeSpent}`));

  const job = (id: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: "aa-spec",
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T08:00:00Z",
    ...extra,
  });

  const target = (extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder: "aa-spec",
    dir,
    ...extra,
  });

  const page = (rows: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(rows, { runnerAvailable: true, targets, filter: { open: "aide/aa-spec" } }, Date.parse(NOW));

  const phaseCell = (html: string, step: string, col: "started" | "cost"): string =>
    html
      .match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0]
      ?.match(new RegExp(`<td[^>]*data-col="${col}"[^>]*>(.*?)</td>`))?.[1] ?? "";

  const headCell = (html: string): string =>
    html
      .match(/<tr class="spechead[^"]*"[^>]*data-folder="aa-spec">.*?<\/tr>/)?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  test("REQ-1-AC1: create's stamped Time spent fills the phase line when no queue job ever ran it", () => {
    stampCreate("3m00s");
    const html = page(
      [
        job("a1", {
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:05:00Z" }],
        }),
      ],
      [target({ done: ["create", "analyze"] })],
    );
    expect(phaseCell(html, "create", "started")).toContain("3m00s");
  });

  test("REQ-2-AC1: the header total includes the fallback create duration alongside a job-measured phase", () => {
    stampCreate("3m00s");
    const html = page(
      [
        job("a1", {
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:05:00Z" }],
        }),
      ],
      [target({ done: ["create", "analyze"] })],
    );
    // 3 minutes of create (the file) plus 5 minutes of analyze (the job).
    expect(headCell(html)).toContain("8m00s");
  });

  test("REQ-2-AC2: a spec with zero queue jobs at all still totals its stamped create duration", () => {
    stampCreate("3m00s");
    expect(computeSpecTotalDurationMs([], Date.parse(NOW), dir)?.ms).toBe(3 * 60 * 1000);
  });

  test("REQ-2-AC2: the same spec's header row, drawn with no jobs at all, shows the fallback total too", () => {
    stampCreate("3m00s");
    const html = page([], [target({ done: ["create"] })]);
    expect(headCell(html)).toContain("3m00s");
  });

  test("REQ-3-AC1: the create phase's Cost cell shows the unknown mark, never blank and never $0.00", () => {
    stampCreate("3m00s");
    const html = page(
      [
        job("a1", {
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:05:00Z" }],
        }),
      ],
      [target({ done: ["create", "analyze"] })],
    );
    expect(phaseCell(html, "create", "cost")).toContain("–");
    expect(phaseCell(html, "create", "cost")).not.toContain("$0.00");
  });

  test("REQ-3-AC2: a phase that has genuinely never run reads 0s, distinct from create's stamped figure", () => {
    stampCreate("3m00s");
    const html = page(
      [
        job("a1", {
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:05:00Z" }],
        }),
      ],
      [target({ done: ["create", "analyze"] })],
    );
    expect(phaseCell(html, "archive", "started")).toContain("0s");
    // Cost is the one that stays blank: nothing was spent, and unlike
    // time, "nothing spent" and "no figure" are the same answer there.
    expect(phaseCell(html, "archive", "cost")).toBe("");
  });

  test("a phase WITH a queue-job attempt is unaffected by a stamped file for the same step (no double count)", () => {
    // create itself ran as a queue job this time — the file fallback
    // must not also apply, or its duration would be counted twice.
    stampCreate("3m00s");
    const html = page(
      [
        job("a1", {
          steps: ["create"],
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "create", ok: true, costUsd: 0.5, at: "2026-08-16T09:10:00Z" }],
        }),
      ],
      [target({ done: ["create"] })],
    );
    expect(phaseCell(html, "create", "started")).toContain("10m00s");
    expect(phaseCell(html, "create", "started")).not.toContain("3m00s");
    expect(headCell(html)).toContain("10m00s");
  });
});
