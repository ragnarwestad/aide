// A real-browser check for the Specs page (spec 348): every case here
// re-creates a regression that a text-only CSS/HTML test already missed
// once, because none of them are about a rule existing — they are about
// what a browser actually draws. `setDefaultTimeout` raises bun:test's
// own 5s default: launching a real Chromium under Bun (Risk analysis,
// 3-solution.md) alone takes several seconds, before a single page has
// loaded.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness, ran } from "../helpers/queue-server.ts";
import { CSS } from "../../src/render/ui/css.ts";
import { badge } from "../../src/render/ui/components.ts";
import { t } from "../../src/i18n";

setDefaultTimeout(20_000);

const TOKEN = "s3cret-token";

const harness = queueHarness("aide-e2e-layout-");
let browser: Browser;
let page: Page;
let base: string;

// A bounded wait around every browser/page call, not just error handling:
// if Bun's own process cannot complete a Chromium launch or navigation
// (an open compatibility question, see 3-solution.md's Risk analysis),
// this turns a silent hang into a fast, readable test failure instead of
// a wedged suite or a wedged archive gate.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not resolve within ${ms}ms`)), ms),
    ),
  ]);
}

beforeAll(async () => {
  browser = await withTimeout(chromium.launch(), 15_000, "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({
    extra: { queueToken: TOKEN },
    // REQ-2 needs a list tall enough to actually overflow the viewport
    // if the fix were absent — the harness's one default spec never
    // does, at either window height, so it would pass with or without
    // the CSS rule this test guards (measured: docHeight stayed pinned
    // to winHeight with only the default row).
    alsoSpecs: Array.from({ length: 40 }, (_, i) => `${i + 1}-padding-spec`),
    archivedSpecs: {
      "99-archived-spec": {
        status: "# 99 - Status\n\n## Notes\n\n## A rendered heading\n\nBody text.\n",
      },
    },
  });
  base = started.base;
  // REQ-3 needs a real yyyy-mm-dd in the Created cell — with no git
  // history at all every row reads the fixed string "date unknown",
  // which cannot wrap regardless of the CSS rule this test guards.
  // `ran()` gives the default live spec a real first-commit date; the
  // 400ms matches committed-history-freshness.test.ts's own wait for
  // the harness's cache-poll/debounce to pick the new git repo up.
  ran(started.dir, []);
  await new Promise((r) => setTimeout(r, 400));
  // Sets the aide_token cookie every later page.goto rides on — the
  // same "visit once with ?token=" flow a person follows, not a header
  // playwright's page.goto has no way to attach anyway. `live=0` is
  // carried on every navigation below too: without it, the page's own
  // SSE connection (queue-client/live.ts) fires an async swapRows()
  // shortly after load and races this test's own reads of the DOM it
  // just rendered — caught as an intermittent 0-rect read on
  // `.created-date` (REQ-3) with the app's own live update wired in.
  await withTimeout(page.goto(`${base}/?token=${TOKEN}&live=0`), 10_000, "page.goto(/?token=)");
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

// 1270px is spec 336's own measured laptop width (its description
// tabulates natural-vs-actual column widths at exactly this window
// size) — reused here rather than a generic "1280" so REQ-2's "laptop
// width" is the same width this codebase's own history already treats
// as the representative one, not an unrelated round number.
const VIEWPORTS = [
  { name: "laptop", width: 1270, height: 800 },
  { name: "wide", width: 1920, height: 1080 },
];

for (const viewport of VIEWPORTS) {
  describe(`at ${viewport.name} width (${viewport.width}px)`, () => {
    // Guards spec 325/337: `main` dropped from page.css's shared
    // max-width/width selector list left the Specs page's header, tab
    // bar and main column at three different widths.
    test("REQ-1: header, tab bar and main share one width", async () => {
      await page.setViewportSize(viewport);
      await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
      const widths = await Promise.all(
        ["header", "body > nav.tabbar", "main"].map((sel) =>
          page.locator(sel).evaluate((el) => el.getBoundingClientRect().width),
        ),
      );
      expect(widths[1]).toBeCloseTo(widths[0], 0);
      expect(widths[2]).toBeCloseTo(widths[0], 0);
    });

    // Guards spec 320: a scroll fix on the Specs page's own list box
    // that let the whole document grow past the viewport instead.
    test("REQ-2: the page itself does not scroll", async () => {
      await page.setViewportSize(viewport);
      await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
      const { docHeight, winHeight } = await page.evaluate(() => ({
        docHeight: document.documentElement.scrollHeight,
        winHeight: window.innerHeight,
      }));
      expect(docHeight).toBeLessThanOrEqual(winHeight);
    });
  });
}

// --- spec 379: the State column has an exact width, and the table
// stops stretching to fill the window ------------------------------------
//
// The `VIEWPORTS` above (1270/1920) cannot tell this regression apart:
// page.css's `main` carries `max-width: calc(72rem + 2 * var(--sp-6))`,
// which caps its rendered width at 1216px — so 1270px and 1920px
// already render `main`, and everything under it, at the identical
// capped 1216px, on the CURRENT code too (measured directly with this
// same harness before writing this test). 900px sits below that cap,
// where the table genuinely still grows with the window, so it is the
// low end here instead of 1270px; 1920px stays as the high end.
async function measureStateRow() {
  const [stateCol, table, frame, badgeslot, actionslot] = await Promise.all([
    page.locator('th[data-col="state"]').evaluate((el) => el.getBoundingClientRect()),
    page.locator("table.speclist").evaluate((el) => el.getBoundingClientRect()),
    page.locator("main").first().evaluate((el) => el.getBoundingClientRect()),
    page.locator("tr.spechead .badgeslot").first().evaluate((el) => el.getBoundingClientRect()),
    page.locator("tr.spechead .actionslot").first().evaluate((el) => el.getBoundingClientRect()),
  ]);
  return { stateCol, table, frame, badgeslot, actionslot };
}

test("spec 379 REQ-2/REQ-3/REQ-4: the State column, the table and the badge-to-button gap do not grow with the window", async () => {
  await page.setViewportSize({ width: 900, height: 900 });
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) at 900px");
  const narrow = await measureStateRow();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) at 1920px");
  const wide = await measureStateRow();

  // REQ-2: the State column's own width is the same at both widths.
  expect(wide.stateCol.width).toBeCloseTo(narrow.stateCol.width, 0);

  // REQ-3: the table itself does not grow with the window, and at the
  // wider viewport it ends before the page's own frame does — page
  // background shows beside it, not air inside its own last cell.
  // Measured against `main`, not `.tablewrap`: the scroll box now takes
  // the table's own width, so that the scrollbar sits against the list
  // rather than out at the frame's edge, and the two no longer differ.
  expect(wide.table.width).toBeCloseTo(narrow.table.width, 0);
  expect(wide.table.width).toBeLessThan(wide.frame.width);

  // REQ-4 asked that the button follow the badge by one ordinary gap.
  // The two no longer share a cell (2026-09-08): the button sits at the
  // end of the name box and the badge alone in its own column, so what
  // holds them apart is the table, and what REQ-4 was guarding against —
  // a window-dependent distance — is gone with the flex row it lived in.
  // The button's own x is what must not move: it is the same at both
  // widths, whatever the name beside it says.
  expect(wide.actionslot.left).toBeCloseTo(narrow.actionslot.left, 0);
});

