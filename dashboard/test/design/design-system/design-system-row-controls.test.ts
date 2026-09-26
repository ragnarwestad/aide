// The mark replaces the checkbox, never widens the chip; the running
// phase's pip carries the motion. Split out of design-system.test.ts by theme.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { rows, target } from "../design-system-fixtures.ts";

// --- the mark replaces the checkbox, never widens the chip -------------------

// Said repeatedly, last 2026-08-19: when a phase runs, its spinner must
// take the CHECKBOX's place — a spinner beside the box makes the chip
// grow the moment a run starts. Same for the lock on a chip that will
// not take a click. The rule is CSS (the input stays in the markup for
// the form's sake), so the test pins the stylesheet itself.
// The phase lines are columns (asked for 2026-08-19, "få det nå
// alignet"): the name has a fixed width so every model select starts at
// the same x, sharing it with the caption row's own first span.
// The row's one action lives in the State column of the caption line
// the fold opens (2026-09-08). It had a COLUMN of its own at the front
// of the table in spec 124, which put every button in the page's left
// gutter and pushed every other column sideways; then a cell in the
// spec column spanning the phase lines (2026-08-19); then the head
// row's State cell (spec 157) and the end of its name box
// (2026-09-07). The left edge belongs to the phase lines now.
describe("the row's one action rides the caption line, not a column of its own", () => {
  test("the header declares no blank cell, at either end", async () => {
    const html = rows([], { targets: [target()] });
    const thead = html.match(/<thead><tr>[\s\S]*?<\/tr><\/thead>/)?.[0] ?? "";
    expect(thead).toMatch(/<\/a><\/th><\/tr><\/thead>$/);
  });

  test("the button is on the caption line, and spans no rows", () => {
    const html = rows([], { targets: [target()] });
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    // Nowhere on the head line: it says what the spec IS.
    expect(head).not.toContain("<button");
    // The caption line's THIRD cell — the State column, the same one
    // the badge above it and the phase words below it are under.
    const caption = html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = [...caption.replace(/<td[^>]*data-col="fold"[^>]*>[\s\S]*?<\/td>/g, "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    expect(cells[2]).toContain("</button>");
    expect(cells[0]).not.toContain("</button>");
    expect(cells[1]).not.toContain("</button>");
    // The guard is about THIS button, not about the string: spec 165
    // gave the row's AI select a legitimate spanning cell of its own,
    // and the chevron's own cell spans the header's two lines
    // (2026-09-22) — a blanket ban would now fail for the wrong reason.
    // What must not come back is the action in a cell spanning the
    // phase lines, which the loop below checks directly.
    expect(head).not.toMatch(/<td(?![^>]*data-col="fold")[^>]*rowspan/);
    for (const cell of html.matchAll(/<td[^>]*rowspan[^>]*>([\s\S]*?)<\/td>/g)) {
      expect(cell[1]).not.toContain("</button>");
    }
    // And the phase lines lead with their own cell, hard left: it spans
    // the chevron's column, which belongs to the head row alone
    // (2026-09-22).
    expect(html).toMatch(/<tr class="subrow[^"]*"[^>]*><td class="phasecell" colspan="2">/);
  });
});

// An open row's last phase line sat hard against the next spec's name.
// The rule meant to prevent it read `tr.subrow:last-child`, and
// `:last-child` means the last row in the TABLE — so it fired only when
// the open spec happened to be the bottom one, and any spec below it
// left the last phase line on its ordinary 2px. A collapsed row looks
// right because its air comes from ABOVE: the head row has its own
// border-top and padding-top.
//
// What is wanted is "the last sub-row of THIS spec". `:has()` reads
// forward from the subrow to the head row that follows it, which is the
// only direction a flat, unwrapped tbody allows without a wrapper
// element per spec. Adding a standalone selector beside the existing one
// is also narrower than moving the space onto tr.spechead's own
// border-top/padding-top rule, which three other things on the page rely
// on (spec 167).
describe("an open spec's last phase line has air under it", () => {
  test("the padding rule reaches a spec's own last subrow, not just the table's", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
    const rule =
      CSS.match(/([^\n}]*tr\.subrow:last-child td[^{]*)\{([^}]*)\}/) ??
      ([] as unknown as RegExpMatchArray);
    const selector = rule[1] ?? "";
    expect(rule[2] ?? "").toContain("padding-bottom: var(--sp-3)");
    // The case that was already right — the page's literal last row —
    // is kept, and the case that was not is added beside it.
    expect(selector).toContain("tr.subrow:last-child td");
    expect(selector).toContain("tr.subrow:has(+ tr.spechead) td");
  });
});

