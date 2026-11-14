// On a phone a phase line's AI and model fold into one button that opens a
// panel with the two choices. The Review and Verify lines under Implement
// fold the same way: only a browser at a phone's width draws the fold. They
// are drawn on the Jobs tab, in an open spec that has had an Implement.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-side-pickers-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const queueDefaults = {
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { default: "sonnet" },
    modelChoices: { sonnet: {}, fable: {} },
    providers: { Personal: { name: "Claude Personal", short: "CP", tool: "claude" as const } },
  };
  const implemented = {
    id: "impl1", project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"], stepIndex: 0, state: "done",
    timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-11-13T08:00:00Z", startedAt: "2026-11-13T08:00:00Z",
    finishedAt: "2026-11-13T08:10:00Z", results: [{ step: "implement", ok: true }],
  };
  base = harness.start({ extra: { queueDefaults }, queueMirror: JSON.stringify([implemented]) }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

for (const part of ["review", "verify"]) {
  test(`the ${part} line's AI and model open from one button, as a phase line's do`, async () => {
    await withBrowser(page.goto(`${base}/?open=aide/81-queue-and-runner&live=0`), "page.goto(Jobs)");
    const line = `tr.subrow[data-side="${part}"]`;
    const model = page.locator(`${line} select[name="model.${part}"]`);
    await page.waitForSelector(line);
    expect(await model.isVisible()).toBe(false);
    await page.click(`${line} label.aimodelnow`);
    expect(await model.isVisible()).toBe(true);
  });
}

for (const width of [390, 500]) {
  test(`at ${width}px each line's button shows its provider's short name (AC-8)`, async () => {
    await page.setViewportSize({ width, height: 844 });
    try {
      await withBrowser(page.goto(`${base}/?open=aide/81-queue-and-runner&live=0`), "page.goto(Jobs)");
      await page.waitForSelector('tr.subrow[data-side="review"]');
      const shorts = page.locator("label.aimodelnow .providershort");
      expect(await shorts.count()).toBeGreaterThan(2);
      for (const short of await shorts.all()) {
        expect(await short.isVisible()).toBe(true);
        expect(await short.textContent()).toBe("CP");
      }
    } finally {
      await page.setViewportSize({ width: 390, height: 844 });
    }
  });
}

test("on desktop the provider can be selected beside the model", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  try {
    await withBrowser(page.goto(`${base}/?open=aide/81-queue-and-runner&live=0`), "page.goto(Jobs)");
    const provider = page.locator('tr.subrow[data-side="review"] select[data-ai]');
    await provider.waitFor({ state: "attached" });
    expect(await provider.isVisible()).toBe(true);
    await provider.selectOption("Personal");
    expect(await provider.inputValue()).toBe("Personal");
  } finally {
    await page.setViewportSize({ width: 390, height: 844 });
  }
});