// --- spec 381: the controls line above the list ends where the list
// does --------------------------------------------------------------
//
// `.specsearch` (the search field, the state dropdown, New) used to
// stretch to `main`'s own frame width instead of the table's — a
// mismatch only visible once the table's own width stopped tracking
// the window (spec 379). REQ-1 itself asks for "a window wide enough
// that the table does not scroll": below that point `.tablewrap`'s own
// `overflow-x: auto` (list.css) keeps the table's full 63rem width off
// the visible page while `.specsearch` (which has no scroll box of its
// own, by design — Risk analysis, 3-solution.md) stays within the
// frame, so the two edges cannot and need not align there. 1100px sits
// just above that threshold (measured directly: `#jobrows`'s own
// content box is 1036px wide there, wider than the table's 1009px);
// 1920px is the file's existing wide end, already used above.
async function measureControlsAndTable() {
  const [controls, table] = await Promise.all([
    page.locator(".specsearch").first().evaluate((el) => el.getBoundingClientRect()),
    page.locator("table.speclist").evaluate((el) => el.getBoundingClientRect()),
  ]);
  return { controls, table };
}

test("spec 381 REQ-1/REQ-7: the controls line's right edge matches the table's, at more than one window width", async () => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) at 1100px");
  const narrow = await measureControlsAndTable();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) at 1920px");
  const wide = await measureControlsAndTable();

  // Within 1px: `table.list`'s own 1px border plus `border-collapse`
  // (list.css) renders the table's box a hair wider than its declared
  // `63rem`, a pre-existing rendering quirk this spec does not touch —
  // `toBeCloseTo(..., 0)`'s < 0.5px tolerance is tighter than that.
  expect(
    Math.abs(narrow.controls.x + narrow.controls.width - (narrow.table.x + narrow.table.width)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(wide.controls.x + wide.controls.width - (wide.table.x + wide.table.width)),
  ).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1270, height: 800 });
});

