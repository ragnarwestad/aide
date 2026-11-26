// Switching to Installation shows the provider check result in the browser.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const SENTENCE =
  "Claude Code is installed in the usual place and was found on the path, and every one of the settings files that Aide writes is where it should be";

const harness = queueHarness("aide-e2e-ai-panel-width-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start({
    extra: {
      queueDefaults: {
        timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" },
        providers: { Claude: { name: "Claude", tool: "claude" } },
      },
      providerProbe: async (key: string) => ({ key, at: "2026-11-05T09:00:00.000Z", installed: true }),
      usageProbe: async () => ({ tool: "claude" as const, at: "2026-11-05T09:00:00.000Z", windows: [] }),
      toolProbe: {
        check: async () => ({
          tool: "claude" as const, at: new Date().toISOString(),
          found: false, error: SENTENCE, extra: [],
        }),
        models: async () => ({ tool: "claude" as const, at: new Date().toISOString(), offered: [] }),
      },
    },
  }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

async function open(part: string): Promise<void> {
  const address = `/providers?provider=Claude&aitab=${part}`;
  await withBrowser(page.goto(`${base}${address}`), `page.goto(${address})`);
}

async function clickTab(name: string, part: string): Promise<void> {
  const tabs = page.locator("nav[data-aitabs]");
  await Promise.all([
    page.waitForURL(`**/providers?provider=Claude&aitab=${part}`),
    tabs.getByRole("link", { name, exact: true }).click(),
  ]);
}

test("switching to Installation shows the provider check result", async () => {
  await open("models");
  await clickTab("Installation", "installation");
  expect(await page.getByText(SENTENCE).count()).toBeGreaterThan(0);
});
