// The pip on a phase line takes the colour of the badge beside it
// (2026-09-11): a phase held back or stopped is amber on both, a failed
// one red on both, a finished one green on both — the row never says a
// phase's state in two colours.
import { describe, expect, test } from "bun:test";
import { CSS } from "../../../../src/render/ui/css.ts";
import { wordPhase } from "../../../../src/render/ui/job-state/word-phase.ts";

const noJob = undefined;

describe("the pip follows the badge", () => {
  test("held back: amber pip beside the amber badge", () => {
    const w = wordPhase(false, { reason: "depends on 1-x, which is not archived yet" }, noJob, {});
    expect([w.pip, w.badge?.variant]).toEqual(["waiting", "waiting"]);
  });

  test("stopped, from the file: amber on both", () => {
    const w = wordPhase(false, undefined, noJob, { fileResult: "stopped" });
    expect([w.pip, w.badge?.variant]).toEqual(["waiting", "waiting"]);
  });

  test("failed: red on both", () => {
    const attempt = { state: "failed", stopReason: undefined } as never;
    const w = wordPhase(false, undefined, attempt, {});
    expect([w.pip, w.badge?.variant]).toEqual(["refused", "refused"]);
  });

  test("done: green on both, and nothing attempted stays grey with no badge", () => {
    const done = wordPhase(true, undefined, noJob, {});
    expect([done.pip, done.badge?.variant]).toEqual(["past", "done"]);
    const nothing = wordPhase(false, undefined, noJob, {});
    expect([nothing.pip, nothing.badge]).toEqual(["todo", undefined]);
  });

  test("the stylesheet paints the two new pip kinds in the badge's own tokens, and done in ready's green", () => {
    expect(CSS).toContain(".pip.waiting { background: var(--warn); }");
    expect(CSS).toContain(".pip.refused { background: var(--danger); }");
    expect(CSS).toMatch(/\.b-waiting \{ background: var\(--warn-soft\); color: var\(--warn\); \}/);
    expect(CSS).toMatch(/\.b-done \{ background: var\(--ok-soft\); color: var\(--ok\); \}/);
    expect(CSS).toContain(".pip.past { background: var(--ok); }");
  });
});
