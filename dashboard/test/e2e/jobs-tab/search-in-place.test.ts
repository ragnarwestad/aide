// The search box above the rows asks in place, as the filter links do: a
// search draws the rows again without loading the page, and a search for
// the term already shown, an empty one included, asks nothing at all.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { createdJob, queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-search-in-place-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  base = harness.start({ queueMirror: JSON.stringify([createdJob()]) }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** Counts the page loads and the rows' redraws after this call. */
const watch = (page: Page): { loads: number; redraws: number } => {
  const seen = { loads: 0, redraws: 0 };
  page.on("load", () => seen.loads++);
  page.on("request", (req) => {
    if (new URL(req.url()).searchParams.get("rows") === "1") seen.redraws++;
  });
  return seen;
};

const search = (page: Page) => page.getByRole("button", { name: "Search", exact: true }).click();

for (const path of ["/", "/specs"]) {
  test(`a search on ${path} draws the rows in place, and one for the term already shown asks nothing`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}${path}?live=0`);
      await page.getByRole("searchbox").waitFor();
      const seen = watch(page);

      await search(page);
      await page.waitForTimeout(300);
      expect(seen).toEqual({ loads: 0, redraws: 0 });

      await page.getByRole("searchbox").fill("queue");
      await Promise.all([page.waitForResponse((res) => new URL(res.url()).searchParams.get("rows") === "1"), search(page)]);
      expect(new URL(page.url()).searchParams.get("q")).toBe("queue");
      expect(new URL(page.url()).pathname).toBe(path);

      await search(page);
      await page.waitForTimeout(300);
      expect(seen).toEqual({ loads: 0, redraws: 1 });
    } finally {
      await page.close();
    }
  });
}


test("Jobs loads further history in place and searches history outside the loaded window", async () => {
  const history = queueHarness("aide-e2e-job-window-");
  const folders = Array.from({ length: 65 }, (_, i) => `schedule-window-history-${i}`);
  const jobs = folders.map((folder, i) => ({ ...createdJob(folder), steps: ["schedule"], createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const { base } = history.start({ queueMirror: JSON.stringify(jobs) });
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?live=0`);
    const older = page.locator('[id="spec-aide/schedule-window-history-0"]');
    expect(await older.count()).toBe(0);
    const loaded = page.waitForResponse((res) => new URL(res.url()).searchParams.get("rows") === "1");
    await page.getByRole("link", { name: "Show more", exact: true }).click();
    await loaded;
    await older.waitFor();
    expect(new URL(page.url()).searchParams.get("limit")).toBe("100");

    await page.goto(`${base}/?live=0`);
    await page.getByRole("searchbox").fill("window-history-0");
    await search(page);
    await older.waitFor();
    expect(new URL(page.url()).searchParams.get("q")).toBe("window-history-0");

    await page.goto(`${base}/?live=0&open=aide%2Fschedule-window-history-0`);
    await older.waitFor();
  } finally {
    await page.close();
    history.cleanup();
  }
});
