// When a usage window starts over, how long until then, the share that
// would be left at an even pace to that moment, and what a row of
// accounts adds up to. Every rule is a function of a reading and `now`,
// so the panel, drawn fresh each time it opens, is as current as its
// opening.

import { t, type Language } from "../../../i18n";
import type { UsageWindow } from "../../pages/settings-page/usage.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Claude's words for a reset: `Oct 8 at 6am (Europe/Oslo)`,
 *  `Oct 8, 2026 at 6:30am (Europe/Oslo)`, `4pm (Europe/Oslo)`. */
const CLAUDE_RESET = /^(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?$/i;

interface Wall { year: number; month: number; day: number; hour: number; minute: number }

/** The wall clock in `zone` at `ms`; the host's own zone when none. */
function wallAt(ms: number, zone: string | undefined): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: part("year"), month: part("month") - 1, day: part("day"), hour: part("hour"), minute: part("minute") };
}

const offsetAt = (ms: number, zone: string | undefined): number => {
  const wall = wallAt(ms, zone);
  return Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute) - Math.floor(ms / MINUTE) * MINUTE;
};

/** The moment a wall-clock time in `zone` names. The offset is checked a
 *  second time at the result, so a change to or from summer time between
 *  now and then is honoured. */
function momentOf(wall: Wall, zone: string | undefined): number {
  const asUtc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute);
  const first = asUtc - offsetAt(asUtc, zone);
  return asUtc - offsetAt(first, zone);
}

function fromClaudeWords(words: string, now: number): number | undefined {
  const match = CLAUDE_RESET.exec(words.trim());
  if (!match) return undefined;
  const [, monthWord, dayText, yearText, hourText, minuteText, half, zoneText] = match;
  const hour12 = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return undefined;
  const hour = (hour12 % 12) + (half!.toLowerCase() === "pm" ? 12 : 0);
  const zone = zoneText?.trim();
  const today = wallAt(now, zone);
  if (!monthWord) {
    const at = momentOf({ ...today, hour, minute }, zone);
    if (at > now) return at;
    const tomorrow = wallAt(at + DAY, zone);
    return momentOf({ ...tomorrow, hour, minute }, zone);
  }
  const month = MONTHS.indexOf(monthWord.toLowerCase());
  if (month < 0) return undefined;
  const day = Number(dayText);
  const years = yearText ? [Number(yearText)] : [today.year - 1, today.year, today.year + 1];
  const candidates = years.map((year) => momentOf({ year, month, day, hour, minute }, zone));
  return candidates.reduce((best, at) => Math.abs(at - now) < Math.abs(best - now) ? at : best);
}

/** When the window starts over: Codex's moment as it came, or Claude's
 *  words read as a clock time. Words that cannot be read, an unknown zone
 *  and a moment already passed are no reset moment, never a wrong one. */
export function resetMoment(window: UsageWindow, now: number): number | undefined {
  let at: number | undefined;
  const given = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  if (!Number.isNaN(given)) at = given;
  else if (window.resets) {
    try {
      at = fromClaudeWords(window.resets, now);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return at !== undefined && at > now ? at : undefined;
}

/** The time to a reset in short form: "5d 7h", "2h 14m", "9m". */
export function resetsIn(ms: number, lang: Language): string {
  const minutes = Math.max(1, Math.floor(ms / MINUTE));
  if (ms >= DAY) return t(lang, "usage.resetsIn.days", { days: Math.floor(ms / DAY), hours: Math.floor((ms % DAY) / HOUR) });
  if (ms >= HOUR) return t(lang, "usage.resetsIn.hours", { hours: Math.floor(ms / HOUR), minutes: minutes % 60 });
  return t(lang, "usage.resetsIn.minutes", { minutes });
}

/** The share that would be left, used evenly from the window's start to
 *  its reset; unknown without both. */
export function evenPace(length: number | undefined, reset: number | undefined, now: number): number | undefined {
  if (length === undefined || reset === undefined || length <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((100 * (reset - now)) / length)));
}

export type Trend = "faster" | "slower" | "even";
export interface WindowSummary { leftPercent: number; trend?: Trend; rise?: number }

const TREND_MARGIN = 5;

/** A row of accounts as one figure: the mean share left; the trend
 *  against the mean even pace, only when every account has one; and how
 *  much the mean rises when the accounts resetting first start over. */
export function windowSummary(bars: { leftPercent: number; pace?: number; reset?: number }[]): WindowSummary {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const left = mean(bars.map((bar) => bar.leftPercent));
  const summary: WindowSummary = { leftPercent: Math.round(left) };
  const paces = bars.map((bar) => bar.pace).filter((pace): pace is number => pace !== undefined);
  if (paces.length === bars.length) {
    const gap = left - mean(paces);
    summary.trend = gap < -TREND_MARGIN ? "faster" : gap > TREND_MARGIN ? "slower" : "even";
  }
  const resets = bars.map((bar) => bar.reset).filter((reset): reset is number => reset !== undefined);
  if (resets.length > 0) {
    const firstMinute = Math.floor(Math.min(...resets) / MINUTE);
    const first = bars.filter((bar) => bar.reset !== undefined && Math.floor(bar.reset / MINUTE) === firstMinute);
    summary.rise = Math.round(first.reduce((sum, bar) => sum + (100 - bar.leftPercent), 0) / bars.length);
  }
  return summary;
}
