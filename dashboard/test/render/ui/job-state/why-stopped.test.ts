// The popover beside a job's state says why it stopped. A step a usage limit
// stopped, and that the board ended because a newer job took it over, is
// cancelled and still says why.

import { expect, test } from "bun:test";
import { whyStopped } from "../../../../src/render/ui/job-state/format.ts";
import { formatSentence } from "../../../../src/messages/format.ts";

const takenOver = { key: "runner.waitTakenOver" as const, values: { step: "analyze" } };

test("a stopped step a newer job took over says so", () => {
  expect(whyStopped({ state: "cancelled", stopReason: "provider-limit", error: takenOver }))
    .toBe(formatSentence("en", takenOver)!);
});

test("a cancel with no stop before it has no popover", () => {
  expect(whyStopped({ state: "cancelled", error: { key: "runner.usageLimitHeld", values: { provider: "claude", at: "x" } } }))
    .toBeUndefined();
});
