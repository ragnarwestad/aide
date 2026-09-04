// The composer every board message goes through at render time (spec
// 380): a producer stores WHICH message and what fills its blanks, and
// this turns that into the reader's own language — never the other way
// round.

import type { Language } from "./translations.ts";
import { MESSAGES, type MessageKey } from "./messages.ts";

export interface BoardMessage {
  key: MessageKey;
  values?: Record<string, string | number>;
}

export function renderMessage(lang: Language, m: BoardMessage): string {
  let text: string = MESSAGES[m.key][lang];
  if (m.values) for (const [k, v] of Object.entries(m.values)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

/** What a job field written before this spec still holds (REQ-4): plain
 *  English text, in the language it was always going to be — shown
 *  as-is, whatever `lang` the reader has picked. An ARRAY is what a
 *  landing across several repos can leave: more than one repo's own
 *  message, joined for the one row that reports both. */
export type Sentence = string | BoardMessage;

export function renderSentence(lang: Language, s: Sentence | Sentence[] | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (Array.isArray(s)) return s.map((one) => renderSentence(lang, one)).filter((t): t is string => !!t).join("; ");
  return typeof s === "string" ? s : renderMessage(lang, s);
}
