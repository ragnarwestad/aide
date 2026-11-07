// The endings the board words from the result's own fields, read from
// core/tests/fixtures/board-worded-endings.json: the runner's tests check that
// its list answers each case, and this checks that the board words exactly the
// cases marked so, from a result that carries no sentence of its own.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "../runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

type Case = { name: string; step: string; result: Record<string, unknown>; boardWords: boolean };
const CASES = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../../../core/tests/fixtures/board-worded-endings.json"), "utf-8"),
).cases as Case[];

describe("a result with no sentence of the runner's own", () => {
  for (const c of CASES) {
    test(`${c.name}: ${c.boardWords ? "the board words it" : "the board has no sentence for it"} (AC-2)`, () => {
      const job = enqueue({ steps: [c.step] });
      const runner = makeRunner({ readResult: () => ({ ...okResult(0.1), ok: false, ...c.result }) });
      runner.tick();
      runner.poll();
      const error = store.get(job.id)?.error;
      const worded = typeof error === "object" && error !== null;
      expect(worded).toBe(c.boardWords);
    });
  }
});
