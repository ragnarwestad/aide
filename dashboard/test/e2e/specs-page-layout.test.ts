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
import { badge, btn } from "../../src/render/ui/components.ts";
import { t } from "../../src/i18n/index.ts";
import { gerund } from "../../src/render/ui/job-state/resting.ts";

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
  const [stateCol, table, tablewrap, badgeslot, actionslot] = await Promise.all([
    page.locator('th[data-col="state"]').evaluate((el) => el.getBoundingClientRect()),
    page.locator("table.speclist").evaluate((el) => el.getBoundingClientRect()),
    page.locator(".tablewrap").first().evaluate((el) => el.getBoundingClientRect()),
    page.locator("tr.spechead .badgeslot").first().evaluate((el) => el.getBoundingClientRect()),
    page.locator("tr.spechead .actionslot").first().evaluate((el) => el.getBoundingClientRect()),
  ]);
  return { stateCol, table, tablewrap, badgeslot, actionslot };
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
  // wider viewport it ends before `.tablewrap` does — page background
  // shows beside it, not air inside its own last cell.
  expect(wide.table.width).toBeCloseTo(narrow.table.width, 0);
  expect(wide.table.width).toBeLessThan(wide.tablewrap.width);

  // REQ-4: the button follows the badge by one ordinary gap (--sp-2,
  // 8px) at both widths, not the window-dependent distance
  // `justify-content: space-between` produces today.
  expect(narrow.actionslot.left - narrow.badgeslot.right).toBeCloseTo(8, 0);
  expect(wide.actionslot.left - wide.badgeslot.right).toBeCloseTo(8, 0);
});

// REQ-5: the desktop rule's exact `width: 19rem` (rows-and-forms.css)
// applies to the same selector the phone layout's row uses — with no
// override, a phone under 304px would carry a box wider than its own
// screen. `narrow.css` resets it back to `auto` alongside its existing
// `justify-content: flex-start` override, so the row sizes to its own
// content again, the way every other phone row already does.
test("spec 379 REQ-5: the phone layout's row is not held to the desktop's fixed width", async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  await withTimeout(page.goto(`${base}/?live=0`), 10_000, "page.goto(/) at phone width");
  const row = await page.locator("tr.spechead .row").first().evaluate((el) => el.getBoundingClientRect());
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
// coverage). Uses the app's own CSS bundle and the same `badge()`/
// `btn()` markup functions the real row draws with, so the fixture
// cannot drift from the real markup by hand-typing it.
//
// Goes red today for the same root cause as the test above: this
// single-column fixture table still carries `table { width: 100%; }`
// (list.css) with no viewport to size against but the browser's
// default one, and `justify-content: space-between` (rows-and-forms.css)
// still spreads the badge and the button across whatever that leftover
// is — not the two controls' own combined content width, which is the
// number this assertion is actually about.
test("spec 379 REQ-1: the worst-case state badge and Cancel fit on one line within 304px", async () => {
  const worstBadge = badge("idle", t("en", "list.stateQueued", { step: gerund("en", "manifest") }));
  const cancelButton = btn({ label: t("en", "list.cancel"), variant: "primary" });
  const html =
    `<!doctype html><html><head><style>${CSS}</style></head><body>` +
    `<table class="list speclist"><thead><tr><th data-col="state"></th></tr></thead>` +
    `<tbody><tr class="spechead"><td><span class="row">` +
    `<span class="badgeslot">${worstBadge}</span>` +
    `<span class="actionslot">${cancelButton}</span>` +
    `</span></td></tr></tbody></table></body></html>`;
  const fixturePage = await browser.newPage();
  await withTimeout(fixturePage.setContent(html), 10_000, "fixturePage.setContent(worst-case row)");
  const [row, badgeslot, actionslot] = await Promise.all([
    fixturePage.locator(".row").evaluate((el) => el.getBoundingClientRect()),
    fixturePage.locator(".badgeslot").evaluate((el) => el.getBoundingClientRect()),
    fixturePage.locator(".actionslot").evaluate((el) => el.getBoundingClientRect()),
  ]);
  await fixturePage.close();
  expect(row.width).toBeLessThanOrEqual(304);
  // On one line: the badge and the button's vertical MIDPOINTS match
  // (not their tops — `.badge` is 20px tall, `.btn` 28px, and `.row`'s
  // own `align-items: center` centres each on the line rather than
  // top-aligning them), which two boxes stacked onto separate lines by
  // a wrap could never produce.
  const badgeMid = badgeslot.top + badgeslot.height / 2;
  const actionMid = actionslot.top + actionslot.height / 2;
  expect(badgeMid).toBeCloseTo(actionMid, 0);
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
