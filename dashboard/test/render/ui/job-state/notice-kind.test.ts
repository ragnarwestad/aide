// Spec 372, REQ-1/REQ-3: the held-back branch in specNotice() reads the
// job's own errorReason field, never a text-prefix guess on lead.error
// — the f3cd5b7 patch this spec replaces taught the panel to recognise
// ONE producer's "held back:" prefix, which left every other waiting-
// shaped message still guessing "warn" or "err" for itself.
import { describe, expect, test } from "bun:test";
import { specNotice } from "../../../../src/render/ui/job-state/notice.ts";
import type { QueueRowView } from "../../../../src/render/ui/job-state/types.ts";

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
