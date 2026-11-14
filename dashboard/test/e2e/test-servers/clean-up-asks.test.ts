// Clean up on the Test servers page asks first, as Deploy does: the press
// opens the question and sends nothing, and OK queues the cleanup job.
// Only a browser opens a dialog and follows its OK.
//
// By hand: `cd dashboard && bun test --timeout 20000 test/e2e/test-servers/clean-up-asks.test.ts`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-clean-up-asks-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  const started = harness.start();
  base = started.base;
  ran(started.dir, []);
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("Clean up asks first, and its OK queues the cleanup job", async () => {
  const page = await browser.newPage();
  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/queue/cleanup") posts.push(req.url());
  });
  await page.goto(`${base}/test-servers`);
  await page.getByRole("button", { name: "Clean up", exact: true }).click();
  const ask = page.locator("dialog[open]");
  await ask.getByRole("button", { name: "OK" }).waitFor({ state: "visible", timeout: 5000 });
  expect(posts).toEqual([]);
  const sent = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/queue/cleanup");
  await ask.getByRole("button", { name: "OK" }).click();
  expect((await sent).status()).toBe(200);
  expect(posts).toHaveLength(1);
  await page.close();
});
