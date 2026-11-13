import { describe, expect, test } from "bun:test";
import { evenPace, resetMoment, resetsIn, windowSummary } from "../../../../src/render/ui/usage-dialog/pace.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;
const iso = (ms: number | undefined) => ms === undefined ? undefined : new Date(ms).toISOString();
const moment = (resets: string, now: string) => iso(resetMoment({ name: "Current week", usedPercent: 0, resets }, Date.parse(now)));

describe("resetMoment()", () => {
  test("takes a Codex reset time as it is (AC-2)", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    expect(iso(resetMoment({ name: "five_hour", usedPercent: 0, resetsAt: "2026-11-12T12:09:00.000Z" }, now))).toBe("2026-11-12T12:09:00.000Z");
  });

  test("reads Claude's words with a day, a year and minutes as the clock time in their zone (AC-2)", () => {
    expect(moment("Oct 8 at 6am (Europe/Oslo)", "2026-10-02T12:00:00Z")).toBe("2026-10-08T04:00:00.000Z");
    expect(moment("Oct 8, 2026 at 6:30am (Europe/Oslo)", "2026-10-02T12:00:00Z")).toBe("2026-10-08T04:30:00.000Z");
    expect(moment("Oct 2 at 11:20pm (Europe/Oslo)", "2026-10-02T12:00:00Z")).toBe("2026-10-02T21:20:00.000Z");
  });

  test("honours the change to winter time between now and the reset (AC-2)", () => {
    expect(moment("Oct 26 at 6am (Europe/Oslo)", "2026-10-24T12:00:00Z")).toBe("2026-10-26T05:00:00.000Z");
  });

  test("reads a clock time alone as the next time it comes (AC-2)", () => {
    expect(moment("4pm (Europe/Oslo)", "2026-11-12T12:00:00Z")).toBe("2026-11-12T15:00:00.000Z");
    expect(moment("11am (Europe/Oslo)", "2026-11-12T12:00:00Z")).toBe("2026-11-13T10:00:00.000Z");
  });

  test("puts a day with no year in the year closest to now (AC-2)", () => {
    expect(moment("Jan 2 at 6am (Europe/Oslo)", "2026-12-30T12:00:00Z")).toBe("2027-01-02T05:00:00.000Z");
  });

  test("gives no reset moment for words it cannot read, an unknown zone or a time already passed (AC-2)", () => {
    expect(moment("whenever it likes", "2026-10-02T12:00:00Z")).toBeUndefined();
    expect(moment("Oct 8 at 6am (Mars/Olympus)", "2026-10-02T12:00:00Z")).toBeUndefined();
    expect(moment("Oct 1 at 6am (Europe/Oslo)", "2026-10-02T12:00:00Z")).toBeUndefined();
    expect(iso(resetMoment({ name: "five_hour", usedPercent: 0, resetsAt: "2026-11-12T11:00:00Z" }, Date.parse("2026-11-12T12:00:00Z")))).toBeUndefined();
    expect(iso(resetMoment({ name: "five_hour", usedPercent: 0 }, Date.parse("2026-11-12T12:00:00Z")))).toBeUndefined();
  });
});

describe("resetsIn()", () => {
  test("writes the time to the reset in short form (AC-2)", () => {
    expect(resetsIn(9 * MINUTE, "en")).toBe("9m");
    expect(resetsIn(5 * DAY + 7 * HOUR + 20 * MINUTE, "en")).toBe("5d 7h");
    expect(resetsIn(2 * HOUR + 14 * MINUTE, "en")).toBe("2h 14m");
    expect(resetsIn(20_000, "en")).toBe("1m");
  });
});

describe("evenPace()", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");

  test("is the share that would be left at an even pace to the reset (AC-3)", () => {
    expect(evenPace(7 * DAY, now + 3.5 * DAY, now)).toBe(50);
    expect(evenPace(5 * HOUR, now + HOUR, now)).toBe(20);
  });

  test("is unknown without a length or a reset moment (AC-3)", () => {
    expect(evenPace(undefined, now + HOUR, now)).toBeUndefined();
    expect(evenPace(5 * HOUR, undefined, now)).toBeUndefined();
  });
});

describe("windowSummary()", () => {
  const bar = (leftPercent: number, pace?: number, reset?: number) => ({ leftPercent, ...(pace === undefined ? {} : { pace }), ...(reset === undefined ? {} : { reset }) });

  test("is the mean share left, with the trend against the mean even pace (AC-4)", () => {
    expect(windowSummary([bar(40, 70), bar(60, 70)])).toMatchObject({ leftPercent: 50, trend: "faster" });
    expect(windowSummary([bar(50, 60), bar(50, 80)]).trend).toBe("faster");
    expect(windowSummary([bar(80, 70), bar(80, 70)]).trend).toBe("slower");
    expect(windowSummary([bar(73, 70), bar(73, 70)]).trend).toBe("even");
    expect(windowSummary([bar(65, 70), bar(65, 70)]).trend).toBe("even");
    expect(windowSummary([bar(40, 70), bar(60)]).trend).toBeUndefined();
  });

  test("shows one account's own figures (AC-4)", () => {
    expect(windowSummary([bar(30, 50)])).toMatchObject({ leftPercent: 30, trend: "faster" });
  });

  test("rises at the earliest reset by what the accounts resetting then have used (AC-5)", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    expect(windowSummary([bar(60, undefined, now + HOUR), bar(30, undefined, now + 3 * HOUR)]).rise).toBe(20);
    expect(windowSummary([bar(60, undefined, now + HOUR), bar(30, undefined, now + HOUR + 20_000)]).rise).toBe(55);
    expect(windowSummary([bar(60), bar(30)]).rise).toBeUndefined();
  });
});
