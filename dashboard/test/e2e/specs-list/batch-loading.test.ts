import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { fakeGit } from "../../helpers/fake-git.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-spec-batches-");
let browser: Browser;
let base: string;
beforeAll(async () => {
  browser = await chromium.launch();
  base = harness.start({ extra: { specCachePollMs: 0, gitRun: fakeGit({}).run }, alsoSpecs: Array.from({ length: 165 }, (_, i) => `${200 + i}-batch`) }).base;
});
afterAll(async () => { await browser.close(); harness.cleanup(); });

for (const automatic of [false, true]) {
  test(`Specs ${automatic ? "automatically loads" : "offers Show more for"} the next batch and retains open detail (AC-2, AC-3, AC-7)`, async () => {
    const page = await browser.newPage();
    try {
      if (!automatic) await page.addInitScript(() => { Object.defineProperty(window, "IntersectionObserver", { value: undefined }); });
      await page.goto(`${base}/specs?live=0&state=all`);
      const older = page.locator('tr.spechead[data-folder="200-batch"]');
      expect(await older.count()).toBe(0);
      await page.locator('tr.spechead[data-folder="364-batch"] a.fold').click();
      const detail = page.locator('tr[data-spec-detail="aide/364-batch"]');
      await detail.waitFor();
      const more = page.getByRole("link", { name: "Show more", exact: true });
      if (automatic) await page.evaluate(() => document.querySelector("a[data-list-more]")?.scrollIntoView());
      else await more.click();
      await older.waitFor();
      await detail.waitFor();
      expect(new URL(page.url()).searchParams.get("limit")).toBe("200");
      await detail.getByRole("link", { name: "Analysis", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("tab") === "analysis");
      expect(new URL(page.url()).searchParams.get("limit")).toBe("200");
      await older.waitFor();
      await page.getByRole("searchbox").fill("200-batch");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("q") === "200-batch");
      expect(new URL(page.url()).searchParams.has("limit")).toBe(false);
      await older.waitFor();
    } finally { await page.close(); }
  });
}