// The one moving thing that said a phase was running used to be a
// spinner on that phase's CHECKBOX, and a checkbox only exists on an
// open row — so the closed row, which spec 157 made the whole interface
// for the ordinary case, showed no motion at all. Spec 168 moved the
// signal onto the running phase's Progress marker: the mark that
// already says WHICH phase is running says "and it is alive" in the
// same 14x4 glyph, taking no space and needing no new element.
describe("the running phase's pip carries the motion, not the checkbox", () => {
  test("the pip skims along the bar rather than pulsing in place", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
    const pipNow = CSS.match(/\.pip\.now\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(pipNow).toMatch(/animation:\s*\S+/);
    // Matched by the animation's own NAME, never as "the first
    // @keyframes in the file": `.spin`'s `@keyframes sp { ... }` is
    // written on one line too, and a name-agnostic pattern would pass
    // by matching that one instead, for the wrong reason.
    const keyframes = CSS.match(/@keyframes\s+pipskim\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? "";
    // A pulse reads as an alert; a band travelling ALONG the bar reads
    // as work being done, in the direction the four marks already run.
    expect(keyframes).toContain("background-position");
    expect(keyframes).not.toContain("opacity");
  });

  test("a machine set to reduce motion gets none, and can still tell running from waiting", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
    // Every reduced-motion block in the bundle, each brace-matched —
    // there are several (one per stylesheet that animates), and a lazy
    // match from the first one to the next "\n}" ran through whatever
    // other media block came first.
    const opening = "@media (prefers-reduced-motion: reduce) {";
    const reduced = CSS.split(opening).slice(1).map((rest) => {
      let depth = 1;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "{") depth++;
        else if (rest[i] === "}" && --depth === 0) return rest.slice(0, i);
      }
      throw new Error("a reduced-motion block is never closed");
    }).join("\n");
    expect(reduced).toContain(".pip.now");
    expect(reduced).toContain("animation: none");
    // The mark stands still; it does not go grey. The accent is what
    // says which phase, and that half of the signal is not motion.
    expect(reduced).toContain("background: var(--accent)");
  });

  test("every running row's pip shares one clock", async () => {
    // No `animation-delay` anywhere. The whole `#jobrows` subtree is
    // replaced in a single `innerHTML` swap, so every pip on the page
    // starts together by construction; a delay keyed off a row index or
    // a job's own start time is exactly what would make a list of
    // running specs shimmer at random instead of moving as one.
    const { CSS } = await import("../../../src/render/ui/css");
    // The DECLARATION, not the word: the rule's own comment says why
    // there is no delay, and a guard tripped by prose that agrees with
    // it would only teach the next reader to delete the prose.
    expect(CSS).not.toMatch(/animation-delay\s*:/);
    expect(CSS).not.toMatch(/animation:[^;}]*\d[a-z]*\s+[^;}]*\d+m?s[^;}]*\d+m?s/);
    // And nothing sets one from script either — a per-row delay read
    // off a job's own start time is the shape this is really guarding
    // against, and it would live in the browser code, not the CSS.
    const root = join(import.meta.dir, "..", "..", "..");
    // css/index.ts is read above as the EVALUATED stylesheet and left out
    // here: it is the one file in the glob whose comments are page
    // content, so its own explanation of why there is no delay is text
    // this loop would read as a declaration.
    const files = [
      ...[...new Bun.Glob("src/render/**/*.ts").scanSync(root)].filter((f) => f !== "src/render/ui/css/index.ts"),
      ...new Bun.Glob("src/specs-client/**/*.ts").scanSync(root),
    ];
    expect(files.length).toBeGreaterThan(4);
    for (const file of files) {
      const source = await Bun.file(join(root, file)).text();
      expect([file, /animation-delay|animationDelay/.test(source)]).toEqual([file, false]);
    }
  });
});
