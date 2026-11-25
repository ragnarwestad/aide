import { expect, test } from "bun:test";
import type { Browser } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { e2eBrowser } from "../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../helpers/queue-server.ts";
import type { Provider } from "../../src/queue/providers/index.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-usage-dialog-");
let browser: Browser;
let base: string;

e2eBrowser(harness, (launched) => {
  browser = launched;
  base = harness.start({ extra: {
    queueDefaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" }, providers: {
      Claude: { name: "Claude", tool: "claude" }, Codex: { name: "Codex", tool: "codex" },
    } },
    usageProbe: async (_key: string, provider: Provider) => ({ tool: provider.tool, at: new Date().toISOString(), windows: [{ name: "Session", usedPercent: 25, resets: "tomorrow" }] }),
  } }).base;
});

test("Usage shares the header menus: toggle, switching, outside click and Escape", async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/settings`);
  const trigger = page.locator("header summary[aria-label='Usage']");
  const panel = page.locator("[data-usage-content]");
  await trigger.click();
  await panel.waitFor({ state: "visible" });
  await panel.getByRole("heading", { name: "Claude Code", exact: true }).waitFor();
  expect(await panel.innerText()).toContain("Codex");
  await trigger.click();
  await panel.waitFor({ state: "hidden" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await panel.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await trigger.click();
  await page.locator("header summary[aria-label='Color scheme']").click();
  await panel.waitFor({ state: "hidden" });
  await trigger.click();
  await page.getByRole("heading", { name: "Settings", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  await page.close();
});
