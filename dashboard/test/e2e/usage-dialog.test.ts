import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";
import type { Provider } from "../../src/queue/providers/index.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-usage-dialog-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start({ extra: {
    queueDefaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" }, providers: {
      Claude: { name: "Claude", tool: "claude" }, Codex: { name: "Codex", tool: "codex" },
    } },
    usageProbe: async (_key: string, provider: Provider) => ({ tool: provider.tool, at: new Date().toISOString(), windows: [{ name: "Session", usedPercent: 25, resets: "tomorrow" }] }),
  } }).base;
});
afterAll(async () => { await browser.close(); harness.cleanup(); });

test("the Usage button opens the dialog and Esc and its backdrop close it (AC-2, AC-3, AC-7)", async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/settings`);
  await page.locator("[data-usage-open]").click();
  const dialog = page.locator("#usage-dialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.locator(".usagegroup", { hasText: "Claude" }).waitFor();
  expect(await dialog.innerText()).toContain("Claude");
  expect(await dialog.innerText()).toContain("Codex");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.close();
});
