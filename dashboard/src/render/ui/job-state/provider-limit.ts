// The usage limit that stopped a step, as one sentence: which AI and
// model, which window ran out and when it starts over, and whatever else
// the tool said beside it. Every part is the tool's own record
// (`StepResult.providerLimit`) — the model is spent by the time this is
// read, so nothing here may ask it anything.

import { t, type Language, type TranslationKey } from "../../../i18n";
import type { ProviderLimit } from "../../../queue/queue.ts";

const TOOL_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode" };

const windowPhrase = (name: string, lang: Language): string => {
  if (name === "five_hour" || name === "seven_day") return t(lang, `limit.window.${name}` as TranslationKey);
  const minutes = /^(\d+)_minutes$/.exec(name);
  return minutes ? t(lang, "limit.window.minutes", { minutes: minutes[1]! }) : t(lang, "limit.window.other");
};

const capitalizeFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// The `Intl.DateTimeFormat` locale for each language's own date/time
// conventions.
const LOCALES: Record<Language, string> = {
  en: "en-GB", nb: "nb-NO", es: "es-ES", de: "de-DE", fr: "fr-FR",
};

/** A reset later today reads as a clock time; any other day carries the
 *  day as well. `timeZone` is the server's own unless a caller names one
 *  — the page is drawn on the serving host, in its reader's zone. */
function when(iso: string, now: number, lang: Language, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const locale = LOCALES[lang];
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d);
  const clock = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  if (day(at) === day(new Date(now))) return clock;
  const date = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" })
    .format(at)
    .replace(/,/g, "")
    .replace(/\./g, "");
  return `${date}, ${clock}`;
}

export function providerLimitSentence(
  limit: ProviderLimit,
  model: string | undefined,
  lang: Language,
  now: number = Date.now(),
  timeZone?: string,
): string {
  const tool = TOOL_NAMES[limit.tool] ?? limit.tool;
  const who = model ? `${tool} (${model})` : tool;
  let first = t(lang, "limit.used", { who, limit: windowPhrase(limit.window, lang) });
  if (limit.resetsAt) first += ` — ${t(lang, "limit.resets", { when: when(limit.resetsAt, now, lang, timeZone) })}`;
  const parts = [`${first}.`];
  for (const w of limit.windows ?? []) {
    if (w.name === limit.window) continue;
    parts.push(`${t(lang, "limit.otherWindow", { limit: capitalizeFirst(windowPhrase(w.name, lang)), percent: w.usedPercent })}.`);
  }
  if (limit.credit === "out_of_credits") parts.push(t(lang, "limit.creditOut"));
  else if (limit.credit) parts.push(t(lang, "limit.credit", { reason: limit.credit }));
  if (limit.plan) parts.push(t(lang, "limit.plan", { plan: limit.plan }));
  return parts.join(" ");
}
