// Spec 372, REQ-1/REQ-3: the held-back branch in specNotice() reads the
// job's own errorReason field, never a text-prefix guess on lead.error
// — the f3cd5b7 patch this spec replaces taught the panel to recognise
// ONE producer's "held back:" prefix, which left every other waiting-
// shaped message still guessing "warn" or "err" for itself.
import { describe, expect, test } from "bun:test";
import { specNotice } from "../../../../src/render/ui/job-state";
import { heldBackResolvesOnItsOwn } from "../../../../src/render/ui/job-state/notice.ts";
import type { QueueRowView } from "../../../../src/render";

const lead = (over: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "j1",
  project: "aide",
  specFolder: "1-x",
  steps: ["implement"],
  stepIndex: 0,
  state: "queued",
  spentUsd: 0,
  timeoutSec: 600,
  createdAt: "2026-09-03T00:00:00Z",
  ...over,
});

describe("specNotice's held-back branch reads errorReason, not a text prefix", () => {
  test("errorReason 'held-back' renders waiting even when the text does not start with 'held back:'", () => {
    const notice = specNotice(
      lead({ error: "waiting on another archive to land", errorReason: "held-back" as QueueRowView["errorReason"] }),
    );
    expect(notice?.variant).toBe("waiting");
  });

  test("text starting with 'held back:' but a different errorReason renders failed", () => {
    const notice = specNotice(lead({ error: "held back: not analyzed yet — run /aide-analyze first", errorReason: "conflict" }));
    expect(notice?.variant).toBe("failed");
  });

  // A suite that went red on the merge is the same shape as a hold-back:
  // nothing in the machinery broke, the work is not green yet, and the
  // answer is to run implement again. Amber, not red.
  test("errorReason 'tests-red' renders waiting", () => {
    const notice = specNotice(
      lead({ error: "the project's tests are red on the merge — nothing was pushed.", errorReason: "tests-red" }),
    );
    expect(notice?.variant).toBe("waiting");
  });
});

// Spec 389: three of the six held-back reasons resolve on their own —
// nothing for the reader to act on — and take the info kind instead of
// the waiting kind's warning triangle. The other three still wait on a
// person and keep the triangle.
describe("specNotice's held-back branch tells self-resolving reasons from ones a person must act on", () => {
  test("a held-back key that resolves on its own renders info", () => {
    const notice = specNotice(lead({ error: { key: "runner.landingPause" }, errorReason: "held-back" }));
    expect(notice?.variant).toBe("info");
  });

  test("a held-back key that waits on a person renders waiting", () => {
    const notice = specNotice(lead({ error: { key: "runner.notAnalyzed" }, errorReason: "held-back" }));
    expect(notice?.variant).toBe("waiting");
  });
});

// Spec 467: once every Acceptance row is ticked, the held-back sentence
// goes away and nothing told the reader the next move was theirs —
// pressing Archive. `readyToArchive` is the lowest-priority case, checked
// last, so every existing producer here still outranks it.
describe("specNotice's readyToArchive case (spec 467)", () => {
  test("readyToArchive alone renders the ready-to-archive sentence", () => {
    const notice = specNotice(undefined, undefined, undefined, [], "en", true);
    expect(notice).toEqual({ variant: "waiting", text: "All checks ticked — press Archive to merge it" });
  });

  test("a held-back reason still wins over readyToArchive", () => {
    const notice = specNotice(undefined, "the Slack webhook", undefined, [], "en", true);
    expect(notice?.text).toContain("held back");
    expect(notice?.text).not.toContain("All checks ticked");
  });
});

// An analyze stopped on its acceptance criteria waits on the person who
// puts the description right: amber, with the faults the runner named.
describe("specNotice for an analyze stopped on its acceptance criteria", () => {
  test("renders the job's sentence as a waiting message (AC-5)", () => {
    const notice = specNotice(
      lead({
        steps: ["analyze"],
        state: "stopped",
        stopReason: "acceptance-criteria",
        error: {
          key: "runner.criteriaStopped",
          values: { button: "Analyze" },
          inner: [{ key: "runner.criteriaNotEars", values: { ids: "AC-2, AC-4" } }],
        },
      }),
    );
    expect(notice?.variant).toBe("waiting");
    expect(notice?.text).toContain("AC-2, AC-4");
  });
});

// An analyze stopped on files another open spec changes waits on the person
// who adds those specs to Depends on, or presses Analyze again: amber, with
// the sentence the runner worded.
describe("specNotice for an analyze stopped on files another open spec changes", () => {
  test("renders the job's sentence as a waiting message (AC-3)", () => {
    const sentence = "Analyze stopped: other open specs change the same files — 603-b: x.ts, y.ts; 604-c: z.ts.";
    const notice = specNotice(
      lead({ steps: ["analyze"], state: "stopped", stopReason: "shared-files", error: sentence }),
    );
    expect(notice?.variant).toBe("waiting");
    expect(notice?.text).toContain("603-b");
    expect(notice?.text).toContain("z.ts");
  });
});

// A wiki job held behind related work starts the moment that work ends, so the
// Jobs tab's state chip and the notice both read it as nothing to act on.
describe("a wiki job held behind related work in its project", () => {
  test("resolves on its own, as an archive held behind another does (AC-6)", () => {
    const held = (key: string) => ({ errorReason: "held-back" as const, error: { key } as never });
    expect(heldBackResolvesOnItsOwn(held("runner.archiveRunning"))).toBe(true);
    expect(heldBackResolvesOnItsOwn(held("runner.wikiWaitsOnProject"))).toBe(true);
  });
});
