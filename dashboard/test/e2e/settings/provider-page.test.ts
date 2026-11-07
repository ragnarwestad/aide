// What only a browser does on the Providers tab: a click on a provider in
// the list, the pending label while a save is out, Cancel putting back what
// was saved, Remove asking first, a refused save keeping what was typed,
// the on/off switch, and the usage and the Models tab's reading filled in after the tab has drawn.
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
      toolProbe: {
        check: async (tool: "claude" | "codex" | "opencode") => ({ tool, at: AT, found: true, lines: [], extra: [] }),
        models: async (tool: "claude" | "codex" | "opencode") => ({ tool, at: AT, offered: [{ model: "opus" }] }),
      },
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

const CLAUDE = "/settings?tab=providers&provider=Claude";
const CLAUDE_CONFIG = `${CLAUDE}&aitab=config`;

test("a click on a provider in the list shows it beside the list without loading the page again (AC-7)", async () => {
  await go("/settings?tab=providers");
  await page.evaluate(() => { (window as unknown as { stayed: boolean }).stayed = true; });
  await page.locator(".provideritem", { hasText: "OpenCode" }).click();
  await page.locator("h3", { hasText: "OpenCode" }).waitFor();
  expect(page.url()).toContain("/settings?tab=providers&provider=OpenCode");
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
  await page.goBack();
  await page.locator("h3", { hasText: "Claude" }).waitFor();
});

test("Save shows its pending label while the post is out (AC-10, AC-11)", async () => {
  await go(CLAUDE_CONFIG);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/queue/settings/providers/edit", async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('#provider-form input[name="name"]').fill("Claude-Capra");
  const save = page.locator("#providerform-save");
  await save.click();
  expect((await save.innerText()).toLowerCase()).toBe(t("en", "list.checksSaving").toLowerCase());
  release();
  await page.locator(".providerlist", { hasText: "Claude-Capra" }).waitFor();
});

test("Cancel puts back what was saved (AC-12)", async () => {
  await go(CLAUDE_CONFIG);
  const saved = await page.locator('#provider-form input[name="name"]').inputValue();
  await page.locator('#provider-form input[name="name"]').fill("Never-saved");
  await page.locator("#providerform-cancel").click();
  await page.waitForURL(`**${CLAUDE_CONFIG}`);
  expect(await page.locator('#provider-form input[name="name"]').inputValue()).toBe(saved);
  expect(await page.locator(".providerlist").innerText()).not.toContain("Never-saved");
});

test("a save the board refuses is written in the form's own line and every field keeps what was typed (AC-18)", async () => {
  await go(CLAUDE_CONFIG);
  await page.locator('#provider-form input[name="name"]').fill("opencode");
  await page.locator("#providerform-save").click();
  await page.locator("#provider-refused span", { hasText: /opencode/i }).waitFor();
  expect((await page.locator("#provider-refused").innerText()).toLowerCase()).toContain("opencode");
  expect(await page.locator('#provider-form input[name="name"]').inputValue()).toBe("opencode");
});

test("a press on a provider's switch turns it off, and a second press on again", async () => {
  await go(CLAUDE);
  const toggle = () => page.locator('form:has(input[name="key"][value="Claude"]) button[role="switch"]');
  expect(await toggle().getAttribute("aria-checked")).toBe("true");
  await toggle().click();
  await page.locator('form:has(input[name="key"][value="Claude"]) button[role="switch"][aria-checked="false"]').waitFor();
  await toggle().click();
  await page.locator('form:has(input[name="key"][value="Claude"]) button[role="switch"][aria-checked="true"]').waitFor();
});

test("Remove asks first, removes nothing on Cancel, and removes the provider on OK (AC-13)", async () => {
  await go("/settings?tab=providers&provider=OpenCode");
  const dialog = page.locator('dialog[id="provider-remove-ask"]');
  await page.locator('button[data-ask="provider-remove-ask"]').click();
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: t("en", "dialog.cancel") }).click();
  await dialog.waitFor({ state: "hidden" });
  await go("/settings?tab=providers");
  expect(await page.locator(".providerlist").innerText()).toContain("OpenCode");

  await go("/settings?tab=providers&provider=OpenCode");
  await page.locator('button[data-ask="provider-remove-ask"]').click();
  await Promise.all([
    page.waitForURL("**/settings?tab=providers"),
    page.locator('dialog[id="provider-remove-ask"]').getByRole("button", { name: t("en", "dialog.ok") }).click(),
  ]);
  expect(await page.locator(".providerlist").innerText()).not.toContain("OpenCode");
});

test("the chosen provider's usage is read after the tab has drawn, and filled in where the tab left room for it", async () => {
  await go(CLAUDE);
  await page.locator(".usageslot", { hasText: t("en", "settings.usage.none") }).waitFor();
  expect(await page.locator(".usageslot[data-read-from]").count()).toBe(0);
});

test("opening the Models tab reads the models with no press, and fills the place where the tab left room for it", async () => {
  await go(`${CLAUDE}&aitab=models`);
  await page.locator(".readslot", { hasText: t("en", "settings.models.available") }).waitFor();
  expect(await page.locator(".readslot[data-read-from]").count()).toBe(0);
  expect(await page.locator('form[action="/api/queue/settings/check"]').count()).toBe(0);
});
