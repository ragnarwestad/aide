// The Wiki tab's graph on a phone (AC-5, criterion 16): a wiki the size of
// this project's own (28 pages) fits the tab's own width at 360 and 390 px,
// the page never scrolls sideways, and every point lands inside the box.
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
  await untilTab(base, "/projects/aide?tab=wiki", (h) => h.includes("data-wikigraph"));
});

afterAll(async () => {
  await browser.close();
  stop();
  cleanupBoards();
});

async function open(width: number, height: number): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${base}/projects/aide?tab=wiki`);
  await page.locator("svg[data-wikigraph]").waitFor();
  return page;
}

for (const width of [360, 390]) {
  test(`the graph fits a ${width}px screen and the page does not scroll sideways (AC-5)`, async () => {
    const page = await open(width, 800);
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      screen: document.documentElement.clientWidth,
    }));
    expect(overflow.page).toBeLessThanOrEqual(overflow.screen);

    const tabBox = (await page.locator(".deploypanel").boundingBox())!;
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
}
