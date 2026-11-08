import { describe, expect, test } from "bun:test";
import { installTimestampedConsole, stampLine } from "../../../src/serve/serve-helpers/timestamped-console.ts";

describe("the served dashboard's log lines carry the clock", () => {
  const at = () => new Date("2026-09-14T09:37:22.000Z");

  test("a line is stamped with the moment it was written", () => {
    expect(stampLine("boards: stopping main on :8801", at)).toBe("2026-09-14T09:37:22.000Z boards: stopping main on :8801");
  });

  test("console.log and console.error both stamp, and the originals come back", () => {
    const written: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (...a: unknown[]) => written.push(`log ${a.join(" ")}`);
    console.error = (...a: unknown[]) => written.push(`error ${a.join(" ")}`);
    try {
      const restore = installTimestampedConsole(at);
      console.log("queue: restarting");
      console.error("queue: landing failed");
      restore();
      console.log("plain");
      expect(written).toEqual([
        "log 2026-09-14T09:37:22.000Z queue: restarting",
        "error 2026-09-14T09:37:22.000Z queue: landing failed",
        "log plain",
      ]);
    } finally {
      console.log = log;
      console.error = error;
    }
  });
});