// The scroll box holding the list ends where the list does, so its
// scrollbar sits against the table rather than out at the window's
// edge. Same shape as the controls line above: `.tablewrap` used to
// span `main`'s frame while the table inside it stopped at 63rem, and
// the gap only appeared once the table's width stopped tracking the
// window. Measured wide, where there IS empty page to the right for
// the bar to drift into.
test("the list's scroll box ends where the table does", async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) at 1920px");
  const [wrap, table] = await Promise.all([
    page.locator("#jobrows .tablewrap").evaluate((el) => el.getBoundingClientRect()),
    page.locator("table.speclist").evaluate((el) => el.getBoundingClientRect()),
  ]);

  expect(Math.abs(wrap.x + wrap.width - (table.x + table.width))).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1270, height: 800 });
});

// Spec 415, REQ-1: the block used to sit flush against main's left inner
// edge instead of centered within it — none of the assertions above pin
// the absolute left offset, only the relative widths and right-edge
// alignment, so a block centered by unequal amounts on each side would
// still pass every one of them.
test("spec 415 REQ-1: the controls/table block is centered inside main, not flush left", async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) at 1920px");
  const [wrap, frame] = await Promise.all([
    page.locator("#jobrows .tablewrap").evaluate((el) => el.getBoundingClientRect()),
    page.locator("main").first().evaluate((el) => el.getBoundingClientRect()),
  ]);

  const leftGap = wrap.x - frame.x;
  const rightGap = frame.x + frame.width - (wrap.x + wrap.width);
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1270, height: 800 });
});

// REQ-5: the desktop rule's exact `width: 19rem` (rows-and-forms.css)
// applies to the same selector the phone layout's row uses — with no
// override, a phone under 304px would carry a box wider than its own
// screen. `narrow.css` resets it back to `auto` alongside its existing
// `justify-content: flex-start` override, so the row sizes to its own
// content again, the way every other phone row already does.
// The gap this rule exists to remove, measured where it actually
// showed: BEHIND the action button. State's cell used to be one fixed
// 19rem box with the badge and the button packed left inside it, so
// every row shorter than the worst case carried the difference — about
// 130px, a hand's width of nothing — between the button and the Created
// column. Two fixed boxes (`.badgeslot`, `.actionslot`) leave nothing
// over: the cell is their sum, and what follows the button is the
// cell's own padding and no more.
test("spec 379 REQ-4: nothing but the cell's padding stands between the action and the next column", async () => {
  for (const width of [900, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await withTimeout(page.goto(`${base}/?live=0`), 10_000, `page.goto(/) at ${width}px`);
    // The button sits at the end of the NAME cell since 2026-09-08,
    // where the pips were: what follows it is that cell's own padding
    // and no more, the same rule REQ-4 asked of the State cell.
    const [cell, action] = await Promise.all([
      page.locator("tr.spechead .actionslot").first().evaluate((el) => el.closest("td")!.getBoundingClientRect()),
      page.locator("tr.spechead .actionslot").first().evaluate((el) => el.getBoundingClientRect()),
    ]);
    expect(cell.right - action.right).toBeLessThanOrEqual(13);
  }
  await page.setViewportSize({ width: 1270, height: 800 });
});

test("spec 379 REQ-5: the phone layout's row is not held to the desktop's fixed width", async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) at phone width");
  // The badge's own holder, since the `.row` that held the pair is
  // dissolved at this width (2026-09-08): what REQ-5 is about is that
  // nothing on the phone's row carries a desktop width.
  const row = await page.locator("tr.spechead .badgeslot").first().evaluate((el) => el.getBoundingClientRect());
  expect(row.width).toBeLessThan(280);
  // Every test after this one shares `page` and assumes a desktop
  // width (this file sets no viewport of its own outside `VIEWPORTS`'
  // loop and this test) — leaving the phone size behind broke the
  // unrelated "Created cell" test below, which reads a table-layout
  // cell that does not exist at this width.
  await page.setViewportSize({ width: 1270, height: 800 });
});

