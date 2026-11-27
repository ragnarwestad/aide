// A phase's own file remembers how many times it ran, past
// both the two-hundred-deep queue's bounded memory and archiving.
//
// The queue's own `p.attempts.length` and the file's stamped
// `p.attemptCount` are never simply one-or-the-other the way
// `timeSpentMs`/`cost`/`tokens` are: `attemptCountOf` takes the LARGER
// of the two, since a running attempt not yet stamped into the file can
// make the queue's own count the bigger of the two even while the file
// also has something to say.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phasesFor, renderSpecsRows, type ArchivedSpecView, type QueueRowView } from "../../../../../src/render";
import { attemptCountOf } from "../../../../../src/render/pages/specs-list/phase-rows.ts";
import { showsAttemptCount } from "../../../../../src/render/pages/specs-list/cell-helpers.ts";
import type { Phase } from "../../../../../src/render/pages/specs-list/data-model";

const subRow = (html: string, step: string): string =>
  html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0] ?? "";

const job = (id: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
  id,
  project: "aide",
  specFolder: "aa-spec",
  steps: ["analyze"],
  stepIndex: 0,
  state: "done",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-09-02T08:00:00Z",
  ...extra,
});

/** One attempt at `step` that ended with `terminalReason`. */
const ended = (id: string, step: string, terminalReason?: string): QueueRowView =>
  job(id, { steps: [step], results: [{ step, ok: true, costUsd: 1, at: "2026-09-02T09:05:00Z", terminalReason }] });

const phase = (step: string, attempts: QueueRowView[], attemptCount?: number): Phase =>
  ({ step, attempts, history: {}, attemptCount });

describe("which attempt counts a phase's state cell shows", () => {
  test("a phase run once, or not at all, shows no count", () => {
    expect([0, 1].map(showsAttemptCount)).toEqual([false, false]);
  });

  test("a phase run more than once shows its count", () => {
    expect([2, 5].map(showsAttemptCount)).toEqual([true, true]);
  });
});

describe("attemptCountOf", () => {
  test("a phase nothing ran and no file stamped counts nothing", () => {
    expect(attemptCountOf(phase("analyze", []))).toBe(0);
  });

  test("with no stamp, the queue's attempts are the count", () => {
    expect(attemptCountOf(phase("analyze", [ended("a1", "analyze"), ended("a2", "analyze")]))).toBe(2);
  });

  test("the file's stamp wins once the queue has forgotten the earliest attempts", () => {
    expect(attemptCountOf(phase("analyze", [ended("a1", "analyze"), ended("a2", "analyze")], 3))).toBe(3);
  });

  test("the queue's own count wins while an attempt is still in flight, not yet stamped", () => {
    const running = job("a3", { state: "running", startedAt: "2026-09-02T11:00:00Z" });
    expect(attemptCountOf(phase("analyze", [running, ended("a2", "analyze"), ended("a1", "analyze")], 2))).toBe(3);
  });

  // A run the archive gates turned away is a guard, not an attempt.
  test("archive runs the gates refused are not counted as attempts", () => {
    const attempts = [
      ended("a3", "archive", "completed"),
      ended("a2", "archive", "acceptance-criteria-unticked"),
      ended("a1", "archive", "not-implemented-yet"),
    ];
    expect(attemptCountOf(phase("archive", attempts))).toBe(1);
  });
});

describe("a live phase reads its stamp from its own file, whatever the queue holds", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-attempt-count-"));
    writeFileSync(
      join(dir, "2-analysis.md"),
      ["# 341 - Analysis", "", "## Tracking info", "", "- **Attempts:** 3", "", "## Findings", ""].join("\n"),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the queue's two attempts leave the file's 3 on the phase", () => {
    const phases = phasesFor(
      [ended("a1", "analyze"), ended("a2", "analyze")],
      { project: "aide", specFolder: "aa-spec", dir },
    );
    expect(phases.find((p) => p.step === "analyze")?.attemptCount).toBe(3);
  });
});

describe("the phase line draws the count", () => {
  test("an archived phase with a stamped Attempts count of 3 and no queue jobs at all shows 3 attempts", () => {
    const archived: ArchivedSpecView = {
      project: "aide",
      folder: "aa-spec",
      done: ["create", "analyze", "implement", "archive"],
      models: {},
      phaseOutcomes: { analyze: { attempts: 3 } },
    };
    const html = renderSpecsRows([], {
      runnerAvailable: true,
      targets: [],
      archivedSpecs: [archived],
      filter: { open: "aide/aa-spec" },
    });
    expect(subRow(html, "analyze")).toContain("3 attempts");
  });
});
