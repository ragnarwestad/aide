// What only a browser does on a provider's page: a click on a row of the
// Providers table, the pending label while a save is out, Cancel leaving
// without saving, Remove asking first, and a refused save keeping what was
// typed.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { t } from "../../../src/i18n";

browserDeadline();

const harness = queueHarness("aide-e2e-provider-page-");
let browser: Browser;
let page: Page;
let base: string;

const PROVIDERS = {
  Claude: { name: "Claude", tool: "claude" as const },
  OpenCode: { name: "OpenCode", tool: "opencode" as const },
};
const AT = "2026-11-05T09:00:00.000Z";

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "aide-e2e-provider-config-"));
  const file = join(scratch, "queue-config.json");
  writeFileSync(file, JSON.stringify({ providers: PROVIDERS }, null, 2));
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start({
    extra: {
      queueConfigFile: file,
      queueDefaults: {
        timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" },
        providers: structuredClone(PROVIDERS),
      },
      providerProbe: async (key: string) => ({ key, at: AT, installed: true }),
      usageProbe: async (_key: string, provider: { tool: "claude" | "codex" | "opencode" }) => ({ tool: provider.tool, at: AT, windows: [] }),
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

const go = (address: string) => withBrowser(page.goto(`${base}${address}`), `page.goto(${address})`);

test("a click on a row of the Providers table opens that provider's page (AC-7)", async () => {
  await go("/settings?tab=providers");
  await Promise.all([
    page.waitForURL("**/settings/providers/edit?key=OpenCode"),
    page.locator('tr[data-row-href*="key=OpenCode"] td').first().click(),
  ]);
  expect(await page.locator('input[name="name"]').inputValue()).toBe("OpenCode");
});

test("Save shows its pending label while the post is out (AC-10, AC-11)", async () => {
  await go("/settings/providers/edit?key=Claude");
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/queue/settings/providers/edit", async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('input[name="name"]').fill("Claude-Capra");
  const save = page.locator("#providerform-save");
  await save.click();
  expect((await save.innerText()).toLowerCase()).toBe(t("en", "list.checksSaving").toLowerCase());
  release();
  await page.waitForURL("**/settings?tab=providers");
});

test("Cancel returns to the Providers tab without saving (AC-12)", async () => {
  await go("/settings/providers/edit?key=Claude");
  await page.locator('input[name="name"]').fill("Never-saved");
  await Promise.all([page.waitForURL("**/settings?tab=providers"), page.locator("#providerform-cancel").click()]);
  expect(await page.locator("table.settingstable").innerText()).not.toContain("Never-saved");
  expect(await page.locator("table.settingstable").innerText()).toContain("Claude");
});

test("a save the board refuses is written in the form's own line and every field keeps what was typed (AC-18)", async () => {
  await go("/settings/providers/edit?key=Claude");
  await page.locator('input[name="name"]').fill("two words");
  await page.locator("#providerform-save").click();
  await page.locator("#provider-refused span", { hasText: /two words/i }).waitFor();
  expect((await page.locator("#provider-refused").innerText()).toLowerCase()).toContain("two words");
  expect(await page.locator('input[name="name"]').inputValue()).toBe("two words");
});

test("Remove asks first, removes nothing on Cancel, and removes the provider on OK (AC-13)", async () => {
  await go("/settings/providers/edit?key=OpenCode");
  const dialog = page.locator('dialog[id="provider-remove-ask"]');
  await page.locator('button[data-ask="provider-remove-ask"]').click();
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: t("en", "dialog.cancel") }).click();
  await dialog.waitFor({ state: "hidden" });
  await go("/settings?tab=providers");
  expect(await page.locator("table.settingstable").innerText()).toContain("OpenCode");

  await go("/settings/providers/edit?key=OpenCode");
  await page.locator('button[data-ask="provider-remove-ask"]').click();
  await Promise.all([
    page.waitForURL("**/settings?tab=providers"),
    page.locator('dialog[id="provider-remove-ask"]').getByRole("button", { name: t("en", "dialog.ok") }).click(),
  ]);
  expect(await page.locator("table.settingstable").innerText()).not.toContain("OpenCode");
});
