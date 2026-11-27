import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeSpecTotalDurationMs, phaseDuration } from "../../../../../src/render/pages/specs-list/data-model/phases.ts";
import type { QueueRowView } from "../../../../../src/render";
import { row as queueRow } from "../../../../design/row-fixtures.ts";
import { tempDirs } from "../../../../helpers/setup/temp-dirs.ts";

// The summing the spec list has always done, lifted out of
// the render so the archive-time write calls the SAME function. The
// figure stored in `4-status.md` and the figure the list drew cannot
// drift apart if there is only one of them.
//
// The function has no completion guards and no `done`
// parameter: the list shows this sum on a LIVE row too,
// not only once the whole workflow is behind it, so it can no longer
// refuse to answer while the spec is still working.
//
// Called directly rather than through a page: what is under test is the
// math, and a route test proves nothing about it that this doesn't.
describe("computeSpecTotalDurationMs", () => {
  const row = (id: string, extra: Partial<QueueRowView>): QueueRowView =>
    queueRow({ id, specFolder: "aa-spec", state: "done", createdAt: "2026-08-13T08:00:00Z", ...extra });

  /** Three jobs: five
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

  // A reopen, a close or an explore is a step, not a phase: its span is
  // not part of the spec's total.
  test("a finished reopen's span is not in the total", () => {
    const withReopen = [
      row("r1", {
        steps: ["reopen"],
        startedAt: "2026-08-12T09:00:00Z",
        results: [{ step: "reopen", ok: true, costUsd: 0, at: "2026-08-12T09:30:00Z" }],
      }),
      ...rows(),
    ];
    expect(computeSpecTotalDurationMs(withReopen, NOW)?.ms).toBe(20 * 60 * 1000);
  });

  // The exact case 1-description.md names as the motivation: a spec
  // stopped by an error still owes a total — analyze finished, nothing
  // else has run yet — and the old `done`-keyed guard blanked exactly
  // this row.
  test("a spec still missing a phase sums what it has", () => {
    expect(computeSpecTotalDurationMs([rows()[0]!], NOW)?.ms).toBe(5 * 60 * 1000);
  });

  // A phase in flight elsewhere now CONTRIBUTES its own elapsed
  // time to the total (reversing the old exclusion), and the result
  // carries the synthetic `since` the header cell needs to tick from.
  // The live job here is on `create`, a phase neither of `rows()`'s jobs
  // has touched, so its elapsed time adds on top of both settled phases.
  test("a job in flight elsewhere adds its own elapsed time to the settled total, and marks it live", () => {
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

  // `computeSpecTotalDurationMs` is built on `phaseDuration`, so a
  // step still landing must inherit the live count automatically — the
  // spec's TOTAL, not only the one phase cell, keeps counting through
  // the merge.
  test("a step still landing counts live in the spec's total, not frozen at 0", () => {
    const withLanding = [
      row("a1", {
        steps: ["archive"],
        state: "done",
        landing: true,
        startedAt: "2026-08-20T09:00:00Z",
        results: [{ step: "archive", ok: true, costUsd: 1 }],
      }),
    ];
    const now = Date.parse("2026-08-20T09:05:00Z");
    const total = computeSpecTotalDurationMs(withLanding, now);
    expect(total?.live).toBe(true);
    expect(total?.ms).toBe(5 * 60 * 1000);
  });

  test("a spec nothing has ever run for measures nothing", () => {
    expect(computeSpecTotalDurationMs([], NOW)).toBeUndefined();
  });

  // A phase re-run as two separate settled job attempts (an
  // earlier failed/retried run, then a later one) contributes BOTH —
  // the bug 1-description.md names: "a phase re-run three times
  // contributes once" (now: contributes every time).
  test("a phase retried as a second settled job attempt contributes both durations", () => {
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
});

// A step's own recorded start, not the boundary before it --------
//
// The finished-step branch now prefers `StepResult.startedAt` — set once
// the runner actually spawned that step — over the previous step's own
// end. The in-flight branch stops treating a job merely `queued` for its
// next step as though that step were already running: held back for a
// dependency, an open acceptance row, a landing, or a full concurrency
// slot, it owes no duration until it is actually spawned.
//
// Every existing test above sets neither `startedAt` nor
// `stepStartedAt` on its fixtures, which is exactly the
// regression guard: none of them are touched here.
describe("phaseDuration prefers a step's own recorded start", () => {
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

  test("a finished step's own recorded start wins over the previous step's end", () => {
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

  // A step whose own work is still landing has no `at`
  // recorded yet — `phaseDuration` must count live from the step's own
  // start rather than returning null (no end) or a stale settled figure.
  test("a landing step counts live from its own start, with no at recorded yet", () => {
    const r = row({
      landing: true,
      startedAt: "2026-08-16T09:00:00Z",
      results: [
        { step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:10:00Z" },
        { step: "implement", ok: true, costUsd: 2, startedAt: "2026-08-16T10:30:00Z" },
      ],
    });
    const d = phaseDuration(r, "implement", Date.parse("2026-08-16T12:00:00Z"));
    expect(d?.live).toBe(true);
    expect(d?.ms).toBe(90 * 60 * 1000);
    expect(d?.since).toBe("2026-08-16T10:30:00Z");
  });

  // The literal "listed at over ten hours... nine and a half held back"
  // case 1-description.md opens with.
  test("a queued job between two steps shows no live duration, however long the previous step's own end sits in the past", () => {
    const r = row({
      state: "queued",
      startedAt: "2026-08-16T09:00:00Z",
      results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:10:00Z" }],
    });
    const d = phaseDuration(r, "implement", Date.parse("2026-08-16T20:00:00Z"));
    expect(d).toBeNull();
  });
});

// A phase no queue job ran still counts with the Time spent its own file
// was stamped with.
describe("a phase's own file stamp fills the gap no queue job can", () => {
  const dirs = tempDirs("aide-phase-fallback-");

  test("a spec with zero queue jobs at all still totals its stamped create duration", () => {
    const dir = dirs.make();
    writeFileSync(join(dir, "1-description.md"), "# Description\n\n## Tracking info\n\n- **Time spent:** 3m00s\n");
    expect(computeSpecTotalDurationMs([], Date.parse("2026-08-16T12:00:00Z"), dir)?.ms).toBe(3 * 60 * 1000);
  });
});
