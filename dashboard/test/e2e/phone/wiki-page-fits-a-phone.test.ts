// The Wiki tab on a phone. A wiki page is full of long file paths in code
// spans, and one unbroken line of that length is the usual way a page is
// pushed wider than the screen. Only a browser answers this, and only a
// browser can say the viewer drew a heading rather than the raw `# ` line.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { cleanupBoards, INDEX, untilTab, wikiBoard } from "../../queue-routes/admin/wiki/wiki-pages-fixtures.ts";

browserDeadline();

const LONG = "dashboard/src/render/pages/projects-page/a-very-long-file-name-that-goes-on-and-on-and-on-wiki-section.ts";
const PAGE = [
  "---", "wiki: generated", "commit: abc1234", "files: []", "---", "",
  "# Landing", "", "How a branch lands.", "",
  `- A piece: \`${LONG}\` holds the part that draws the whole tab with a long line after it.`,
  "",
  `Some text with \`${LONG}\` in it.`,
  "",
].join("\n");

let browser: Browser;
let page: Page;
let base: string;
let stop: () => void;

beforeAll(async () => {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
  page = await context.newPage();
  const board = await wikiBoard({ "index.md": INDEX, "landing.md": PAGE, "skills.md": "# Skills\n\nThe slash commands.\n" });
  base = board.base;
  stop = board.stop;
  await untilTab(base, "/projects/aide?tab=wiki", (h) => h.includes("How a branch lands."));
});

afterAll(async () => {
  await browser.close();
  stop();
  cleanupBoards();
});

const overflow = () =>
  page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth }));

test("the page list does not scroll the page sideways (AC-9)", async () => {
  await page.goto(`${base}/projects/aide?tab=wiki`);
  const m = await overflow();
  expect(m.page).toBeLessThanOrEqual(m.screen);
});

test("an open page shows a rendered heading, not its raw text, and does not scroll sideways (AC-2, AC-9)", async () => {
  await page.goto(`${base}/projects/aide?tab=wiki&page=landing.md`);
  await page.locator(".toastui-editor-contents h1").waitFor();
  expect(await page.locator(".toastui-editor-contents h1").innerText()).toBe("Landing");
  expect(await page.locator("body").innerText()).not.toContain("wiki: generated");
  const m = await overflow();
  expect(m.page).toBeLessThanOrEqual(m.screen);
});
