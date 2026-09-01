// Split out of css-token-guard.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { CSS, RENDER_FILES, COLOUR, outsideTokens, tokensAfter } from "./css-guard-fixtures.ts";

describe("css.ts uses tokens and nothing else", () => {
  test("the stylesheet is where the test thinks it is", () => {
    expect(RENDER_FILES).toContain("src/render/ui/css.ts");
  });

  test("no colour literal outside the token block", () => {
    expect([...outsideTokens(CSS).matchAll(COLOUR)].map((m) => m[0])).toEqual([]);
  });

  test("no font-size outside the token block that is not a scale step", () => {
    const sizes = [...outsideTokens(CSS).matchAll(/font-size:\s*([^;}]+)/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(sizes.filter((v) => !/^var\(--fs-[a-z]+\)$/.test(v))).toEqual([]);
  });

  test("no raw length inside a font shorthand outside the token block", () => {
    const fonts = [...outsideTokens(CSS).matchAll(/(?<![-a-z])font:\s*([^;}]+)/g)].map((m) =>
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

describe("an explicit theme is the same ramp, not a third one", () => {
  test("the chosen Dark is exactly what the machine's dark preference gives", () => {
    expect(tokensAfter(CSS, ':root[data-theme="dark"] {')).toEqual(
      tokensAfter(CSS, "@media (prefers-color-scheme: dark) {"),
    );
  });

  test("the chosen Light is exactly the default set, colour for colour", () => {
    // The light block only looks redundant. It is an ATTRIBUTE selector
    // and the dark preference above is a bare `:root` inside a media
    // query, so this is the one rule that keeps an explicit Light on a
    // machine set to dark. The default set is the top of the file, and
    // the size/space tokens live there and nowhere else, so compare on
    // the colours the two have in common.
    const chosen = tokensAfter(CSS, ':root[data-theme="light"] {');
    const base = tokensAfter(CSS, ":root {");
    for (const [name, value] of Object.entries(chosen)) expect([name, base[name]]).toEqual([name, value]);
  });

  test("neither block sits inside a media query, which is what would sink it", () => {
    // A `@media` block between the selector and the end of the
    // stylesheet is fine; one that OPENS before it and has not closed
    // is not — the choice would then apply only when the machine
    // already agreed with it.
    for (const selector of [':root[data-theme="dark"] {', ':root[data-theme="light"] {']) {
      const before = CSS.slice(0, CSS.indexOf(selector));
      const opened = (before.match(/@media[^{]*\{/g) ?? []).length;
      const braces = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
      expect([selector, opened > 0 && braces > 0]).toEqual([selector, false]);
    }
  });
});

// --- refused is not a shade of running (spec 130) ---------------------------
//
// The file's own header says danger is carried by the darkest bar of
// the mark and NOT by a shade of the accent, so the two states never
// rest on hue alone. Dark had both `--danger` and `--accent-strong` on
// `#F5B7A3` all the same, and nothing here noticed. Named pair, not a
// blanket "no two tokens share a value" rule: dark's `--bg` and
// `--on-accent` are deliberately the same colour — dark text on the
// peach accent is what `--on-accent` is for — and a blanket rule would
// make that pair a failure.

describe("running and refused never share a colour", () => {
  // The two explicit blocks are enough: the equality tests above tie
  // the machine's preference and the bare `:root` default to these.
  for (const theme of ["dark", "light"]) {
    test(`${theme}: --danger is not --accent-strong`, () => {
      const tokens = tokensAfter(CSS, `:root[data-theme="${theme}"] {`);
      expect([theme, tokens["--danger"] === tokens["--accent-strong"]]).toEqual([theme, false]);
    });
  }
});

// --- one width, one owner (spec 130) ---------------------------------------
//
// `main` carried a `max-width` of its own that the frame rule below it
// overrode at equal specificity — a declaration that had not applied
// since the frame was centred, and read like the answer to "how wide
// is the page" while not being it.

describe("the page's width comes from the frame rule alone", () => {
  test("main declares no max-width of its own", () => {
    const rule = CSS.match(/^main\s*\{([^}]*)\}/m)?.[1] ?? "";
    // A `main` rule that vanished entirely would pass the line below
    // without protecting anything.
    expect(rule).toContain("padding");
    expect(rule).not.toContain("max-width");
    // and the frame rule, which is the one that actually decides it.
    // `calc(...)` as well as a bare `<n>rem`: spec 325 compensates the
    // cap for the padding `box-sizing: border-box` now subtracts, and
    // what this guards is WHERE the width is declared, not its shape.
    expect(CSS).toMatch(/header, body > nav\.tabbar, main \{[^}]*max-width: (?:\d+rem|calc\()/);
  });
});

// --- one class, one home (spec 130) ----------------------------------------

describe("a class is declared in one place", () => {
  test(".spec-name is declared once per context: the base, and one mobile override", () => {
    // Two rules for one class is how a class starts having two homes:
    // the next reader changes the first one and never sees the second.
    // (`.spec-name > .label` is a different selector and does not count.)
    // Exactly one lives OUTSIDE the phone media query; the second is
    // that block's own override (2026-08-24) — a third anywhere is the
    // drift this test exists to catch.
    const base = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect((base.match(/\.spec-name\s*\{/g) ?? []).length).toBe(1);
    expect((CSS.match(/\.spec-name\s*\{/g) ?? []).length).toBe(2);
  });
});
