// Shared test data for the css-token-guard suite, split by theme across
// css-guard-tokens.test.ts, css-guard-class-vocabulary.test.ts,
// css-guard-layout.test.ts and css-guard-select.test.ts (split out of
// css-token-guard.test.ts).
//
// The rule that stops the stylesheet drifting again.
//
// `css.ts` was the sum of one small addition per spec — ten font sizes
// with no scale, nine greys, and blue/amber/red from three unrelated
// palettes, each correct for its own feature and none looking at the
// page as a whole. Spec 102 replaced that with one token block and six
// components; this test is what keeps it that way. A spec that wants a
// look it cannot build from the tokens has to change the TOKENS —
// visibly, in the one block this test exempts — rather than add a
// colour beside them.
//
// Two rules, one file each side of them:
//
// 1. In `css.ts`, no colour literal and no font-size outside the token
//    block. The block is delimited by the sentinel comments below
//    rather than inferred, so the exemption is a thing you can see in
//    the source rather than a regex nobody re-reads.
// 2. In every render file, no CSS class that is not one of the
//    components, one of the named JS hooks, or one of the few
//    structural names on the list below. The list is deliberately
//    written out rather than pattern-matched: it is meant to be read
//    at a glance when it changes.
//
// Modelled on `source-is-text.test.ts`: glob, assert the glob found
// something, then one named test per file so bun's own output names
// the offender.
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The EVALUATED stylesheet, not the source text: since spec 130 each
// palette is written once, in a constant the four token blocks
// interpolate, so the raw `.ts` file no longer has the colours where
// the sentinels are. Every check below that reads css.ts's CONTENT
// reads this string; the class-name checks further down still glob
// the render files as text, which is a different question.
export { CSS, LOADING_CSS } from "../../src/render/ui/css";

export const ROOT = join(import.meta.dir, "..", "..");

export const RENDER_FILES = [...new Bun.Glob("src/render/**/*.ts").scanSync(ROOT)].sort();

export const TOKEN_START = "/* tokens:start */";
export const TOKEN_END = "/* tokens:end */";

/** Everything in `css.ts` that is NOT a token declaration. The token
 *  block may appear more than once — light and the dark override — and
 *  every one of them is exempt. */
export function outsideTokens(css: string): string {
  let out = "";
  let rest = css;
  for (;;) {
    const start = rest.indexOf(TOKEN_START);
    if (start === -1) return out + rest;
    out += rest.slice(0, start);
    const end = rest.indexOf(TOKEN_END, start);
    // An unclosed block would otherwise exempt the whole rest of the
    // file — the one way this guard could pass by accident.
    expect(end).toBeGreaterThan(start);
    rest = rest.slice(end + TOKEN_END.length);
  }
}

// `brand.ts` is the one exception, and it is not a stylesheet: the mark
// is a production SVG asset whose four bar colours ARE the brand, with
// their own dark-surface set. A token cannot be used inside a data URI.
export const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/g;

/** The token declarations that follow `opening`, as `name: value`
 *  pairs. Reads the block delimited by the sentinels, so it sees
 *  exactly what the guard above exempts. `opening` carries its own
 *  brace: the selectors are named in the prose above the rules too, and
 *  the first mention of one is a comment, not the rule. */
export function tokensAfter(css: string, opening: string): Record<string, string> {
  const at = css.indexOf(opening);
  expect(at).toBeGreaterThan(-1);
  const start = css.indexOf(TOKEN_START, at);
  const end = css.indexOf(TOKEN_END, start);
  expect(end).toBeGreaterThan(start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start + TOKEN_START.length, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+)/g)) {
    out[m[1]!] = m[2]!.trim();
  }
  expect(Object.keys(out).length).toBeGreaterThan(5);
  return out;
}

/** Every rule in the stylesheet, as its selector list and its body.
 *  Comments are stripped first: a selector named in prose is prose, and
 *  the counts below are about rules. (A rule inside `@media` carries the
 *  query in its selector list — good enough here, where every rule
 *  asked about is top-level.) */
export function rules(css: string): { selectors: string; body: string }[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.trim(),
    body: m[2]!.trim(),
  }));
}

/** The one rule the predicate picks out. Two matches is as much a
 *  failure as none: it means the look has two homes. */
export function oneRule(css: string, predicate: (r: { selectors: string; body: string }) => boolean) {
  const found = rules(css).filter(predicate);
  expect(found.length).toBe(1);
  return found[0]!;
}

// --- what the render and client files emit ---------------------------------

