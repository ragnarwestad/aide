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
