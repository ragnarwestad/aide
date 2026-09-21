// The span between the phone breakpoint and the full desktop table.
//
// `specs-page-layout.test.ts` says in its own comment that it stays
// ABOVE 59.5rem, because below that point `list.css` drops one column
// per step and measuring there would measure the drops rather than the
// stretch it guards. So the drops themselves had no test at all — and
// that span, 640px to 952px, is exactly where the columns were reported
// falling away wrongly.
//
// Nothing here is reachable from a string: which columns a window shows
// is a media query's answer, and only a browser evaluates one.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-columns-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start();
  base = started.base;
  ran(started.dir, []);
  await new Promise((r) => setTimeout(r, 400));
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/?live=0)");
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** The data columns the window is actually showing, by name, as the
 *  browser paints them. A column `list.css` hides keeps its `<col>` — so
 *  this reads the heading cells, which are what a reader sees. */
async function shownColumns(width: number): Promise<string[]> {
  await page.setViewportSize({ width, height: 900 });
  await withBrowser(page.goto(`${base}/?live=0`), `page.goto at ${width}px`);
  return page.locator("table.speclist th[data-col]").evaluateAll((cells) =>
    cells
      .filter((c) => getComputedStyle(c).display !== "none")
      .map((c) => c.getAttribute("data-col") ?? ""),
  );
}

// The three breakpoints `list.css` declares, in the order a window
// narrows through them: 59.5rem, 53rem and 46.5rem at a 16px root. Only
// three columns are ever droppable — `spec` carries the phase under its
// own `colspan="2"`, and `state` is what a row is read for.
const DROPPABLE = ["created", "cost", "started"] as const;
const STEPS: { width: number; shown: string[] }[] = [
  { width: 1000, shown: ["spec", "state", "started", "cost", "created"] },
  { width: 900, shown: ["spec", "state", "started", "cost"] },
  { width: 800, shown: ["spec", "state", "started"] },
  { width: 700, shown: ["spec", "state"] },
];

test("each step down drops exactly one more column, and never a different one", async () => {
  let previous: string[] | undefined;
  for (const { width, shown: expected } of STEPS) {
    const shown = await shownColumns(width);
    expect(shown.sort()).toEqual([...expected].sort());
    if (previous) {
      // One at a time, and never a column coming BACK as it narrows.
      expect(shown.length).toBe(previous.length - 1);
      expect(previous).toEqual(expect.arrayContaining(shown));
    }
    previous = shown;
  }
});

test("no width in the span scrolls sideways", async () => {
  // A column that refuses to drop does not vanish quietly: it pushes the
  // table past the window, and the whole page gains a sideways scroll.
  for (const width of [952, 900, 848, 800, 744, 700, 660]) {
    await page.setViewportSize({ width, height: 900 });
    await withBrowser(page.goto(`${base}/?live=0`), `page.goto at ${width}px`);
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(overflow.doc).toBeLessThanOrEqual(overflow.win);
  }
});

test("a dropped column takes its body cells with it", async () => {
  // A heading hidden while its cells stay would shift every row's
  // remaining columns one place left, which reads as the wrong data
  // under the wrong heading rather than as a missing column.
  for (const width of [900, 800, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await withBrowser(page.goto(`${base}/?live=0`), `page.goto at ${width}px`);
    const disagreed = await page.evaluate((cols) => {
      const visible = (el: Element | null) => el !== null && getComputedStyle(el).display !== "none";
      const table = document.querySelector("table.speclist");
      if (!table) return "no table";
      const row = table.querySelector("tbody tr");
      if (!row) return "no row";
      return cols
        .filter((col) => {
          const head = table.querySelector(`thead th[data-col="${col}"]`);
          const cell = row.querySelector(`[data-col="${col}"]`);
          return cell !== null && visible(head) !== visible(cell);
        })
        .join(",");
    }, [...DROPPABLE]);
    expect(disagreed).toBe("");
  }
});
