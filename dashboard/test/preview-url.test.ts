// Criterion 5: a spec branch is `aide/<spec-folder>` — it always
// contains a `/`, which is not a character a hostname label may carry.
// The one place that rule lives is `previewUrlFor`, so the one place it
// is checked is here.
import { describe, expect, test } from "bun:test";
import { previewUrlFor } from "../src/git/preview-url.ts";

const TEMPLATE = "https://{branch}.example.pages.dev";

describe("previewUrlFor", () => {
  test("substitutes the branch into the template", () => {
    expect(previewUrlFor(TEMPLATE, "aide/95-x")).toBe("https://aide-95-x.example.pages.dev");
  });

  test("no template means no preview", () => {
    expect(previewUrlFor(undefined, "aide/95-x")).toBeUndefined();
    expect(previewUrlFor("", "aide/95-x")).toBeUndefined();
  });

  test("lowercases the branch name", () => {
    expect(previewUrlFor(TEMPLATE, "Aide/95-X")).toBe("https://aide-95-x.example.pages.dev");
  });

  // A run of anything that is not a letter or a digit is ONE dash, not
  // one dash each: `feat//a__b` is a name a person can type, and
  // `feat---a--b` is not an address.
  test("collapses every run of non-alphanumeric characters to a single dash", () => {
    expect(previewUrlFor(TEMPLATE, "feat//a__b.c")).toBe("https://feat-a-b-c.example.pages.dev");
  });

  // Cloudflare Pages cuts a branch alias at 28 characters; a spec branch
  // (`aide/95-preview-link-on-the-row`) is longer than that, so a link
  // built from the full name would point at nothing. The cut happens
  // before the trailing dash is trimmed, so a name cut on a dash still
  // ends in a letter or digit.
  test("cuts the label at 28 characters, then trims a trailing dash", () => {
    expect(previewUrlFor(TEMPLATE, "aide/95-preview-link-on-the-row"))
      .toBe("https://aide-95-preview-link-on-the.example.pages.dev");
    expect(previewUrlFor(TEMPLATE, "aide/99-merge-leaves-nothing-behind"))
      .toBe("https://aide-99-merge-leaves-nothing.example.pages.dev");
  });

  test("trims leading and trailing dashes — a label may not start or end with one", () => {
    expect(previewUrlFor(TEMPLATE, "/aide/95-x/")).toBe("https://aide-95-x.example.pages.dev");
    expect(previewUrlFor(TEMPLATE, "--x--")).toBe("https://x.example.pages.dev");
  });

  // The manifest is reviewed team knowledge, so a template without the
  // placeholder is not an error to throw over: it degrades to one fixed
  // address rather than taking the page down.
  test("a template without the placeholder is returned unchanged", () => {
    expect(previewUrlFor("https://example.pages.dev", "aide/95-x")).toBe("https://example.pages.dev");
  });

  test("every occurrence of the placeholder is substituted", () => {
    expect(previewUrlFor("https://{branch}.x.dev/{branch}", "aide/95-x")).toBe(
      "https://aide-95-x.x.dev/aide-95-x",
    );
  });

  // A branch of nothing but separators leaves an empty label, and a URL
  // with an empty label is worse than no link at all.
  test("a branch that slugs away to nothing means no preview", () => {
    expect(previewUrlFor(TEMPLATE, "///")).toBeUndefined();
    expect(previewUrlFor(TEMPLATE, "")).toBeUndefined();
  });
});
