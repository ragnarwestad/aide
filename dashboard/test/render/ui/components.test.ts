// Spec 252: the shared "← Back" primitives — `backLink()`'s markup and
// `resolveBackHref()`'s same-origin, token-stripping resolution of the
// standard `Referer` header. No render file had a test of its own for
// either shape before this.
import { describe, expect, test } from "bun:test";
import { backLink, resolveBackHref } from "../../../src/render/ui/components.ts";

describe("backLink", () => {
  test("a .btn anchor labelled ← Back, wrapped in the .intro spacing rule", () => {
    expect(backLink("/projects")).toBe('<p class="intro"><a class="btn" href="/projects">← Back</a></p>');
  });

  test("escapes its href", () => {
    expect(backLink("/?q=\"><script>")).not.toContain("<script>");
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
