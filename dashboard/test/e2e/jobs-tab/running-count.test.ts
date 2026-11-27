import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { createdJob, queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-running-count-");
let browser: Browser;
let base: string;
beforeAll(async () => {
  browser = await chromium.launch();
  base = harness.start({ queueMirror: JSON.stringify([createdJob()]) }).base;
});
afterAll(async () => { await browser.close(); harness.cleanup(); });

test("the Jobs and Specs counts follow live changes, including zero", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 844 } });
  try {
    await page.addInitScript(() => {
      const streams: EventTarget[] = [];
      class FakeStream extends EventTarget {
        static CLOSED = 2;
        readyState = 1;
        constructor(_url: string) { super(); streams.push(this); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
        close() { const at = streams.indexOf(this); if (at >= 0) streams.splice(at, 1); }
      }
      Object.assign(window, {
        EventSource: FakeStream,
        showCounts: (activeJobs: number, openSpecs = 7) => streams.forEach((stream) => stream.dispatchEvent(new MessageEvent("changed", { data: JSON.stringify({ activeJobs, openSpecs }) }))),
      });
    });
    await page.goto(`${base}/specs?q=no-match&state=active`);
    expect(await page.getByRole("link", { name: "Specs (1)", exact: true }).count()).toBe(1);
    await page.getByRole("link", { name: "Jobs (0)", exact: true }).waitFor();
    await page.evaluate(() => (window as unknown as { showCounts: (n: number, o?: number) => void }).showCounts(4));
    expect(await page.getByRole("link", { name: "Jobs (4)", exact: true }).count()).toBe(1);
    await page.evaluate(() => (window as unknown as { showCounts: (n: number, o?: number) => void }).showCounts(5));
    expect(await page.getByRole("link", { name: "Jobs (5)", exact: true }).count()).toBe(1);
    expect(await page.getByRole("link", { name: "Specs (7)", exact: true }).count()).toBe(1);
    await page.evaluate(() => (window as unknown as { showCounts: (n: number, o?: number) => void }).showCounts(0, 0));
    await page.getByRole("link", { name: "Jobs (0)", exact: true }).waitFor();
    await page.getByRole("link", { name: "Specs (0)", exact: true }).waitFor();
  } finally { await page.close(); }
});
