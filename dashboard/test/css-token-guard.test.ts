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
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const RENDER_FILES = [...new Bun.Glob("src/render/*.ts").scanSync(ROOT)].sort();

const TOKEN_START = "/* tokens:start */";
const TOKEN_END = "/* tokens:end */";

/** Everything in `css.ts` that is NOT a token declaration. The token
 *  block may appear more than once — light and the dark override — and
 *  every one of them is exempt. */
function outsideTokens(css: string): string {
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
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/g;

describe("css.ts uses tokens and nothing else", () => {
  test("the stylesheet is where the test thinks it is", () => {
    expect(RENDER_FILES).toContain("src/render/css.ts");
  });

  test("no colour literal outside the token block", async () => {
    const css = await Bun.file(join(ROOT, "src/render/css.ts")).text();
    expect([...outsideTokens(css).matchAll(COLOUR)].map((m) => m[0])).toEqual([]);
  });

  test("no font-size outside the token block that is not a scale step", async () => {
    const css = await Bun.file(join(ROOT, "src/render/css.ts")).text();
    const sizes = [...outsideTokens(css).matchAll(/font-size:\s*([^;}]+)/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(sizes.filter((v) => !/^var\(--fs-[a-z]+\)$/.test(v))).toEqual([]);
  });

  test("no raw length inside a font shorthand outside the token block", async () => {
    const css = await Bun.file(join(ROOT, "src/render/css.ts")).text();
    const fonts = [...outsideTokens(css).matchAll(/(?<![-a-z])font:\s*([^;}]+)/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(fonts.filter((v) => /\d+(px|rem|em)\b/.test(v))).toEqual([]);
  });
});

// --- the theme a reader chose (spec 107) ------------------------------------
//
// Four token blocks now, not two: the machine's preference, and the
// same two sets again as an explicit choice. That repetition is what a
// reader is most likely to "tidy up" — the light block especially,
// which looks redundant beside the default `:root` until you notice it
// is the only thing that survives a machine set to dark. These tests
// say what each block is FOR, so deleting one fails with a reason
// rather than with a colour nobody can reproduce.

/** The token declarations that follow `opening`, as `name: value`
 *  pairs. Reads the block delimited by the sentinels, so it sees
 *  exactly what the guard above exempts. `opening` carries its own
 *  brace: the selectors are named in the prose above the rules too, and
 *  the first mention of one is a comment, not the rule. */
function tokensAfter(css: string, opening: string): Record<string, string> {
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

describe("an explicit theme is the same ramp, not a third one", () => {
  test("the chosen Dark is exactly what the machine's dark preference gives", async () => {
    const css = await Bun.file(join(ROOT, "src/render/css.ts")).text();
    expect(tokensAfter(css, ':root[data-theme="dark"] {')).toEqual(
      tokensAfter(css, "@media (prefers-color-scheme: dark) {"),
    );
  });

  test("the chosen Light is exactly the default set, colour for colour", async () => {
    const css = await Bun.file(join(ROOT, "src/render/css.ts")).text();
    // The light block only looks redundant. It is an ATTRIBUTE selector
    // and the dark preference above is a bare `:root` inside a media
    // query, so this is the one rule that keeps an explicit Light on a
    // machine set to dark. The default set is the top of the file, and
    // the size/space tokens live there and nowhere else, so compare on
    // the colours the two have in common.
    const chosen = tokensAfter(css, ':root[data-theme="light"] {');
    const base = tokensAfter(css, ":root {");
    for (const [name, value] of Object.entries(chosen)) expect([name, base[name]]).toEqual([name, value]);
  });

  test("neither block sits inside a media query, which is what would sink it", async () => {
    const css = await Bun.file(join(ROOT, "src/render/css.ts")).text();
    // A `@media` block between the selector and the end of the
    // stylesheet is fine; one that OPENS before it and has not closed
    // is not — the choice would then apply only when the machine
    // already agreed with it.
    for (const selector of [':root[data-theme="dark"] {', ':root[data-theme="light"] {']) {
      const before = css.slice(0, css.indexOf(selector));
      const opened = (before.match(/@media[^{]*\{/g) ?? []).length;
      const braces = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
      expect([selector, opened > 0 && braces > 0]).toEqual([selector, false]);
    }
  });
});

// --- the class vocabulary ---------------------------------------------------

/** The six components and their documented modifiers. Anything a page
 *  wants to look like has to be one of these. */
const COMPONENTS = [
  "btn", "primary", "ok", "danger", "busy", "spin",
  "badge", "b-idle", "b-running", "b-waiting", "b-ready", "b-refused", "b-done", "dot",
  "phases", "phase", "default", "checked", "done", "off", "box",
  "rowmsg", "err", "warn", "info",
  "field", "wide",
  "filters",
];

/** Class names `queue-client.ts` selects on or writes. They carry no
 *  styling of their own — renaming one silently breaks Run, Approve,
 *  Cancel, Merge or the refusal display in a browser, with no type
 *  error to catch it. */
const JS_HOOKS = [
  "rowrun", "actionform", "mergeform", "resolveform",
  "refused", "refusal", "newspec", "newspecform",
  // spec 112: the Projects panel — the Add form and one Remove per
  // allowlisted project.
  "projectadmin", "addprojectform", "removeform",
];

/** Structure and layout: what a thing IS on the page, not what it looks
 *  like. Short on purpose — a new entry here is a decision, and it
 *  shows up in the diff as one. */
const STRUCTURE = [
  // the frame
  "layout", "pagehead", "stamp", "brand", "mark", "mark-l", "mark-d", "current", "lbl",
  // text roles
  "small", "muted", "num", "label", "desc", "summary", "counts", "specdesc",
  // containers
  "row", "fact", "intro", "tabpanel", "activity", "facts", "more",
  // the spec list
  "list", "spechead", "subrow", "phasecell", "spec-name", "spec-title",
  "untried", "empty", "listnote", "fold", "shut", "sortlink", "on", "asc",
  "branchlist", "branch",
  "pips", "pip", "now", "past", "todo",
  // a spec row's own state — deliberately NOT `active`/`archived`,
  // which `site.ts` uses for the unrelated question of whether a spec
  // folder has been archived on disk.
  "run-new", "run-live", "run-past",
  // and site.ts's answer to that other question
  "spec-open", "spec-archived",
  // the project overview
  "proj-row", "error-text", "error",
];

const ALLOWED = new Set([...COMPONENTS, ...JS_HOOKS, ...STRUCTURE]);

/** Every class name a render file writes into markup. `${...}` is
 *  replaced first: a fragment built from an expression is skipped, so
 *  the check is on the literal vocabulary. The expressions themselves
 *  are all in `components.ts`, where the variant unions are typed and a
 *  bogus one is a compile error rather than a class nobody notices. */
function classesIn(source: string): string[] {
  const flat = source.replace(/\$\{[^}]*\}/g, "«»");
  const attrs = [
    ...flat.matchAll(/class="([^"]*)"/g),
    ...flat.matchAll(/className\s*=\s*"([^"]*)"/g),
  ];
  return attrs
    .flatMap((m) => m[1]!.split(/\s+/))
    .filter((c) => c && !c.includes("«"));
}

describe("render files use the component vocabulary and nothing else", () => {
  test("the glob found the render files at all", () => {
    expect(RENDER_FILES.length).toBeGreaterThan(4);
  });

  for (const file of RENDER_FILES) {
    test(`${file} introduces no class of its own`, async () => {
      const source = await Bun.file(join(ROOT, file)).text();
      const unknown = [...new Set(classesIn(source))].filter((c) => !ALLOWED.has(c));
      expect(unknown).toEqual([]);
    });
  }

  test("the browser code writes no class of its own either", async () => {
    const source = await Bun.file(join(ROOT, "src/queue-client.ts")).text();
    const unknown = [...new Set(classesIn(source))].filter((c) => !ALLOWED.has(c));
    expect(unknown).toEqual([]);
  });
});
