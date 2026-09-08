// The last place that knows anything about a phase: its own file.
//
// The queue forgets jobs — its memory is bounded — and the git-verified
// history only names a phase whose `Run /aide-<step>` commit landed. A
// phase both have lost still has its own `Result:` bullet, written by
// the run itself, and a row that ignored it drew a dash for a phase the
// spec says ran.

import { describe, expect, test } from "bun:test";
import { wordPhase } from "../../../../src/render/ui/job-state/word-phase.ts";

const noJob = undefined;

describe("what a phase's own file says, where nothing else knows", () => {
  test("a file saying completed reads done", () => {
    const w = wordPhase(false, undefined, noJob, { fileResult: "completed" });
    expect([w.badge?.variant, w.badge?.label]).toEqual(["done", "done"]);
  });

  // One word, like every other stop the system made: the reason the
  // file records after it is a sentence, and a sentence belongs on the
  // row's own notice line.
  test("a file saying stopped reads stopped", () => {
    const w = wordPhase(false, undefined, noJob, { fileResult: "stopped" });
    expect([w.badge?.variant, w.badge?.label]).toEqual(["waiting", "stopped"]);
  });

  test("a file with no Result at all still reads as nothing", () => {
    expect(wordPhase(false, undefined, noJob, {}).badge).toBeUndefined();
  });

  // It is the run's own claim about itself, not proof the work landed —
  // so it never speaks over a job the queue still has, or over the git
  // history that says the phase happened.
  test("a job the queue still has outranks the file", () => {
    const attempt = { state: "failed", stopReason: undefined } as never;
    const w = wordPhase(false, undefined, attempt, { fileResult: "completed" });
    expect(w.badge?.label).toBe("failed");
  });

  test("the git-verified history outranks it too", () => {
    const w = wordPhase(true, undefined, noJob, { fileResult: "stopped" });
    expect(w.badge?.label).toBe("done");
  });
});
