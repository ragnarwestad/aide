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
const html = (logs: string[], finalMessage?: string) =>
  `<!doctype html><html><head><style>${CSS}</style></head><body><div class="doc">` +
  stepResults([{ step: "wiki", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", logs, finalMessage }], undefined, {
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

  test("it opens at the end of the final message, the first log line out of view (AC-2)", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(html(LINES, "first line of the message\nlast line of the message"));
    const seen = await page.locator(".logbox").evaluate((el) => {
      const rects = (node: Element) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects();
      };
      const pres = el.querySelectorAll("pre");
      const log = rects(pres[0]!);
      const message = rects(pres[pres.length - 1]!);
      const b = el.getBoundingClientRect();
      return {
        pres: pres.length,
        firstLogBottom: log[0]!.bottom,
        lastBottom: message[message.length - 1]!.bottom,
        boxTop: b.top,
        boxBottom: b.bottom,
      };
    });
    expect(seen.pres).toBe(2);
    expect(seen.lastBottom).toBeLessThanOrEqual(seen.boxBottom + 1);
    expect(seen.lastBottom).toBeGreaterThan(seen.boxBottom - 40);
    expect(seen.firstLogBottom).toBeLessThanOrEqual(seen.boxTop);
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
