// A hand-paired bash/TypeScript decision (docs/bash-typescript-decisions.md):
// which terminal reason a finished `close` reports, and which one the
// dashboard lands a close on. Nothing imports across the two, and when
// they disagreed the merge was skipped in silence — the spec was stamped
// and moved on its branch, and the default branch never saw it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const RUN_SPEC = read("../../../core/scripts/aide-run-spec");
const RUNNER_SETUP = read("../../src/serve/runner-setup.ts");

describe("close: the word bash reports is the word the dashboard lands on", () => {
  test("aide-run-spec reports `closed` for a finished close", () => {
    expect(RUN_SPEC).toContain('terminal_reason="closed"');
    // From `aide-close-spec`, not invented: the script is what stamps
    // and moves, so it is what decides whether anything was closed.
    expect(RUN_SPEC).toContain("aide-close-spec");
  });

  test("the dashboard lands a close on that same word", () => {
    const branch = /if \(step === "close"\) \{([\s\S]*?)\n\s*\}/.exec(RUNNER_SETUP)?.[1] ?? "";
    expect(branch).toContain("landClosedSpec");
    expect(branch).toContain('terminalReason === "closed"');
  });

  // The other half of the pair, unchanged and pinned here beside it:
  // archive lands on `completed`, which is a session's own word.
  test("archive still lands on completed, and the two are not confused", () => {
    const branch = /if \(step === "archive"\) \{([\s\S]*?)\n\s*\}/.exec(RUNNER_SETUP)?.[1] ?? "";
    expect(branch).toContain('terminalReason === "completed"');
    expect(branch).toContain("landArchivedSpec");
  });

  // A close whose branch never reached origin must not report `closed`:
  // the dashboard would then try to land a branch that is not there.
  test("the word is decided after the push is confirmed, never before", () => {
    const closedAt = RUN_SPEC.indexOf('terminal_reason="closed"');
    const unpushedAt = RUN_SPEC.lastIndexOf('terminal_reason="unpushed"');
    expect(closedAt).toBeGreaterThan(unpushedAt);
  });
});
