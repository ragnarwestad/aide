// The (?) under a row's message holds only what the message does not
// already say. A step's red run says its failing tests on the row.
import { describe, expect, test } from "bun:test";
import { specNotice } from "../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../src/render";

const lead = (over: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "j1",
  project: "aide-test",
  specFolder: "02-analysis-only",
  steps: ["implement"],
  stepIndex: 0,
  state: "failed",
  spentUsd: 0,
  timeoutSec: 600,
  createdAt: "2026-09-19T00:00:00Z",
  ...over,
});

describe("a notice's detail", () => {
  test("a detail the message already carries gets no (?)", () => {
    const said = "the model's tool stopped with an error before it could finish — press Implement again";
    const notice = specNotice(
      lead({
        error: `The step failed on fake-claude on script: ${said} — Open Settings, the fake-claude tab, and press Check.`,
        errorDetail: said,
      }),
    );
    expect(notice?.title).toBeUndefined();
  });

  test("a detail that adds something keeps its (?)", () => {
    const notice = specNotice(lead({ error: "git could not be run", errorDetail: "ENOENT: no such file or directory" }));
    expect(notice?.title).toBe("ENOENT: no such file or directory");
  });

  test("a red run's failing tests are on the row, and its restated sentence is not", () => {
    const notice = specNotice(
      lead({
        specFolder: "06-a-test-that-stays-red",
        error: { key: "runner.testsRedImplement", values: { button: "Implement" } },
        errorReason: "tests-red" as QueueRowView["errorReason"],
        errorDetail:
          "the step reported success, but the project's tests are red on its result — the run and its record are the runner's own, not the session's. Press Implement again for this step.\n" +
          "(fail) a-test-that-stays-red: the fact is on the list [0.20ms]",
      }),
    );
    expect(notice?.title).toBeUndefined();
    expect(notice?.parts?.map((p) => p.text)).toContain("(fail) a-test-that-stays-red: the fact is on the list [0.20ms]");
    expect(notice?.text).not.toContain("the run and its record");
  });
});
