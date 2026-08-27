// Split out of css-token-guard.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { CSS, outsideTokens, tokensAfter, oneRule } from "./css-guard-fixtures.ts";

// --- the select is ours (spec 156) ------------------------------------------
//
// `appearance: none` is what stops the platform drawing its own control
// on top of ours, and it drags three things behind it: a chevron we
// have to draw, a focus ring we have to draw, and a disabled look we
// have to draw. Each of the four reads as optional polish and is not —
// drop any one and a select goes back to being the operating system's.
//
// Two of the four selects on the site are NOT inside a `.field`:
// `modelPicker()` renders into `<span class="row">` and `toolPicker()`
// into `<label class="muted small">` (`queue-list.ts`). They are
// addressed by attribute instead, and a selector list that quietly
// narrowed back to `.field select` alone would pass every other check
// here while leaving both showing the platform chevron — which is the
// motivating example, a model picker disabled for the length of a run.
// Hence the tests that read the selector LIST and not only the body.

describe("a select is drawn by us, not by the platform (spec 156)", () => {
  test("the chevron is a token, not a literal beside one", () => {
    // The `COLOUR` regex above does not catch a percent-encoded `%23`,
    // so the data URI needs an assertion of its own: a URI outside the
    // sentinels is exactly the literal this file exists to refuse.
    expect(outsideTokens(CSS)).not.toContain("data:image/svg+xml");
  });

  test("both themes carry a chevron, and the two are not the same arrow", () => {
    const light = tokensAfter(CSS, ':root[data-theme="light"] {')["--chevron"];
    const dark = tokensAfter(CSS, ':root[data-theme="dark"] {')["--chevron"];
    expect([typeof light, typeof dark]).toEqual(["string", "string"]);
    // Equal would mean one theme's arrow drawn in the other's colour —
    // a light arrow on a light control, which is the bug this fixes.
    expect(light).not.toEqual(dark);
  });

  test("the select is ours: appearance is reset, and we draw the arrow", () => {
    // "select" in the selector list, not just the body: the search
    // field's own appearance: none (2026-08-25, native search-field
    // chrome) is a second rule with the identical body text now.
    const rule = oneRule(CSS, (r) => r.body.includes("appearance: none") && r.selectors.includes("select"));
    // Safari has historically wanted the prefixed form spelled out.
    expect(rule.body).toContain("-webkit-appearance: none");
    expect(rule.body).toContain("background-image: var(--chevron)");
    // The arrow needs room of its own, or it sits over the end of a
    // long option label instead of beside it.
    expect(rule.body).toMatch(/padding-right:\s*\d+px/);
  });

  test("the model select and the AI select are ours too", () => {
    // Neither has a `.field` ancestor, so `.field select` alone reaches
    // neither of them.
    const rule = oneRule(CSS, (r) => r.body.includes("appearance: none") && r.selectors.includes("select"));
    expect(rule.selectors).toContain(".field select");
    expect(rule.selectors).toContain('select[name^="model."]');
    expect(rule.selectors).toContain("select[data-ai]");
    // The control this one replaced (spec 179) is gone from the
    // stylesheet as well as from the markup.
    expect(CSS).not.toContain("data-set-all");
  });

  test("the two selects get the whole field look, not only the arrow", () => {
    // They are in no `.field`, so until this spec they carried no
    // height, border, background or colour from the design system at
    // all — the base rule has to name them as well.
    const rule = oneRule(CSS, (r) => r.selectors.includes(".field input,"));
    expect(rule.selectors).toContain('select[name^="model."]');
    expect(rule.selectors).toContain("select[data-ai]");
  });

  test("there is one focus rule, it is :focus-visible, and it is the accent", () => {
    // One rule for everything focusable — not one per component, which
    // is how the page ended up with no focus style at all and every
    // control focusing in the browser's blue. `:focus` rather than
    // `:focus-visible` would leave a ring behind after a mouse press.
    //
    // `:focus-within` (spec 263) is excluded on purpose: it drives the
    // search field's own width on phone, not an outline, so it is not
    // one of the "everything focusable" rules this test counts.
    const rule = oneRule(CSS, (r) => r.selectors.includes(":focus") && !r.selectors.includes(":focus-within"));
    expect(rule.selectors).toBe(":focus-visible");
    expect(rule.body).toContain("outline: 2px solid var(--accent)");
  });

  test("a disabled field reads as unavailable, and so do the two selects", () => {
    // `.btn:disabled` has had `opacity: 0.45` since spec 102; a field
    // had nothing, so a model picker disabled for the length of a run
    // still read as pressable and its reason lived only in a `title`.
    const rule = oneRule(CSS, (r) => r.selectors.includes(".field input:disabled"));
    expect(rule.selectors).toContain(".field select:disabled");
    expect(rule.selectors).toContain(".field textarea:disabled");
    expect(rule.selectors).toContain('select[name^="model."]:disabled');
    expect(rule.selectors).toContain("select[data-ai]:disabled");
    // `background-color`, not the `background` shorthand: the shorthand
    // would drop the ground the base rule sets.
    expect(rule.body).toContain("background-color: var(--surface-2)");
    expect(rule.body).toContain("color: var(--muted)");
  });

  // The AI select is deliberately NOT in this rule (spec 179). It is
  // the one place the two controls beside each other differ, and the
  // difference is what they hold: a model name is a value, like a spec
  // id or a branch name; "Claude Code" is a thing's NAME, which the
  // project and checkout pickers already keep in the sans face. The
  // chrome — border, height, arrow, disabled look — is identical, and
  // that is what makes the pair read as a pair.
  test("a model name is a value, so it is set in mono like every other one", () => {
    const rule = oneRule(
      CSS,
      (r) => r.body.includes("font-family: var(--mono)") && r.selectors.includes("select["),
    );
    expect(rule.selectors).toContain('select[name^="model."]');
    expect(rule.selectors).not.toContain("select[data-ai]");
    // Mono runs wider at the same nominal size, and these sit in a
    // pinned table column.
    expect(rule.body).toContain("font-size: var(--fs-s)");
  });
});
