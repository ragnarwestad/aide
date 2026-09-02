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
