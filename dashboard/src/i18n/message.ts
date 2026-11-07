// The composer every board message goes through at render time:
// a producer stores WHICH message and what fills its blanks, and
// this turns that into the reader's own language — never the other way
// round.

import type { Language } from "./translations.ts";
import { translations } from "./translations.ts";
import { MESSAGES, type MessageEntry, type MessageKey } from "./messages.ts";

export interface BoardMessage {
  key: MessageKey;
  values?: Record<string, string | number>;
  /** Another message, for a key whose text has a `{message}` blank: a
   *  landing failure says WHICH step's landing it was and then what
   *  went wrong, and the second half is itself a message. Kept as a
   *  message rather than flattened to text at the point it is stored,
   *  because there is no reader and no language there. */
  inner?: Sentence | Sentence[];
}

/** What a job field written before this spec still holds: plain
 *  English text, in the language it was always going to be — shown
 *  as-is, whatever `lang` the reader has picked. An ARRAY is what a
 *  landing across several repos can leave: more than one repo's own
 *  message, joined for the one row that reports both. */
export type Sentence = string | BoardMessage;

type Catalog = Record<string, MessageEntry>;

/** A message taken apart: the problem, its fix, and whether the message
 *  is in the two-line shape at all. A message that is not reads as the
 *  one text it was written as, in `problem`. */
interface Parts {
  problem: string;
  solution?: string;
  lines: boolean;
}

/** A sentence that FOLLOWS another one starts with a capital: joined
 *  with the one before it, a lower-case opening reads as the same
 *  sentence carrying on.
 *
 *  Only a first word that is nothing but letters is touched. A branch,
 *  a path or a file name is a name, and `aide/04-x` capitalised is a
 *  different branch — so anything holding a slash, a dot, a dash or a
 *  digit is left exactly as its own writer spelled it. */
function opensWithCapital(text: string): string {
  const first = text.split(/\s/)[0] ?? "";
  if (!/^\p{Ll}\p{L}*$/u.test(first)) return text;
  return text[0]!.toUpperCase() + text.slice(1);
}

/** Sentences joined into one run of text, each closed with a full stop. */
function joined(texts: string[]): string {
  return texts
    .map((t, i) => (i < texts.length - 1 && !/[.!?]$/.test(t) ? `${t}.` : t))
    .map((t, i) => (i === 0 ? t : opensWithCapital(t)))
    .join(" ");
}

/** The message's own text in one piece: two-line parts as the problem
 *  and its fix, the way a message not yet in that shape reads. */
const flat = (p: Parts): string => (p.lines && p.solution ? `${p.problem} — ${p.solution}` : p.problem);

function messageParts(lang: Language, m: BoardMessage, catalog: Catalog): Parts {
  const entry = catalog[m.key]!;
  const fill = (text: string): string => {
    let out = text;
    if (m.values) for (const [k, v] of Object.entries(m.values)) out = out.replaceAll(`{${k}}`, () => String(v));
    return out;
  };
  const lines = entry.solution !== undefined;
  let problem = fill(entry[lang]);
  let innerSolution: string | undefined;
  if (m.inner !== undefined) {
    const inner = sentenceParts(lang, m.inner, catalog);
    // A message in the two-line shape takes the problem of the one inside
    // it and keeps one fix; one that is not takes the inner one whole.
    problem = problem.replaceAll("{message}", () => (lines ? inner.problem : flat(inner)));
    innerSolution = inner.solution;
  }
  if (!lines) return { problem, lines };
  return { problem, solution: entry.solution ? fill(entry.solution[lang]) : innerSolution, lines };
}

function sentenceParts(lang: Language, s: Sentence | Sentence[], catalog: Catalog): Parts {
  if (Array.isArray(s)) {
    const parts = s.map((one) => sentenceParts(lang, one, catalog)).filter((p) => p.problem);
    const lines = parts.some((p) => p.lines);
    return {
      problem: joined(parts.map((p) => (lines ? p.problem : flat(p)))),
      solution: parts.find((p) => p.solution)?.solution,
      lines,
    };
  }
  return typeof s === "string" ? { problem: s, lines: false } : messageParts(lang, s, catalog);
}

/** The Problem line and, when there is a fix, the Solution line under it. */
function asLines(lang: Language, problem: string, solution: string | undefined): string {
  const label = translations[lang];
  const first = `${label["message.problem"]}: ${opensWithCapital(problem)}`;
  return solution ? `${first}\n${label["message.solution"]}: ${opensWithCapital(solution)}` : first;
}

export function renderMessage(lang: Language, m: BoardMessage, catalog: Catalog = MESSAGES): string {
  const p = messageParts(lang, m, catalog);
  if (p.lines) return asLines(lang, p.problem, p.solution);
  // A statement stands alone as a sentence of its own.
  return catalog[m.key]?.statement !== undefined ? opensWithCapital(p.problem) : p.problem;
}

export function renderSentence(
  lang: Language,
  s: Sentence | Sentence[] | undefined,
  catalog: Catalog = MESSAGES,
): string | undefined {
  if (s === undefined) return undefined;
  if (!Array.isArray(s)) return typeof s === "string" ? s : renderMessage(lang, s, catalog);
  const parts = s.map((one) => sentenceParts(lang, one, catalog)).filter((p) => p.problem);
  if (!parts.some((p) => p.lines)) return joined(parts.map(flat));
  // Messages that share a fix share one Solution line; a message with a
  // fix of its own gets a Problem and a Solution line of its own.
  const groups: { problems: string[]; solution?: string }[] = [];
  for (const p of parts) {
    const last = groups.at(-1);
    if (last && last.solution === p.solution) last.problems.push(p.problem);
    else groups.push({ problems: [p.problem], solution: p.solution });
  }
  return groups.map((g) => asLines(lang, joined(g.problems), g.solution)).join("\n");
}
