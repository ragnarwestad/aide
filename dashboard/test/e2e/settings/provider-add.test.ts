// What only a browser does in the Add dialog on the Providers tab: the
// three steps, the ID made from the name, only the chosen tool's fields
// posted, the login command written as they are typed, a refusal kept in
// the dialog, and Cancel starting it over.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  browserDeadline,
  withBrowser,
} from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-provider-add-");
let browser: Browser;
let page: Page;
let base: string;

const PROVIDERS = {
  Claude: { name: "Claude", tool: "claude" as const },
  OpenCode: { name: "OpenCode", tool: "opencode" as const },
};
const AT = "2026-11-05T09:00:00.000Z";

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "aide-e2e-provider-add-config-"));
  const file = join(scratch, "queue-config.json");
  writeFileSync(file, JSON.stringify({ providers: PROVIDERS }, null, 2));
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start({
    extra: {
      queueConfigFile: file,
      queueDefaults: {
        timeoutSec: { default: 1200 },
        permissionMode: { default: "acceptEdits" },
        model: { default: "sonnet" },
        providers: structuredClone(PROVIDERS),
      },
      providerProbe: async (key: string) => ({ key, at: AT, installed: true }),
      usageProbe: async (
        _key: string,
        provider: { tool: "claude" | "codex" | "opencode" },
      ) => ({ tool: provider.tool, at: AT, windows: [] }),
    },
  }).base;
});

beforeEach(async () => {
  page = await browser.newPage();
});
afterEach(async () => {
  await page.close();
});
afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

let scratch = "";
const go = (address: string) =>
  withBrowser(page.goto(`${base}${address}`), `page.goto(${address})`);

const dialog = () => page.locator("dialog#provider-add");
const next = () => dialog().locator("button[data-add-next]");

async function openAdd(): Promise<void> {
  await go("/settings?tab=providers");
  await page.locator("button.iconlink[data-ask=provider-add]").click();
  await dialog().waitFor({ state: "visible" });
}

test("Add walks the three steps, makes the ID from the name, and lands on the new provider", async () => {
  await openAdd();
  await dialog().locator(".toolcard", { hasText: "Claude" }).click();
  await dialog().locator('input[name="name"]').fill("Claude Work");
  expect(await dialog().locator('input[name="providerId"]').inputValue()).toBe(
    "claude-work",
  );
  await next().click();
  const folder = join(scratch, "claude-work");
  await dialog().locator("#provider-add-claude-configDir").fill(folder);
  expect(await dialog().locator("[data-login-command]").innerText()).toBe(
    `CLAUDE_CONFIG_DIR=${folder} claude auth login`,
  );
  expect(
    await dialog().locator("#provider-add-codex-codexHome").isVisible(),
  ).toBe(false);
  await Promise.all([
    page.waitForURL("**/settings?tab=providers&provider=claude-work"),
    dialog().locator("button[data-add-save]").click(),
  ]);
  expect(await page.locator(".providerlist").innerText()).toContain(
    "Claude Work",
  );
  await page.locator(`nav[data-aitabs] a`, { hasText: "Config" }).click();
  expect(
    await page.locator('#provider-form input[name="configDir"]').inputValue(),
  ).toBe(folder);
});

test("Next does not leave a step whose fields are not filled in", async () => {
  await openAdd();
  await next().click();
  expect(await dialog().locator('.addstep[data-step="1"]').isVisible()).toBe(
    true,
  );
  await dialog().locator(".toolcard", { hasText: "OpenCode" }).click();
  await next().click();
  expect(await dialog().locator('.addstep[data-step="2"]').isVisible()).toBe(
    true,
  );
});

test("a refused Add stays in the dialog with the reason, and Cancel starts it over empty", async () => {
  await openAdd();
  await dialog().locator(".toolcard", { hasText: "Codex" }).click();
  await dialog().locator('input[name="name"]').fill("Claude");
  await next().click();
  await dialog().locator("button[data-add-save]").click();
  await dialog()
    .locator("#provider-add-refused span", { hasText: /Claude/ })
    .waitFor();
  expect(await dialog().isVisible()).toBe(true);
  await dialog().locator("button[data-add-close]").click();
  await dialog().waitFor({ state: "hidden" });
  await page.locator("button.iconlink[data-ask=provider-add]").click();
  expect(await dialog().locator('.addstep[data-step="1"]').isVisible()).toBe(
    true,
  );
  expect(await dialog().locator('input[name="name"]').inputValue()).toBe("");
  expect(await dialog().locator("#provider-add-refused").innerText()).toBe("");
});
