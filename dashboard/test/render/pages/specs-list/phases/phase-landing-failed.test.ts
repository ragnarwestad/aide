// A step whose own process finished but whose landing did not — a merge
// conflict, or a suite the landing refused — is that step's failure on
// its own line, not "done" over a job that says "failed" (2026-09-11).
// The pip beside it then takes the same colour.
import { describe, expect, test } from "bun:test";
import { attemptsPerStep } from "../../../../../src/render/pages/specs-list/data-model/phases.ts";
import { wordPhase } from "../../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../../src/render";

const ok = (step: string) => ({ step, ok: true, costUsd: 0, at: "2026-09-11T10:00:00Z" });

function job(state: QueueRowView["state"], errorReason?: QueueRowView["errorReason"]): QueueRowView {
  return {
    id: "j1",
    project: "aide-test",
    specFolder: "02-add-a-second-fact",
    steps: ["analyze", "implement", "archive"],
    stepIndex: 2,
    state,
    errorReason,
    error: errorReason ? { key: "landing.mergeConflict", values: {} } : undefined,
    createdAt: "2026-09-11T09:00:00Z",
    spentUsd: 0,
    results: [ok("analyze"), ok("implement"), ok("archive")],
  } as unknown as QueueRowView;
}

describe("a landing that fell is the landed step's own failure", () => {
  test("a conflict: the archive line reads failed, red on badge and pip; the steps before it stay done", () => {
    const per = attemptsPerStep([job("failed", "conflict")]);
    expect(per.archive![0]!.state).toBe("failed");
    expect(per.implement![0]!.state).toBe("done");
    const archive = wordPhase(false, undefined, per.archive![0], {});
    expect([archive.pip, archive.badge?.variant, archive.badge?.label]).toEqual(["refused", "refused", "Failed"]);
    const implement = wordPhase(true, undefined, per.implement![0], {});
    expect([implement.pip, implement.badge?.variant]).toEqual(["past", "done"]);
  });

  test("red tests: the archive line reads stopped, amber on both — the job's own choice, not a failure", () => {
    const per = attemptsPerStep([job("stopped", "tests-red")]);
    expect(per.archive![0]!.state).toBe("stopped");
    const archive = wordPhase(false, undefined, per.archive![0], {});
    expect([archive.pip, archive.badge?.variant]).toEqual(["waiting", "waiting"]);
  });

  test("a job that landed reads done on every line", () => {
    const per = attemptsPerStep([job("done")]);
    expect(per.archive![0]!.state).toBe("done");
    expect(per.archive![0]!.error).toBeUndefined();
  });
});

// The runner started the step again in the same job: the first try stopped
// on the provider's usage limit, the second completed.
describe("a step run twice in one job", () => {
  const twice = {
    ...job("done"),
    spentUsd: 3,
    results: [
      ok("analyze"),
      { step: "implement", ok: false, costUsd: 1, tokens: 10, terminalReason: "provider-limit" },
      { step: "implement", ok: true, costUsd: 2, tokens: 20, terminalReason: "completed" },
    ],
  } as unknown as QueueRowView;

  test("reads done from its newest try, with both tries' cost and tokens", () => {
    const implement = attemptsPerStep([twice]).implement![0]!;
    expect(implement.state).toBe("done");
    expect([implement.spentUsd, implement.spentTokens]).toEqual([3, 30]);
  });
});
