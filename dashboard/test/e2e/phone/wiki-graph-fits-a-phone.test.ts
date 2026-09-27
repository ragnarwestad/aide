// The Wiki tab's Graph panel on a phone (AC-5, criterion 16 of an earlier
// round; AC-7 and AC-9 of this one): a wiki the size of this project's own
// (28 pages) fits the panel's own width at 360 and 390 px, the page never
// scrolls sideways, every point lands inside the box, and no two rendered
// names overlap.
//
// Not run by the session: Aide is not a project where the session runs the
// e2e suite. CI runs it (`make test-e2e`), and by hand:
// `cd dashboard && bun test --timeout 30000 test/e2e/phone/wiki-graph-fits-a-phone.test.ts`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { cleanupBoards, untilTab, wikiBoard } from "../../queue-routes/admin/wiki/wiki-pages-fixtures.ts";

browserDeadline();

const PAGE_COUNT = 27;
const names = Array.from({ length: PAGE_COUNT }, (_, i) => `page-${i}.md`);
const INDEX = [
  "# Wiki index", "", "One line per page of the wiki.", "",
  ...names.map((n, i) => `- [Page ${i}](${n}) — one of the wiki's own pages.`),
  "",
].join("\n");
const pages: Record<string, string> = { "index.md": INDEX };
for (let i = 0; i < PAGE_COUNT; i++) {
  const linksTo = names[(i + 1) % PAGE_COUNT];
  pages[names[i]!] = `# Page ${i}\n\nSee [the next page](${linksTo}).\n`;
}

let browser: Browser;
let base: string;
let stop: () => void;

beforeAll(async () => {
  browser = await chromium.launch();
  const board = await wikiBoard(pages);
  base = board.base;
  stop = board.stop;
  await untilTab(base, "/projects/aide?tab=wiki&wikitab=graph", (h) => h.includes("data-wikigraph"));
});

afterAll(async () => {
  await browser.close();
  stop();
  cleanupBoards();
});

async function open(width: number, height: number): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${base}/projects/aide?tab=wiki&wikitab=graph`);
  await page.locator("svg[data-wikigraph]").waitFor();
  return page;
}

/** Whether any two of a list of rectangles overlap — the same AABB test
 *  `test/wiki-graph/layout.test.ts` uses on the algorithm's own estimated
 *  boxes; here it runs on the browser's REAL rendered ones (AC-7). */
function anyOverlap(boxes: { x: number; y: number; width: number; height: number }[]): boolean {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!;
    const b = boxes[j]!;
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) return true;
  }
  return false;
}

for (const width of [360, 390]) {
  test(`the graph fits a ${width}px screen and the page does not scroll sideways (AC-9)`, async () => {
    const page = await open(width, 800);
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      screen: document.documentElement.clientWidth,
    }));
    expect(overflow.page).toBeLessThanOrEqual(overflow.screen);

    const tabBox = (await page.locator(".tabpanel").boundingBox())!;
    const graphBox = (await page.locator("svg[data-wikigraph]").boundingBox())!;
    expect(Math.abs(graphBox.width - tabBox.width)).toBeLessThanOrEqual(2);
    expect(graphBox.height).toBeLessThanOrEqual(800 * 0.7 + 1);

    const points = await page.locator(".wikinode circle").all();
    expect(points).toHaveLength(PAGE_COUNT);
    for (const circle of points) {
      const box = (await circle.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(graphBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(graphBox.x + graphBox.width + 1);
    }
    await page.context().close();
  });

  test(`no two page names overlap, and none is drawn against the graph's edge, at ${width}px (AC-7)`, async () => {
    const page = await open(width, 800);
    const graphBox = (await page.locator("svg[data-wikigraph]").boundingBox())!;
    const labels = await page.locator(".wikinode text").all();
    expect(labels).toHaveLength(PAGE_COUNT);
    const boxes = await Promise.all(labels.map((l) => l.boundingBox()));
    for (const box of boxes) {
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(graphBox.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(graphBox.x + graphBox.width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(graphBox.y - 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(graphBox.y + graphBox.height + 1);
    }
    expect(anyOverlap(boxes as { x: number; y: number; width: number; height: number }[])).toBe(false);
    await page.context().close();
  });
}

test("no two page names overlap, and none is drawn against the graph's edge, at a desktop width (AC-7)", async () => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${base}/projects/aide?tab=wiki&wikitab=graph`);
  await page.locator("svg[data-wikigraph]").waitFor();
  const graphBox = (await page.locator("svg[data-wikigraph]").boundingBox())!;
  const labels = await page.locator(".wikinode text").all();
  const boxes = await Promise.all(labels.map((l) => l.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(graphBox.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(graphBox.x + graphBox.width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(graphBox.y - 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(graphBox.y + graphBox.height + 1);
  }
  expect(anyOverlap(boxes as { x: number; y: number; width: number; height: number }[])).toBe(false);
  await context.close();
});
