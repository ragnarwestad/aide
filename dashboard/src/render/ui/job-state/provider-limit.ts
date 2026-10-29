// The usage limit that stopped a step, as one sentence: which AI and
// model, which window ran out and when it starts over, and whatever else
// the tool said beside it. Every part is the tool's own record
// (`StepResult.providerLimit`) — the model is spent by the time this is
// read, so nothing here may ask it anything.

import { t, type Language, type TranslationKey } from "../../../i18n";
import { renderMessage } from "../../../i18n/message.ts";
import type { ProviderLimit } from "../../../queue/queue.ts";
import { stepLabel } from "../components";
import { currentStep } from "./format.ts";
import type { QueueRowView } from "./types.ts";

const TOOL_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode" };

export const windowPhrase = (name: string, lang: Language): string => {
  if (name === "five_hour" || name === "seven_day") return t(lang, `limit.window.${name}` as TranslationKey);
  const minutes = /^(\d+)_minutes$/.exec(name);
  return minutes ? t(lang, "limit.window.minutes", { minutes: minutes[1]! }) : t(lang, "limit.window.other");
};

export const capitalizeFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// The `Intl.DateTimeFormat` locale for each language's own date/time
// conventions.
const LOCALES: Record<Language, string> = {
  en: "en-GB", nb: "nb-NO", es: "es-ES", de: "de-DE", fr: "fr-FR",
};

/** A reset later today reads as a clock time; any other day carries the
 *  day as well. `timeZone` is the server's own unless a caller names one
 *  — the page is drawn on the serving host, in its reader's zone. */
export function when(iso: string, now: number, lang: Language, timeZone?: string): string {
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

/** The AI a limit belongs to, with its model when it has one. */
const limitWho = (tool: string, model: string | undefined): string => {
  const name = TOOL_NAMES[tool] ?? tool;
  return model ? `${name} (${model})` : name;
};

export function providerLimitSentence(
  limit: ProviderLimit,
  model: string | undefined,
  lang: Language,
  now: number = Date.now(),
  timeZone?: string,
): string {
  const who = limitWho(limit.tool, model);
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

const HELD_FOR_USAGE_LIMIT = new Set(["runner.usageLimitHeld", "runner.usageLimitHeldNoReset", "runner.usageLimitHeldProbe"]);

/** The one sentence a used-up usage limit puts on a job, when it has one:
 *  the stopped job that starts again by itself, or a queued job held
 *  behind it. The times are stored plain and put in the reader's language
 *  here; any other job gets nothing. */
export function usageLimitText(
  view: Pick<QueueRowView, "state" | "stopReason" | "usageLimitWait" | "results" | "steps" | "stepIndex" | "stepModels" | "model" | "error">,
  lang: Language,
  now: number,
  timeZone?: string,
): string | undefined {
  if (view.state === "stopped" && view.stopReason === "provider-limit" && view.usageLimitWait) {
    const record = [...(view.results ?? [])].reverse().find((r) => r.providerLimit);
    const step = record?.step ?? currentStep(view);
    const model = (record?.step && view.stepModels?.[record.step]) || view.model;
    return renderMessage(lang, {
      key: view.usageLimitWait.resetKnown ? "runner.usageLimitRestarts" : "runner.usageLimitRestartsNoReset",
      values: {
        who: record?.providerLimit ? limitWho(record.providerLimit.tool, model) : (model ?? "AI"),
        limit: windowPhrase(record?.providerLimit?.window ?? "", lang),
        step: stepLabel(step, lang),
        at: when(view.usageLimitWait.until, now, lang, timeZone),
      },
    });
  }
  const error = view.error;
  if (view.state === "queued" && error && typeof error === "object" && !Array.isArray(error) && HELD_FOR_USAGE_LIMIT.has(error.key)) {
    const tool = String(error.values?.tool ?? "");
    return renderMessage(lang, {
      key: error.key,
      values: { tool: TOOL_NAMES[tool] ?? tool, at: when(String(error.values?.at ?? ""), now, lang, timeZone) },
    });
  }
  return undefined;
}