// The words after which a `/` opens a regex literal; after any other word
// (an identifier, a number, `this`…) it divides.
const REGEX_AFTER = /^(return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;

/** The text of every string and template literal in a TypeScript source,
 *  in order, with comments and code skipped and the code of a `${…}` read
 *  again the same way (a string nested in it counts). A template's text
 *  arrives in one piece per stretch between its substitutions. Throws on
 *  a literal that never ends, so a reader that lost its place fails loudly
 *  instead of finding nothing. */
export function stringTexts(source: string): string[] {
  const out: string[] = [];
  let i = 0;

  const fail = (what: string): never => {
    throw new Error(`stringTexts: unterminated ${what} at offset ${i}`);
  };

  // A `/` starts a regex unless what precedes it is a value. `w! / 2` is
  // a division: a `!` directly after an operand is the non-null assertion.
  const startsRegex = (at: number): boolean => {
    let j = at - 1;
    while (j >= 0 && /\s/.test(source[j]!)) j--;
    if (j < 0) return true;
    const c = source[j]!;
    if (c === "!" && j > 0 && /[\w)\]]/.test(source[j - 1]!)) return false;
    if (/[)\]}"'`]/.test(c)) return false;
    if (/[\w$]/.test(c)) {
      let k = j;
      while (k >= 0 && /[\w$]/.test(source[k]!)) k--;
      const word = source.slice(k + 1, j + 1);
      return REGEX_AFTER.test(word);
    }
    return true;
  };

  const quoted = (quote: string): void => {
    const start = ++i;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") i++;
      else if (source[i] === "\n") fail("string");
      i++;
    }
    if (i >= source.length) fail("string");
    out.push(source.slice(start, i));
    i++;
  };

  const template = (): void => {
    i++;
    let start = i;
    for (;;) {
      if (i >= source.length) fail("template literal");
      const c = source[i]!;
      if (c === "\\") i += 2;
      else if (c === "`") {
        out.push(source.slice(start, i));
        i++;
        return;
      } else if (c === "$" && source[i + 1] === "{") {
        out.push(source.slice(start, i));
        i += 2;
        code(true);
        start = i;
      } else i++;
    }
  };

  const regex = (): void => {
    i++;
    let inClass = false;
    while (i < source.length) {
      const c = source[i]!;
      if (c === "\n") fail("regex literal");
      if (c === "\\") i++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        i++;
        return;
      }
      i++;
    }
    fail("regex literal");
  };

  // Reads code until the end of the source, or, inside a `${`, until its
  // closing brace.
  const code = (inSubstitution: boolean): void => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i]!;
      const next = source[i + 1];
      if (c === "/" && next === "/") {
        while (i < source.length && source[i] !== "\n") i++;
      } else if (c === "/" && next === "*") {
        const end = source.indexOf("*/", i + 2);
        if (end === -1) fail("block comment");
        i = end + 2;
      } else if (c === '"' || c === "'") quoted(c);
      else if (c === "`") template();
      else if (c === "/") {
        if (startsRegex(i)) regex();
        else i++;
      } else if (c === "{") {
        depth++;
        i++;
      } else if (c === "}") {
        i++;
        if (inSubstitution && depth-- === 0) return;
      } else i++;
    }
    if (inSubstitution) fail("template substitution");
  };

  code(false);
  return out;
}

/** The words a set of sources emit as text, plus, for a piece that stops
 *  inside a `class="…` attribute on a hyphen (`class="badge b-${…}"`),
 *  that trailing prefix. A word is `[A-Za-z_][A-Za-z0-9_-]*` not preceded by
 *  a word character or a hyphen, so `aria-current` is one word and never
 *  counts as `current`. */
export function emittedWords(sources: string[]): Set<string> {
  const words = new Set<string>();
  for (const text of sources.flatMap(stringTexts)) {
    const openClass = /class="[^"]*$/.test(text);
    for (const m of text.matchAll(/(?<![A-Za-z0-9_-])[A-Za-z_][A-Za-z0-9_-]*/g)) {
      const word = m[0];
      if (!word.endsWith("-") || (openClass && m.index + word.length === text.length)) words.add(word);
    }
  }
  return words;
}

/** Whether `name` is among `words`; `b-idle` … `b-done` are built as
 *  `b-${state}`, so the `b-` prefix inside a class attribute stands for them. */
export function isEmittedIn(name: string, words: Set<string>): boolean {
  if (words.has(name)) return true;
  const dash = name.indexOf("-");
  return dash > 0 && name.startsWith("b-") && words.has("b-");
}

const EMITTING_FILES = [
  ...new Bun.Glob("src/render/**/*.ts").scanSync(ROOT),
  ...new Bun.Glob("src/specs-client/**/*.ts").scanSync(ROOT),
].sort();

let emitted: Set<string> | undefined;

/** Whether a render or specs-client file emits `name`. */
export function isEmitted(name: string): boolean {
  emitted ??= emittedWords(EMITTING_FILES.map((f) => readFileSync(join(ROOT, f), "utf-8")));
  return isEmittedIn(name, emitted);
}

/** Every class a selector in the stylesheet names. Strings inside an
 *  attribute selector are dropped first: `[href$=".pdf"]` names no class. */
export function selectorClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const { selectors } of rules(css)) {
    for (const m of selectors.replace(/"[^"]*"|'[^']*'/g, "").matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      out.add(m[1]!);
    }
  }
  return out;
}

/** The rules whose every selector names a class nothing emits. One
 *  selector that names no class at all (`table`, `from`) keeps its rule
 *  alive, and so does one selector out of a list that matches something. */
export function deadRules(css: string, emits: (name: string) => boolean = isEmitted): string[] {
  const dead: string[] = [];
  for (const { selectors } of rules(css)) {
    if (selectors.startsWith("@")) continue;
    const each = selectors.split(",").map((s) => s.trim()).filter(Boolean);
    const isDead = (selector: string) =>
      [...selector.replace(/"[^"]*"|'[^']*'/g, "").matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].some((m) => !emits(m[1]!));
    if (each.length > 0 && each.every(isDead)) dead.push(selectors);
  }
  return dead;
}
