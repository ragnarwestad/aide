// A step's log sits in a box about a hundred lines tall that opens at its
// newest line — on the Wiki tab and the spec page's Logs tab alike, which
// draw it with the same table. A long log used to run the whole page's
// length, and a page reloading itself while a build ran sent the reader
// back to its top.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { stepResults } from "../../../src/render/pages/job-page";
import { CSS } from "../../../src/render/ui/css";

browserDeadline();

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

const LINES = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
const html = (logs: string[]) =>
  `<!doctype html><html><head><style>${CSS}</style></head><body><div class="doc">` +
  stepResults([{ step: "wiki", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", logs }], undefined, {
    tabHref: "/projects/aide?tab=wiki",
    openStep: "0",
  }) +
  `</div></body></html>`;

describe("a step's log box", () => {
  test("a long log stands about a hundred lines tall and scrolls", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(html(LINES));
    const box = await page.locator(".logbox").evaluate((el) => {
      const line = parseFloat(getComputedStyle(el).lineHeight);
      return { height: el.clientHeight, scroll: el.scrollHeight, line };
    });
    expect(box.scroll).toBeGreaterThan(box.height);
    expect(box.height).toBeLessThanOrEqual(box.line * 101);
    expect(box.height).toBeGreaterThanOrEqual(box.line * 90);
    await page.close();
  });

  test("it opens at the newest line", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(html(LINES));
    const seen = await page.locator(".logbox").evaluate((el) => {
      const pre = el.querySelector("pre")!;
      const range = document.createRange();
      range.selectNodeContents(pre);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1]!;
      const b = el.getBoundingClientRect();
      return { lastBottom: last.bottom, boxTop: b.top, boxBottom: b.bottom };
    });
    expect(seen.lastBottom).toBeLessThanOrEqual(seen.boxBottom + 1);
    expect(seen.lastBottom).toBeGreaterThan(seen.boxTop);
    await page.close();
  });

  test("a short log is as tall as its lines, with nothing to scroll", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(html(LINES.slice(0, 5)));
    const box = await page.locator(".logbox").evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
    expect(box.scroll).toBe(box.height);
    await page.close();
  });
});
