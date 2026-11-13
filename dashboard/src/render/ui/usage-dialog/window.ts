// What the Usage dialog calls a window, and how long it lasts, from the
// window's name alone. Two kinds of name arrive: the board's own for a
// Codex window (`five_hour`, `seven_day`, `<n>_minutes`, written by the
// Codex reader in `src/serve`, which `src/render` may not import), and
// Claude's own words (`Current session`, `Current week (all models)`).

import { t, type Language } from "../../../i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MINUTES = /^(\d+)_minutes$/;
/** Claude's week, with what it is limited to in brackets when it is one
 *  model's: `Current week (Fable)`, `Current week (Sonnet only)`. */
const CLAUDE_WEEK = /^current week(?:\s*\((.+)\))?$/i;
const CLAUDE_SESSION = /^current session$/i;

/** The window's short name in the page's language; a name the dialog does
 *  not know stays the tool's own words. */
export function windowShortName(name: string, lang: Language): string {
  if (name === "five_hour" || CLAUDE_SESSION.test(name)) return t(lang, "usage.window.session");
  if (name === "seven_day") return t(lang, "usage.window.weekly");
  const minutes = MINUTES.exec(name);
  if (minutes) return t(lang, "usage.window.minutes", { minutes: minutes[1]! });
  const week = CLAUDE_WEEK.exec(name.trim());
  if (week) {
    const model = week[1]?.trim().replace(/\s+only$/i, "");
    return !model || /^all models$/i.test(model)
      ? t(lang, "usage.window.weekly")
      : t(lang, "usage.window.weeklyModel", { model });
  }
  return name;
}

/** How long the window lasts, in milliseconds, when its name says so.
 *  Claude's session names no length, and neither does a window of no
 *  minutes. */
export function windowLength(name: string): number | undefined {
  if (name === "five_hour") return 5 * HOUR;
  if (name === "seven_day") return 7 * DAY;
  const minutes = MINUTES.exec(name);
  if (minutes) return Number(minutes[1]) > 0 ? Number(minutes[1]) * MINUTE : undefined;
  return CLAUDE_WEEK.test(name.trim()) ? 7 * DAY : undefined;
}
