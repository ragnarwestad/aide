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
import { join } from "node:path";

// The EVALUATED stylesheet, not the source text: since spec 130 each
// palette is written once, in a constant the four token blocks
// interpolate, so the raw `.ts` file no longer has the colours where
// the sentinels are. Every check below that reads css.ts's CONTENT
// reads this string; the class-name checks further down still glob
// the render files as text, which is a different question.
export { CSS } from "../src/render/ui/css.ts";

export const ROOT = join(import.meta.dir, "..");

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
