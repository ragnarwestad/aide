// The composer every board message goes through at render time:
// a producer stores WHICH message and what fills its blanks, and
// this turns that into the reader's own language — never the other way
// round.

import { gerund } from "../format/gerund.ts";
import type { Language } from "../i18n/translations.ts";
import { translations } from "../i18n/translations.ts";
import { MESSAGES, type MessageEntry, type MessageKey } from "./catalog.ts";

import type { BoardMessage, Sentence } from "./types.ts";
export type { BoardMessage, Sentence } from "./types.ts";

const PRESENTATION_WRAPPERS = new Set<MessageKey>(["message.lead", "landing.stepStopped", "landing.stepFailed"]);

/** A language-independent identity for one underlying board event. */
export function messageIdentity(sentence: Sentence | Sentence[] | undefined): string | undefined {
  if (sentence === undefined || typeof sentence === "string") return undefined;
  if (Array.isArray(sentence)) {
    const identities = sentence.map(messageIdentity).filter((value): value is string => value !== undefined);
    return identities.length === 1 ? identities[0] : identities.length ? JSON.stringify(identities) : undefined;
  }
  if (PRESENTATION_WRAPPERS.has(sentence.key) && sentence.inner !== undefined) return messageIdentity(sentence.inner);
  const values = Object.entries(sentence.values ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([sentence.key, values]);
}

/** The original list items belonging to a message, one item per line. */
export function messageDetail(sentence: Sentence | Sentence[] | undefined): string | undefined {
  if (sentence === undefined || typeof sentence === "string") return undefined;
  if (Array.isArray(sentence)) {
    const details = sentence.map(messageDetail).filter((value): value is string => value !== undefined);
    return details.length ? details.join("\n") : undefined;
  }
  const legacyTests = sentence.key.startsWith("landing.testsRedOnMerge") && typeof sentence.values?.tests === "string"
    ? sentence.values.tests.split("; ").filter(Boolean)
    : [];
  const own = [
    ...Object.values(sentence.lists ?? {}).flat(),
    ...Object.values(sentence.values ?? {}).filter((value): value is string[] => Array.isArray(value)).flat(),
    ...legacyTests,
  ];
  const nested = messageDetail(sentence.inner);
  const items = [...own, ...(nested ? nested.split("\n") : [])];
  return items.length ? items.join("\n") : undefined;
}

type Catalog = Record<string, MessageEntry>;

/** A message taken apart: the problem, its fix, and whether the message
 *  is in the two-line shape at all. A message that is not reads as the
 *  one text it was written as, in `problem`. */
interface Parts {
  problem: string;
  solution?: string;
  lines: boolean;
  information?: boolean;
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
    if (m.values) for (const [k, v] of Object.entries(m.values)) {
      const value = k === "doing" && typeof v === "string" ? gerund(lang, v).toLowerCase() : v;
      out = out.replaceAll(`{${k}}`, () => String(Array.isArray(value) ? value.length : value));
    }
    const legacyTests = m.values?.tests;
    if (out.includes("{count}") && typeof legacyTests === "string") {
      out = out.replaceAll("{count}", () => String(legacyTests.split("; ").filter(Boolean).length));
    }
    return out;
  };
  let lines = entry.solution !== undefined;
  let information = entry.statement !== undefined;
  let problem = fill(entry[lang]);
  let innerSolution: string | undefined;
  if (m.inner !== undefined) {
    const inner = sentenceParts(lang, m.inner, catalog);
    if (m.key === "message.lead" && inner.information) {
      lines = false;
      information = true;
    }
    // A message in the two-line shape takes the problem of the one inside
    // it and keeps one fix; one that is not takes the inner one whole.
    problem = problem.replaceAll("{message}", () => (lines ? inner.problem : flat(inner)));
    innerSolution = inner.solution;
  }
  if (!lines) return { problem, lines, information };
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
      information: parts.every((p) => p.information),
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

export function formatMessage(lang: Language, m: BoardMessage, catalog: Catalog = MESSAGES): string {
  const p = messageParts(lang, m, catalog);
  if (p.lines) return asLines(lang, p.problem, p.solution);
  // A statement stands alone as a sentence of its own.
  return catalog[m.key]?.statement !== undefined ? opensWithCapital(p.problem) : p.problem;
}

export function formatSentence(
  lang: Language,
  s: Sentence | Sentence[] | undefined,
  catalog: Catalog = MESSAGES,
): string | undefined {
  if (s === undefined) return undefined;
  if (!Array.isArray(s)) return typeof s === "string" ? s : formatMessage(lang, s, catalog);
  const parts = s.map((one) => sentenceParts(lang, one, catalog)).filter((p) => p.problem);
  if (!parts.some((p) => p.lines)) return joined(parts.map(flat));
  // Messages that share a fix share one Solution line; a message with a
  // fix of its own gets a Problem and a Solution line of its own.
  const groups: { problems: string[]; solution?: string; information: boolean }[] = [];
  for (const p of parts) {
    const last = groups.at(-1);
    if (last && last.solution === p.solution && last.information === !!p.information) last.problems.push(p.problem);
    else groups.push({ problems: [p.problem], solution: p.solution, information: !!p.information });
  }
  return groups.map((g) => g.information ? joined(g.problems.map(opensWithCapital)) : asLines(lang, joined(g.problems), g.solution)).join("\n");
}
