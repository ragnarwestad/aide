// Which step the job page opens, what a phase's own page shows, and how
// a stopped run's reason reaches the reader.
//
// Split out of job-page.test.ts 2026-09-04; the tests are unchanged and
// keep their names.

import { describe, expect, test } from "bun:test";
import { landingRefusal, resolveOpenStep } from "../../../src/render/pages/job-page";

// Criteria 1, 2, 4, 5: what the job IS, everything it has already run,
// and what it is doing right now.

// --- spec 240: which Steps row is open survives the page's own reload -------
//
// Approach A (a bare `<details>` per row) was rejected in `3-solution.md`
// for the exact reason `specs-list.ts` already rejected it for its own
// row-fold: both pages reload themselves every 10 seconds, a full
// navigation rather than a DOM patch, so a `<details open>` set by a
// click is gone on the very next reload. The open row has to be a property of the URL instead.
// The raw words behind a landing failure are kept on the job beside the
// sentence (2026-09-20): `errorDetail` belongs to what the row waits for
// now, and a job that has moved on has already overwritten it.
describe("a landing refusal's detail", () => {
  test("prefers the landing's own kept detail over the job's current one", () => {
    const refusal = landingRefusal(
      {
        landingError: { key: "landing.stepFailed", values: { step: "create" }, inner: { key: "landing.createAssignNumberFailed" } },
        landingErrorDetail: "aide-create-spec: the specs root moved under the worktree",
        errorDetail: "something else entirely",
      },
      "en",
    );
    expect(refusal?.step).toBe("create");
    expect(refusal?.detail).toContain("the specs root moved under the worktree");
    expect(refusal?.detail).not.toContain("something else entirely");
  });
});

describe("spec 240: resolveOpenStep", () => {
  test("no query and nothing running: nothing is open (AC2)", () => {
    expect(resolveOpenStep(undefined, undefined)).toBeUndefined();
  });

  test("no query but something running: the running row opens by default (AC3)", () => {
    expect(resolveOpenStep(undefined, 2)).toBe("2");
  });

  test("an explicit step index wins over the running default", () => {
    expect(resolveOpenStep("0", 2)).toBe("0");
  });

  test("the literal close value wins even while something is running (AC4)", () => {
    expect(resolveOpenStep("none", 2)).toBeUndefined();
  });

  test("the running step's index, `live` and no step open it while it runs, and its finished row after (AC-3)", () => {
    for (const query of [undefined, "live", "2"]) expect(resolveOpenStep(query, 2), String(query)).toBe("2");
    expect(resolveOpenStep("2", undefined)).toBe("2");
    expect(resolveOpenStep("none", undefined)).toBeUndefined();
  });
});
