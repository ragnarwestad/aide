// One browser per browser-test file: launched before the file's tests,
// closed after them, and the file's test board cleaned up after that;
// a page on the Running tab of a fresh board; and the wait for what the
// board reaches by its own poll.
import { afterAll, beforeAll } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { withBrowser } from "../browser-deadline.ts";
import { ran, type QueueHarness } from "../queue-server.ts";

/** Registers the calling file's `beforeAll`, which launches chromium and
 *  then runs `start` with it — where the file opens its pages and starts
 *  its board — and its `afterAll`, which closes the browser and then
 *  calls `board.cleanup()`. */
export function e2eBrowser(board: { cleanup(): void }, start: (browser: Browser) => unknown): void {
  let browser: Browser;
  beforeAll(async () => {
    browser = await withBrowser(chromium.launch(), "chromium.launch()");
    await start(browser);
  });
  afterAll(async () => {
    await browser.close();
    board.cleanup();
  });
}

/** Starts `board` with its spec on no step run, and opens a new page on its
 *  Running tab once the board has had 400 ms to settle. */
export async function pageOnRunning(browser: Browser, board: QueueHarness): Promise<{ page: Page; base: string }> {
  const page = await browser.newPage();
  const started = board.start();
  ran(started.dir, []);
  await new Promise((r) => setTimeout(r, 400));
  await withBrowser(page.goto(`${started.base}/?live=0`), "page.goto(/?live=0)");
  return { page, base: started.base };
}

/** Poll until a condition holds, or give up saying which one did not.
 *  For anything the board reaches by its OWN poll rather than by the
 *  write that caused it: a fixed sleep has to guess how long that poll
 *  takes, and a guess that is long enough on an idle machine is not long
 *  enough on a loaded one. */
export async function waitUntil(cond: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= deadline) throw new Error(`${label} did not happen within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
