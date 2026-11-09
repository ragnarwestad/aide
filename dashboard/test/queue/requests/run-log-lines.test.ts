// The run log's stamped line and a step's mark are written once in bash
// (core/scripts/lib/run-spec/setup/run-log.sh) and once in TypeScript
// (formatRunLogLine in step-log.ts, stepMarkLine in step-marks.ts). Both
// run here, and each side reads what the other wrote.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { formatRunLogLine, readRunLogLine } from "../../../src/queue/parse-stream/step-log.ts";
import { markOf, stepMarkLine } from "../../../src/queue/parse-stream/step-marks.ts";

const LIB = join(import.meta.dir, "..", "..", "..", "..", "core", "scripts", "lib", "run-spec", "setup", "run-log.sh");

/** What a bash function printed, to stdout and stderr together, with the step begun five seconds ago. */
const bash = (script: string, ...args: string[]): string => {
  const run = Bun.spawnSync({
    cmd: ["bash", "-c", `set -u; step_started_at=$(( $(date +%s) - 5 )); source "$1"; shift; ${script} 2>&1`, "_", LIB, ...args],
    stdout: "pipe",
  });
  return run.stdout.toString();
};

describe("a line of the run log", () => {
  test("bash writes it and the dashboard reads it back: the clock, the seconds, the text (AC-1)", () => {
    const line = bash('stage_line "$1"', "text").trimEnd();
    const read = readRunLogLine(line);
    expect(read).toBeDefined();
    expect(read!.clock).toMatch(/^\d\d:\d\d:\d\d$/);
    expect([5, 6]).toContain(read!.seconds);
    expect(read!.body).toBe("text");
    expect(read!.error).toBe(false);
  });

  test("a failure bash writes reads as an error (AC-1)", () => {
    const read = readRunLogLine(bash('stage_line "$1"', "error: boom").trimEnd());
    expect(read?.error).toBe(true);
    expect(read?.body).toBe("error: boom");
  });

  test("the dashboard writes the very line bash wrote, given its clock and seconds (AC-1)", () => {
    const line = bash('stage_line "$1"', "the merge went through").trimEnd();
    const read = readRunLogLine(line)!;
    expect(formatRunLogLine(read.clock, read.seconds, "the merge went through")).toBe(line);
    const failed = bash('stage_line "$1"', "error: boom").trimEnd();
    const readFailed = readRunLogLine(failed)!;
    expect(formatRunLogLine(readFailed.clock, readFailed.seconds, "boom", true)).toBe(failed);
  });

  test("an unstamped line is not read as one (AC-1)", () => {
    expect(readRunLogLine("aide-run-spec: an older note")).toBeUndefined();
    expect(readRunLogLine("another script's line")).toBeUndefined();
  });
});

describe("a step's mark", () => {
  const CASES: Array<[string, string, string]> = [
    ["Aide", "preparing", "started"],
    ["Aide", "tests and commit", "done"],
    ["5 of 5", "Merge into main", "stopped: nothing was merged — the archive is not finished"],
    ["3 of 5", "Restart the service", "skipped"],
  ];

  for (const [place, title, ending] of CASES) {
    test(`${place}: ${title} — ${ending} is the same line on both sides, and read alike (AC-1)`, () => {
      const fromBash = bash('aide_step_mark "$1" "$2" "$3"', place, title, ending);
      expect(fromBash).toBe(stepMarkLine(place, title, ending));
      const mark = markOf(fromBash);
      expect(mark?.key).toBe(place === "Aide" ? `Step Aide: ${title}` : `Step ${place}`);
      expect(mark?.ends).toBe(ending !== "started");
    });
  }
});
