// Spec 252: the shared "← Back" primitives — `backLink()`'s markup and
// `resolveBackHref()`'s same-origin resolution of the
// standard `Referer` header. No render file had a test of its own for
// either shape before this.
import { describe, expect, test } from "bun:test";
import { backLink, helpPopover, resolveBackHref, switchControl } from "../../../src/render/ui/components";
import { CSS } from "../../../src/render/ui/css";

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

  test("a malformed referer falls back rather than throwing", () => {
    expect(resolveBackHref("not a url", ORIGIN, "/fallback")).toBe("/fallback");
  });
});

// Spec 311: the shared "(?)" popover — `runsHelp()` in filter-bar.ts was
// the only one, module-private and styled against `.specsearch >`. This
// is the version any render file can call.
describe("helpPopover", () => {
  test("a details.intro disclosure, summary titled and aria-labelled from `what`, body inside <p> (REQ-1, REQ-7)", () => {
    expect(helpPopover("What this shows", "Explanation.")).toBe(
      '<details class="intro"><summary title="What this shows" aria-label="What this shows">?' +
        "</summary><p>Explanation.</p></details>",
    );
  });

  test("escapes `what`", () => {
    const html = helpPopover('"><script>alert(1)</script>', "Explanation.");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  // `body` is trusted, developer-authored HTML — the same convention
  // every other component here follows (rowMessage, field) — so it is
  // NOT escaped, unlike `what`. `TAB_HELP`'s own strings rely on this to
  // carry `<code>` tags.
  test("does not escape `body` — it is developer-authored markup, not reader input", () => {
    expect(helpPopover("What this shows", "See <code>1-description.md</code>.")).toContain(
      "<code>1-description.md</code>",
    );
  });
});

// Spec 311, REQ-2: the popover's CSS no longer depends on sitting inside
// `.specsearch` — freed the same way `.menu`/`.menupanel` already are.
describe(".intro popover CSS (spec 311)", () => {
  test("details.intro carries no .specsearch > prefix, so it works as a shared component anywhere", () => {
    expect(CSS).toContain("details.intro { position: relative; }");
  });
});

// Spec 360, REQ-6: the spec page's tabs append the mark inside their own
// first line rather than drawing it as a preceding sibling — floating it
// right is what keeps it pinned to that line's end rather than wrapping
// under it on a narrow screen.
describe(".tabpanel details.intro CSS (spec 360)", () => {
  test("the mark floats right within the spec page's tab panel", () => {
    expect(CSS).toContain(".tabpanel details.intro { float: right; }");
  });
});

describe("switchControl (AC-2, AC-6)", () => {
  const on = switchControl({ id: "x", label: "Notify me", onWord: "On", offWord: "Off", checked: true });
  const off = switchControl({ label: "Notify me", onWord: "On", offWord: "Off" });

  test("is a button with the switch role, its checked state and one accessible name", () => {
    expect(on).toContain('<button type="button" role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(off).toContain('aria-checked="false"');
    expect(on).toContain('aria-label="Notify me"');
    expect(off).toContain('aria-label="Notify me"');
    expect(on).toContain('id="x"');
    expect(off).not.toContain("id=");
  });

  test("shows the word for its position, and carries both words for the script", () => {
    expect(on).toContain('<span class="switchword" aria-hidden="true">On</span>');
    expect(off).toContain('<span class="switchword" aria-hidden="true">Off</span>');
    expect(off).toContain('data-on="On"');
    expect(off).toContain('data-off="Off"');
  });

  test("draws disabled when asked, and escapes its label", () => {
    expect(switchControl({ label: "a", onWord: "On", offWord: "Off", disabled: true })).toContain(" disabled");
    expect(switchControl({ label: "<script>", onWord: "On", offWord: "Off" })).not.toContain("<script>");
  });

  test("its position is styled from aria-checked in the bundled CSS", () => {
    expect(CSS).toContain('.switch[aria-checked="true"]');
  });
});
