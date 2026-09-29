// Which stop reasons count as a failed step, and the guard that keeps the
// list in step with the reasons `aide-run-spec` writes.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FAILED_STOPS, isFailedStop } from "../../src/format/stop-reason.ts";

const SCRIPTS = join(import.meta.dir, "../../../core/scripts");

// The reasons the script writes that are NOT a failure of the step's work:
// a finished step, a close, the two limits the queue keeps as stopped, a
// cancel, and the runner declining before any model ran.
const NOT_FAILURES = ["completed", "closed", "timeout", "provider-limit", "cancelled", "refused"];

describe("isFailedStop", () => {
  test("names the seven reasons a step ends failed for", () => {
    expect([...FAILED_STOPS].sort()).toEqual(
      ["cli-error", "merge-unfinished", "model-refused", "no-progress", "scope-violation", "tests-red", "unpushed"],
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
      ...readdirSync(join(SCRIPTS, "lib"))
        .filter((f) => f.startsWith("run-spec-") && f.endsWith(".sh"))
        .map((f) => join(SCRIPTS, "lib", f)),
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
