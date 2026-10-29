// Which stop reasons count as a failed step, and the guard that keeps the
// list in step with the reasons `aide-run-spec` writes.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAILED_STOPS, isFailedStop, leavesStepUndone } from "../../src/format/stop-reason.ts";
import { runSpecParts } from "../helpers/run-spec-source.ts";

const SCRIPTS = join(import.meta.dir, "../../../core/scripts");

// The reasons the script writes that are NOT a failure of the step's work:
// a finished step, a close, the two limits the queue keeps as stopped, a model
// the provider had no room for, an analyze stopped on its acceptance criteria or on files another open
// spec changes, an implement sent back to a full analysis, a cancel, and the runner
// declining before any model ran.
const NOT_FAILURES = [
  "completed", "closed", "timeout", "provider-limit", "model-at-capacity", "acceptance-criteria", "shared-files", "sent-back", "cancelled", "refused",
];

describe("isFailedStop", () => {
  test("names the nine reasons a step ends failed for", () => {
    expect([...FAILED_STOPS].sort()).toEqual(
      [
        "cli-error", "merge-unfinished", "model-refused", "no-progress", "scope-violation", "sent-back-refused",
        "short-analysis-over-limit", "tests-red", "unpushed",
      ],
    );
  });

  test("the limits, a cancel and a refusal to start are not failures", () => {
    for (const reason of ["timeout", "provider-limit", "cancelled", "refused"]) expect(isFailedStop(reason)).toBe(false);
  });

  test("no reason is not a failure, and neither is one nobody has classified", () => {
    expect(isFailedStop(undefined)).toBe(false);
    expect(isFailedStop("not-implemented-yet")).toBe(false);
  });

  // A reason the script starts writing that nobody classified would read
  // as today's amber Stopped by default; this names it instead.
  test("every reason the scripts write is either a failure or named as not one", () => {
    const files = [
      join(SCRIPTS, "aide-run-spec"),
      ...runSpecParts(),
    ];
    const written = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      for (const m of source.matchAll(/terminal_reason="([a-z][a-z-]*)"/g)) written.add(m[1]!);
      for (const m of source.matchAll(/\(stopped: ([a-z][a-z-]*)\)/g)) written.add(m[1]!);
    }
    expect(written.size).toBeGreaterThan(5);
    const unclassified = [...written].filter((r) => !isFailedStop(r) && !NOT_FAILURES.includes(r));
    expect(unclassified).toEqual([]);
  });
});

describe("leavesStepUndone", () => {
  test("an analyze stopped on its acceptance criteria is not a failure, and leaves its step undone", () => {
    expect(isFailedStop("acceptance-criteria")).toBe(false);
    expect(leavesStepUndone("acceptance-criteria")).toBe(true);
  });

  test("an analyze stopped on files another open spec changes is not a failure, and leaves its step undone", () => {
    expect(isFailedStop("shared-files")).toBe(false);
    expect(leavesStepUndone("shared-files")).toBe(true);
  });

  test("a model at capacity is not a failure, and leaves its step undone", () => {
    expect(isFailedStop("model-at-capacity")).toBe(false);
    expect(leavesStepUndone("model-at-capacity")).toBe(true);
  });

  test("every failed stop leaves its step undone, and the clock does not", () => {
    for (const reason of FAILED_STOPS) expect(leavesStepUndone(reason)).toBe(true);
    expect(leavesStepUndone("timeout")).toBe(false);
    expect(leavesStepUndone(undefined)).toBe(false);
  });
});

describe("an analyze whose short analysis was over a limit", () => {
  test("is a failed stop, and leaves its step undone", () => {
    expect(isFailedStop("short-analysis-over-limit")).toBe(true);
    expect(leavesStepUndone("short-analysis-over-limit")).toBe(true);
  });
});

describe("an implement sent back to a full analysis", () => {
  test("is not a failure, and leaves its step undone", () => {
    expect(isFailedStop("sent-back")).toBe(false);
    expect(leavesStepUndone("sent-back")).toBe(true);
  });

  test("one refused, because its analysis was already full, is a failed stop", () => {
    expect(isFailedStop("sent-back-refused")).toBe(true);
    expect(leavesStepUndone("sent-back-refused")).toBe(true);
  });
});
