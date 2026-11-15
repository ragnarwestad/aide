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

for (const width of [1440, 390]) {
  test(`the Jobs count follows live changes, including zero, at width ${width}`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
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
          showRunning: (running: number) => streams.forEach((stream) => stream.dispatchEvent(new MessageEvent("changed", { data: JSON.stringify({ running }) }))),
        });
      });
      await page.goto(`${base}/specs`);
      await page.getByRole("link", { name: "Jobs (0)", exact: true }).waitFor();
      await page.evaluate(() => (window as unknown as { showRunning: (n: number) => void }).showRunning(5));
      expect(await page.getByRole("link", { name: "Jobs (5)", exact: true }).count()).toBe(1);
      await page.screenshot({ path: `/tmp/aide-running-count-${width}.png` });
      await page.evaluate(() => (window as unknown as { showRunning: (n: number) => void }).showRunning(0));
      await page.getByRole("link", { name: "Jobs (0)", exact: true }).waitFor();
    } finally { await page.close(); }
  });
}
