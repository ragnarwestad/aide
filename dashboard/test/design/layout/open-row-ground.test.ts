// An open spec's own lines paint no ground of their own, at any width.
//
// The faint ground they carried until 2026-09-22 greyed the message
// cards the open row draws inside it and hid the fold control's hover,
// which is drawn in that same colour. Both the desktop rules and the
// phone block are checked here, since each used to paint it in its own
// way: the desktop on the cells, the phone on the rows.
import { describe, expect, test } from "bun:test";
import { CSS } from "../../../src/render/ui/css";

/** The phone block's own text — the same brace-matched read
 *  `responsive.test.ts` makes, kept here so this file stands alone. */
function phoneBlock(css: string): string {
  const opening = "@media (max-width: 40rem) {";
  const at = css.indexOf(opening);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = at + opening.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at + opening.length, i);
  }
  throw new Error("the phone media query is never closed");
}

describe("an open row paints no ground of its own (spec 520, AC-2)", () => {
  test("neither the phase lines nor their message rows take a background", () => {
    expect(CSS).not.toMatch(/table\.list tr\.subrow td[^{]*\{[^}]*background: var\(--surface-2\)/);
    const narrow = phoneBlock(CSS);
    expect(narrow).not.toMatch(/table\.list tr\.subrow,[^{]*\{[^}]*background: var\(--surface-2\)/);
    expect(narrow).not.toMatch(/tr\.specnotice[^{]*\{[^}]*background: var\(--surface-2\)/);
  });
});
