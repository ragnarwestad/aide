import { describe, expect, test } from "bun:test";
import { t } from "../../../../src/i18n";
import { windowLength, windowShortName } from "../../../../src/render/ui/usage-dialog/window.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("windowShortName()", () => {
  test("names the board's and Claude's windows by their short name, and keeps any other name (AC-6)", () => {
    const names = [
      "five_hour", "seven_day", "45_minutes", "Current session", "Current week (all models)",
      "Current week (Fable)", "Current week (Sonnet only)", "current WEEK", "Spark",
    ];
    expect(names.map((name) => windowShortName(name, "en"))).toEqual([
      "Session", "Weekly", "45 min", "Session", "Weekly", "Weekly · Fable", "Weekly · Sonnet", "Weekly", "Spark",
    ]);
  });

  test("writes the short name in the page's language (AC-6)", () => {
    expect(windowShortName("five_hour", "nb")).toBe(t("nb", "usage.window.session"));
    expect(windowShortName("five_hour", "nb")).not.toBe(windowShortName("five_hour", "en"));
  });
});

describe("windowLength()", () => {
  test("knows the length of five hours, seven days, minutes and Claude's week (AC-3)", () => {
    expect(windowLength("five_hour")).toBe(5 * HOUR);
    expect(windowLength("seven_day")).toBe(7 * DAY);
    expect(windowLength("45_minutes")).toBe(45 * 60_000);
    expect(windowLength("Current week (all models)")).toBe(7 * DAY);
    expect(windowLength("Current week (Fable)")).toBe(7 * DAY);
  });

  test("knows no length for Claude's session, a window of no minutes or a name it does not know (AC-3)", () => {
    expect(windowLength("Current session")).toBeUndefined();
    expect(windowLength("0_minutes")).toBeUndefined();
    expect(windowLength("Spark")).toBeUndefined();
  });
});
