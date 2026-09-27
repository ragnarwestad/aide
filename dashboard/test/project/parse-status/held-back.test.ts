// held-back.ts in isolation: where a round began, and whether a spec
// is a reopened round.

import { describe, expect, test } from "bun:test";
import { latestRoundBoundary, reopenedRound } from "../../../src/project/parse-status";

describe("latestRoundBoundary", () => {
  test("reads the sha off a Round boundary stamp", () => {
    const status = "- **Round boundary:** 2026-09-15 (history before `abc1234` does not count)\n";
    expect(latestRoundBoundary(status)).toBe("abc1234");
  });

  test("the LAST stamp wins when a spec has been held back more than once", () => {
    const status = [
      "- **Round boundary:** 2026-09-01 (history before `1111111` does not count)",
      "- **Round boundary:** 2026-09-15 (history before `2222222` does not count)",
    ].join("\n");
    expect(latestRoundBoundary(status)).toBe("2222222");
  });

  test("no stamp at all: null", () => {
    expect(latestRoundBoundary("nothing here")).toBeNull();
  });
});


const STAMP = "- **Round boundary:** 2026-09-19 (history before `abc1234` does not count)";
const ARCHIVED = "- **Archived:** 2026-09-10";

describe("reopenedRound", () => {
  test("an Archived stamp followed by a Round boundary stamp is a reopened round AC-5", () => {
    expect(reopenedRound(`${ARCHIVED}\n${STAMP}\n`)).toBe(true);
  });
  test("a Closed stamp followed by a Round boundary stamp is a reopened round AC-5", () => {
    expect(reopenedRound(`- **Closed:** 2026-09-10\n${STAMP}\n`)).toBe(true);
  });
  test("a boundary with no Archived or Closed stamp before it is not (a held-back spec) AC-5", () => {
    expect(reopenedRound(`${STAMP}\n`)).toBe(false);
  });
  test("a Reopened or Reset mark in between makes it not a keep-reopen AC-5", () => {
    expect(reopenedRound(`${ARCHIVED}\n- **Reopened:** 2026-09-12\n${STAMP}\n`)).toBe(false);
    expect(reopenedRound(`${ARCHIVED}\n- **Reset:** 2026-09-12\n${STAMP}\n`)).toBe(false);
  });
  test("archived again after the boundary is history, not an open round AC-5", () => {
    expect(reopenedRound(`${ARCHIVED}\n${STAMP}\n- **Archived:** 2026-09-20\n`)).toBe(false);
  });
});


