// Spec 252: the shared "← Back" primitives — `backLink()`'s markup and
// `resolveBackHref()`'s same-origin, token-stripping resolution of the
// standard `Referer` header. No render file had a test of its own for
// either shape before this.
import { describe, expect, test } from "bun:test";
import { backLink, resolveBackHref } from "../../../src/render/ui/components.ts";
import { CSS } from "../../../src/render/ui/css.ts";

describe("backLink", () => {
  test("a .backlink anchor labelled ← Back, wrapped in the .intro spacing rule", () => {
    expect(backLink("/projects")).toBe('<p class="intro"><a class="backlink" href="/projects">← Back</a></p>');
  });

  test("escapes its href", () => {
    expect(backLink("/?q=\"><script>")).not.toContain("<script>");
  });

  // Spec 296: given a title, the "← Back" control and the page's own
  // <h1> sit in one row, the title after the link, rather than each on
  // its own block-level line.
  test("given a title, draws it beside ← Back in one .backhead row (spec 296)", () => {
    expect(backLink("/projects", "Add project")).toBe(
      '<div class="backhead"><a class="backlink" href="/projects">← Back</a><h1>Add project</h1></div>',
    );
  });

  test("escapes its title", () => {
    expect(backLink("/projects", "<script>")).not.toContain("<script>");
  });
});

// Spec 296, REQ-2: the CSS-level half of "separated by enough space
// that the two do not read as one run of text" — a rule that actually
// lays "← Back" and the title out on one row.
describe(".backhead CSS rule", () => {
  test("bundled CSS declares .backhead as a flex row with a non-zero gap", () => {
    const rule = CSS.match(/\.backhead\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("display: flex");
    expect(rule).toMatch(/gap:\s*(?!0)\S/);
  });
});

describe("resolveBackHref", () => {
  const ORIGIN = "https://dash.example";

  test("a same-origin referer is kept — path and query survive", () => {
    expect(resolveBackHref(`${ORIGIN}/?state=all&q=archive`, ORIGIN, "/")).toBe("/?state=all&q=archive");
  });

  test("no referer at all falls back", () => {
    expect(resolveBackHref(null, ORIGIN, "/fallback")).toBe("/fallback");
  });

  // Criterion 5.
  test("a foreign-origin referer is discarded, not followed", () => {
    expect(resolveBackHref("https://evil.example/", ORIGIN, "/fallback")).toBe("/fallback");
  });

  // Criterion 6.
  test("a same-origin referer carrying token= has it stripped", () => {
    expect(resolveBackHref(`${ORIGIN}/specs/aide/01-first?token=s3cret`, ORIGIN, "/")).toBe(
      "/specs/aide/01-first",
    );
  });

  test("a malformed referer falls back rather than throwing", () => {
    expect(resolveBackHref("not a url", ORIGIN, "/fallback")).toBe("/fallback");
  });
});
