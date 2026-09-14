import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, RENDER_FILES } from "./css-guard-fixtures.ts";

// Every title="..." (or title=`...`) expected in src/render after spec
// 454. Anything else found is a hover-only explanation that has to
// become a helpPopover() instead — see docs/design-system.md.
//
// Two shapes survive: the NAME of an icon-only control with no visible
// text of its own (paired with an aria-label, never an explanation),
// and a MORE PRECISE form of a fact already shown beside it in short
// form (an exact timestamp beside "4 min ago", a `project:folder` id
// beside a spec's name).
const ALLOWED_TITLES: (string | RegExp)[] = [
  // Icon-only names.
  /isOpen \? /, // job-page/steps-table.ts fold chevron — truncated at
  // the nested quote inside its own ternary, same as the specs-list
  // fold title below
  "cannot run yet — see the project's page", // projects-page warning icon
  "Clear the search", // schedule-page/list.ts search-clear ×
  /^\$\{clearLabel\}$/, // specs-list filter-bar.ts search-clear ×
  "checking…", // icons.ts CHECKING mark
  "already done", // phaseChip()'s own done tick
  /^\$\{theme\}$/, // shell.ts theme menu trigger
  /^\$\{langLabel\}$/, // shell.ts language menu trigger
  /^\$\{unit\}$/, // shell.ts unit menu trigger
  /esc\(t\(lang,/, // specs-list fold chevron — the regex matches only up
  // to the nested quote the guard's own extraction regex stops at
  // (the fold title's `t()` call takes a second, quoted argument)

  // Identity or precision values, already shown beside a short form.
  /^\$\{esc\(iso\)\}$/, // html.ts relTime — the exact stamp
  /esc\(board\.specFolder\).*esc\(board\.branch\)/, // shell.ts boardTitle
  /esc\(g\.project\).*esc\(g\.specFolder\)/, // head-row.ts spec link
  /^\$\{attempts\} attempts$/, // cell-helpers.ts — spelled out

  // components/index.ts's own generic `title` builders — the regex
  // matches the PARAMETER expression, not a caller's value, because
  // every remaining caller of each is already on this list in its own
  // right (badge()'s is only ever called with the attempt-count string
  // above; helpPopover()'s summary title is always its own short
  // `what` argument, never the long `body`).
  /^\$\{esc\(o\.title\)\}$/, // btn()'s own title builder — dead, no caller passes it
  /^\$\{esc\(title\)\}$/, // badge()'s own title builder
  /^\$\{esc\(what\)\}$/, // helpPopover()'s own summary, and the PDF icon's own name
  /^\$\{esc\(p\.title\)\}$/, // pips()'s own title builder
];

describe("no title= in src/render carries an explanation (spec 454)", () => {
  test("every allowed string entry is a few words or fewer", () => {
    for (const a of ALLOWED_TITLES) {
      if (typeof a === "string") expect(a.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
  });

  for (const file of RENDER_FILES) {
    test(file, () => {
      const src = readFileSync(join(ROOT, file), "utf-8");
      const hits = [...src.matchAll(/title=["`]([^"`]*)["`]/g)].map((m) => m[1]!);
      const unexplained = hits.filter(
        (h) => !ALLOWED_TITLES.some((a) => (typeof a === "string" ? a === h : a.test(h))),
      );
      expect(unexplained).toEqual([]);
    });
  }
});
