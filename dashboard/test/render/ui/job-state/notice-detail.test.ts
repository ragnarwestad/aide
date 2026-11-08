// The (?) under a row's message holds only what the message does not
// already say. An implement's red run names its failing tests in the sentence.
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
    const said =
      "the model's tool stopped with an error before it could finish — press Implement again";
    const notice = specNotice(
      lead({
        error: `The step failed on fake-claude on script: ${said} — Open Settings, the fake-claude tab, and press Check.`,
        errorDetail: said,
      }),
    );
    expect(notice?.title).toBeUndefined();
  });

  test("a detail that adds something keeps its (?)", () => {
    const notice = specNotice(
      lead({
        error: "git could not be run",
        errorDetail: "ENOENT: no such file or directory",
      }),
    );
    expect(notice?.title).toBe("ENOENT: no such file or directory");
  });

  test("a two-line detail whose first line restates the message is shown whole (AC-3)", () => {
    const detail =
      "Error: ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL\nsrc/a.test.ts:3 › works";
    const notice = specNotice(
      lead({
        specFolder: "06-a-test-that-stays-red",
        error: {
          key: "runner.testsRedFailing",
          values: {
            n: "1",
            total: "9",
            tests: "a.spec.ts:3 › works",
            button: "Implement",
          },
        },
        errorReason: "tests-red" as QueueRowView["errorReason"],
        errorDetail: detail,
      }),
    );
    expect(notice?.title).toBe(detail);
    expect(notice?.parts).toHaveLength(1);
  });

  test("a stored job whose error is the runner's string shows that string (AC-4)", () => {
    const notice = specNotice(
      lead({ error: "the step's own work did not reach origin: code" }),
    );
    expect(notice?.text).toContain(
      "the step's own work did not reach origin: code",
    );
  });
});
