import { describe, expect, test } from "bun:test";
import { phasesFor } from "../../../../src/render";
import { phasePipKind } from "../../../../src/render/pages/specs-list/cell-helpers.ts";
import type { MessageKey } from "../../../../src/i18n/messages.ts";
import type { QueueRowView } from "../../../../src/render";
import { row } from "../fixtures.ts";

/** The pip kind of one phase of a spec whose jobs are `jobs`. */
const pipOf = (jobs: QueueRowView[], step: string, done: string[]) => {
  const phase = phasesFor(jobs, undefined).find((p) => p.step === step)!;
  return phasePipKind(phase, done);
};

const held = (step: string, key: MessageKey, extra: Partial<QueueRowView> = {}): QueueRowView =>
  row({
    id: `held-${step}`,
    specFolder: "05-spec",
    steps: [step],
    stepIndex: 0,
    state: "queued",
    errorReason: "held-back",
    error: { key, values: { folder: "04-other" } },
    createdAt: "2026-10-12T09:00:00Z",
    ...extra,
  });

describe("the pip of a phase on the Running tab", () => {
  test("a phase held back on a dependency draws the plain pip, not the moving one (AC-1)", () => {
    const jobs = [held("analyze", "runner.dependencyNotArchived")];
    expect(pipOf(jobs, "analyze", ["create"])).toBe("todo");
  });

  test("a phase held back for a person to act draws the plain pip, not amber (AC-1)", () => {
    const jobs = [held("implement", "runner.notAnalyzed")];
    expect(pipOf(jobs, "implement", ["create"])).toBe("todo");
  });

  test("a held phase does not take the amber of an older cancelled attempt (AC-1)", () => {
    const cancelled = row({
      id: "older",
      specFolder: "05-spec",
      steps: ["analyze"],
      stepIndex: 0,
      state: "cancelled",
      createdAt: "2026-10-11T09:00:00Z",
    });
    const jobs = [cancelled, held("analyze", "runner.dependencyNotArchived")];
    expect(pipOf(jobs, "analyze", ["create"])).toBe("todo");
  });

  test("an archive held back because another archive runs draws the plain pip (AC-1)", () => {
    const jobs = [held("archive", "runner.archiveRunning")];
    expect(pipOf(jobs, "archive", ["create", "analyze", "implement"])).toBe("todo");
  });

  test("a phase whose job is running draws the running pip (AC-2)", () => {
    const jobs = [row({ id: "live", specFolder: "05-spec", steps: ["analyze"], stepIndex: 0, state: "running" })];
    expect(pipOf(jobs, "analyze", ["create"])).toBe("now");
  });

  test("a running job is not hidden by a newer held-back job of the same phase (AC-2)", () => {
    const running = row({
      id: "live",
      specFolder: "05-spec",
      steps: ["analyze"],
      stepIndex: 0,
      state: "running",
      createdAt: "2026-10-12T08:00:00Z",
      startedAt: "2026-10-12T08:00:00Z",
    });
    const jobs = [running, held("analyze", "runner.dependencyNotArchived")];
    expect(pipOf(jobs, "analyze", ["create"])).toBe("now");
  });

  test("a phase whose branch is being merged draws the running pip (AC-2)", () => {
    const jobs = [
      row({
        id: "merging",
        specFolder: "05-spec",
        steps: ["analyze"],
        stepIndex: 0,
        state: "running",
        landing: true,
        results: [{ step: "analyze", ok: true, costUsd: 0, terminalReason: "completed" }],
      }),
    ];
    expect(pipOf(jobs, "analyze", ["create"])).toBe("now");
  });
});
