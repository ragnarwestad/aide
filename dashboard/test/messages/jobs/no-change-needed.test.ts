// A job that ended after an analyze found nothing to change says so, the
// same general sentence on the Jobs tab and on the spec's row and page.
import { describe, expect, test } from "bun:test";
import { getJobMessage } from "../../../src/messages/jobs/get.ts";
import { getSpecMessage } from "../../../src/messages/specs/get.ts";
import type { QueueRowView } from "../../../src/render/ui/job-state/types.ts";

const SENTENCE = "No change needed. Analysis found nothing to implement.";

const job = (over: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "j", project: "aide", specFolder: "81-queue", steps: ["analyze", "implement"], stepIndex: 0,
  state: "done", spentUsd: 0, timeoutSec: 600, createdAt: "2026-10-01T10:00:00Z",
  results: [{ step: "analyze", ok: true, costUsd: 0, terminalReason: "completed", noChangeNeeded: true }],
  ...over,
});

describe("a job that ended with no change needed", () => {
  test("reads the general sentence on the Jobs tab, as information (AC-2)", () => {
    expect(getJobMessage(job() as never, "en")).toEqual({ variant: "info", text: SENTENCE });
  });

  test("reads the same sentence on the spec's row (AC-2)", () => {
    const notice = getSpecMessage(job(), undefined, undefined, [], "en");
    expect(notice?.variant).toBe("info");
    expect(notice?.text).toBe(SENTENCE);
  });

  test("a done job whose analyze did not carry it reads nothing", () => {
    const plain = job({ results: [{ step: "analyze", ok: true, costUsd: 0, terminalReason: "completed" }] });
    expect(getJobMessage(plain as never, "en")).toBeUndefined();
    expect(getSpecMessage(plain, undefined, undefined, [], "en")).toBeUndefined();
  });
});