// REQ-1: the worst-case badge/button pairing — the longest text this
// column can draw ("updating the manifest for queued", the `manifest`
// step's gerund, 2-analysis.md's Findings) beside a Cancel button, the
// widest control that can share a row with it (row-controls.ts's
// `specBusy` never draws the run-phase label on a busy — running or
// queued — row) — fits on one line within 304px (19rem). Built with
// `page.setContent()`, not the live harness: the harness seeds real
// specs on disk and has no way to put one in a transient
// `queued`/`manifest` job state on demand (2-analysis.md's Test
// coverage). Uses the app's own CSS bundle and the same `badge()`
// markup function the real row draws with, so the fixture cannot drift
// from the real markup by hand-typing it.
test("spec 379 REQ-1: the widest state badge fits the State column", async () => {
  // The badge and the button shared this cell until 2026-09-08, and the
  // fixture built both. The button sits in the name box now, so what
  // this measures is the badge alone against the column it has to
  // itself: the widest of the sixty texts a spec row can draw, which is
  // a phase line running for a second time in Norwegian.
  const worstBadge = badge("waiting", `${t("nb", "list.stateQueued").replace("{step}", "implementerer")} (2)`);
  const html =
    `<!doctype html><html><head><style>${CSS}</style></head><body>` +
    `<table class="list speclist"><colgroup><col data-col="state"></colgroup>` +
    `<tbody><tr class="spechead"><td><span class="badgeslot">${worstBadge}</span></td></tr></tbody>` +
    `</table></body></html>`;
  const fixturePage = await browser.newPage();
  await withTimeout(fixturePage.setContent(html), 10_000, "fixturePage.setContent(worst-case badge)");
  const [badgeslot, cell] = await Promise.all([
    fixturePage.locator(".badgeslot").evaluate((el) => el.getBoundingClientRect()),
    fixturePage.locator("td").evaluate((el) => el.getBoundingClientRect()),
  ]);
  await fixturePage.close();
  expect(badgeslot.width).toBeLessThanOrEqual(cell.width);
});

// Guards spec 326: the Created column's bare yyyy-mm-dd date breaking at
// its own hyphens once the column narrowed past the date's width.
//
// Measured directly (not assumed): `.tablewrap { overflow-x: auto }`
// lets `table.list` always render at its own natural (unwrapped) width
// and scroll instead of compressing — table-layout:auto never forces
// this column below its content width at any real viewport here, so
// removing `white-space: nowrap` alone cannot be driven to a visible
// two-line wrap through viewport or fixture content in the CURRENT
// page (verified by hand across the full 641–1920px range, the widest
// span this column can appear at outside the flex/card breakpoint).
// The `whiteSpace` check below is what actually turns red if the rule
// is removed or overridden; `getClientRects()` stays as the literal,
// currently-true REQ-3 assertion and the one that starts mattering
// again the moment this table's own width ever becomes constrained.
test("REQ-3: a spec row's Created cell stays on one line", async () => {
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/)");
  // The row for the one spec `ran()` gave a real git-datable commit
  // (beforeAll) — every other row here reads the fixed "date unknown"
  // string, which cannot wrap regardless of the CSS rule this guards.
  const cell = page.locator('tr[data-folder="81-queue-and-runner"] .created-date');
  const [lineCount, whiteSpace] = await Promise.all([
    cell.evaluate((el) => el.getClientRects().length),
    cell.evaluate((el) => getComputedStyle(el).whiteSpace),
  ]);
  expect(lineCount).toBe(1);
  expect(whiteSpace).toBe("nowrap");
});

// Guards spec 333: a locked document tab (archived, or a job in flight)
// that fell through to no script at all, leaving the raw markdown source
// visible instead of the rendered document.
test("REQ-4: a locked document tab shows the rendered document", async () => {
  await withTimeout(
    page.goto(`${base}/specs/aide/99-archived-spec?tab=status&live=0`),
    10_000,
    "page.goto(/specs/aide/99-archived-spec?tab=status)",
  );
  await withTimeout(
    page.waitForSelector(".spec-editor-mount[data-mounted]"),
    10_000,
    "waitForSelector(.spec-editor-mount[data-mounted])",
  );
  const heading = page.locator(".toastui-editor-contents h2", { hasText: "A rendered heading" });
  await withTimeout(heading.waitFor({ state: "visible" }), 10_000, "waitFor(rendered heading)");
  const rawDisplay = await page
    .locator(".spec-editor-raw")
    .evaluate((el) => getComputedStyle(el).display);
  expect(rawDisplay).toBe("none");
});
