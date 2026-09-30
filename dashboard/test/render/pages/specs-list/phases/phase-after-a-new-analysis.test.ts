// What a spec's phase lines say once a new analysis has completed on a
// spec that had implemented. The record (the state file and git) says
// implement has not run; the queue's memory of the earlier implement job
// and the phase's own stamped file outlive that, and the row must not
// read them as a phase that ran.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QueueRowView, SpecTarget } from "../../../../../src/render";
import { groupBySpec, phasesFor } from "../../../../../src/render/pages/specs-list/data-model";
import { actionState, nextPhase } from "../../../../../src/render/pages/specs-list/row-state.ts";
import { wordPhase } from "../../../../../src/render/ui/job-state";
import { row } from "../../fixtures.ts";

const ANALYZED_AT = "2026-09-20T12:00:00Z";
const EARLIER = "2026-09-10T12:00:00Z";
const LATER = "2026-09-25T12:00:00Z";

const finished = (id: string, step: string, at: string): QueueRowView =>
  row({
    id,
    steps: [step],
    stepIndex: 0,
    state: "done",
    createdAt: at,
    startedAt: at,
    results: [{ step, ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", at }],
  });

const analysis = finished("analysis", "analyze", ANALYZED_AT);
const earlierImplement = finished("earlier", "implement", EARLIER);

const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({
  project: "aide",
  specFolder: "81-queue-and-runner",
  done: ["create", "analyze"],
  historyDone: ["create", "analyze"],
  superseded: ["implement"],
  ...extra,
});

const implementLine = (jobs: QueueRowView[], t: SpecTarget) => phasesFor(jobs, t).find((p) => p.step === "implement")!;

const wordOf = (jobs: QueueRowView[], t: SpecTarget) => {
  const p = implementLine(jobs, t);
  return wordPhase((t.done ?? []).includes(p.step), p.heldBack, p.attempts[0], {
    ...p.history,
    fileResult: p.fileResult,
    step: p.step,
  });
};

describe("a phase line after a new analysis", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const specDirWithImplementRecord = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "aide-after-analysis-"));
    dirs.push(dir);
    writeFileSync(join(dir, "3-solution.md"), "# Solution\n\n## Tracking info\n\n- **Result:** completed\n");
    return dir;
  };

  test("an implement job the queue remembers from before the analysis is not an attempt (AC-1)", () => {
    const line = implementLine([analysis, earlierImplement], target());
    expect(line.attempts).toEqual([]);
    expect(line.fileResult).toBeUndefined();
    expect(wordOf([analysis, earlierImplement], target()).badge).toBeUndefined();
  });

  test("an implement the stamped file remembers, with no job, is not a result either (AC-1)", () => {
    const t = target({ dir: specDirWithImplementRecord() });
    expect(implementLine([analysis], t).fileResult).toBeUndefined();
    expect(wordOf([analysis], t).badge).toBeUndefined();
  });

  test("Implement is what the row offers next (AC-1)", () => {
    const t = target();
    const [g] = groupBySpec([analysis, earlierImplement], [t]);
    expect(nextPhase(t.done!)).toBe("implement");
    expect(actionState(g!, {})?.label).toBe("Implement");
  });

  test("an attempt in flight keeps every attempt (AC-1)", () => {
    const running = row({ id: "running", steps: ["implement"], stepIndex: 0, state: "running", createdAt: LATER });
    const line = implementLine([analysis, earlierImplement, running], target());
    expect(line.attempts.map((a) => a.id)).toEqual(["running", "earlier"]);
  });

  test("an attempt that ended after the analysis keeps every attempt (AC-1)", () => {
    const newer = finished("newer", "implement", LATER);
    const line = implementLine([analysis, earlierImplement, newer], target());
    expect(line.attempts.map((a) => a.id)).toEqual(["newer", "earlier"]);
  });

  test("with implement done, the phase is untouched (AC-1)", () => {
    const t = target({ done: ["create", "analyze", "implement"], historyDone: ["create", "analyze", "implement"] });
    expect(implementLine([analysis, earlierImplement], t).attempts.map((a) => a.id)).toEqual(["earlier"]);
  });

  test("with no analysis named as superseding it, the phase is untouched (AC-4)", () => {
    const t = target({ superseded: undefined });
    expect(implementLine([analysis, earlierImplement], t).attempts.map((a) => a.id)).toEqual(["earlier"]);
  });
});
