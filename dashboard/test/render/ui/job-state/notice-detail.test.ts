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

  test("an implement's red run keeps its log lines behind the (?), not on the row or restated", () => {
    const notice = specNotice(
      lead({
        specFolder: "06-a-test-that-stays-red",
        error: { key: "runner.testsRedInChange", values: { n: "1", total: "9", tests: "a.spec.ts:3 › works", button: "Implement" } },
        errorReason: "tests-red" as QueueRowView["errorReason"],
        errorDetail:
          "the step reported success, but the project's tests are red on its result — the run and its record are the runner's own, not the session's. Press Implement again for this step.\n" +
          "Error: ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL",
      }),
    );
    expect(notice?.title).toBe("Error: ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL");
    expect(notice?.parts).toHaveLength(1);
  });

  test("a run that never started keeps its log line behind the (?), not its restated sentence", () => {
    const line = "Error: http://localhost:8806/health/ready is already used, make sure that nothing is running on the port/url";
    const notice = specNotice(
      lead({
        error: { key: "runner.testsNotStartedPortSpec", values: { port: "8806", spec: "58", button: "Implement" } },
        errorDetail:
          "the step reported success, but the project's tests did not start — the server the tests need could not start, so no test ran. Press Implement again for this step once that is put right.\n" +
          line,
      }),
    );
    expect(notice?.title).toBe(line);
  });
});
