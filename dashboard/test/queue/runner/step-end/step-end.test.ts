// Every way the runner ends a step clears the same per-step fields: the
// process, the live session and the step's own start. The transcript and
// the result file stay named until the next start overwrites them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Job } from "../../../../src/queue/queue.ts";
import { cleanupHarness, enqueue, makeRunner, okResult, resetHarness, store } from "../runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

type Ending = {
  name: string;
  steps?: Job["steps"];
  /** Spend the step's retry before it ends, so the ending is not a retry. */
  lastAttempt?: boolean;
  alive?: boolean;
  result?: Record<string, unknown> | null;
  via?: "poll" | "reconcile";
  state: Job["state"];
};

const ENDINGS: Ending[] = [
  { name: "complete's retry", result: { ...okResult(0), ok: false, terminalReason: "no-progress" }, state: "queued" },
  { name: "run-stopped", lastAttempt: true, result: { ...okResult(0), ok: false, terminalReason: "timeout" }, state: "stopped" },
  { name: "step-failed", result: { ...okResult(0), ok: false, terminalReason: "cli-error" }, state: "failed" },
  { name: "step-succeeded-last", result: okResult(0), state: "done" },
  { name: "step-succeeded", steps: ["analyze", "implement"], result: okResult(0), state: "queued" },
  { name: "process-gone from poll", lastAttempt: true, alive: false, result: null, via: "poll", state: "interrupted" },
  { name: "process-gone from reconcile", lastAttempt: true, alive: false, result: null, via: "reconcile", state: "interrupted" },
  { name: "the vanished-run retry", alive: false, result: null, state: "queued" },
];

describe("a step's ending", () => {
  for (const ending of ENDINGS) {
    test(`${ending.name} clears the process, the session and the step's start, and keeps the transcript and the result file (AC-1, AC-5)`, () => {
      const job = enqueue({ steps: ending.steps ?? ["analyze"] });
      const runner = makeRunner({ alive: () => ending.alive ?? true, readResult: () => ending.result ?? null });
      runner.tick();
      const started = store.get(job.id)!;
      expect(started.state).toBe("running");
      expect([started.pid, started.pgid, started.sessionId, started.stepStartedAt].every((v) => v !== undefined)).toBe(true);
      if (ending.lastAttempt) store.update(job.id, { retry: { action: "analyze", attempts: 2 } });
      if (ending.via === "reconcile") runner.reconcile();
      else runner.poll();
      const ended = store.get(job.id)!;
      expect(ended.state).toBe(ending.state);
      expect({ pid: ended.pid, pgid: ended.pgid, sessionId: ended.sessionId, stepStartedAt: ended.stepStartedAt }).toEqual({
        pid: undefined, pgid: undefined, sessionId: undefined, stepStartedAt: undefined,
      });
      expect({ resultFile: ended.resultFile, streamFile: ended.streamFile }).toEqual({
        resultFile: started.resultFile, streamFile: started.streamFile,
      });
    });
  }
});
