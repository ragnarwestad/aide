// What only a browser does on the Providers page: a click on a provider in
// the list, the pending label while a save is out, Cancel putting back what
// was saved, Remove asking first, a refused save keeping what was typed,
// the on/off switch, and the usage and the Models tab's reading filled in after the tab has drawn.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { AT, startProviderBoard } from "./provider-fixtures.ts";
import { t } from "../../../src/i18n";

browserDeadline();

const harness = queueHarness("aide-e2e-provider-page-");
let browser: Browser;
let page: Page;
let base: string;

e2eBrowser(harness, (launched) => {
  browser = launched;
  base = startProviderBoard(harness, "aide-e2e-provider-config-", {
    toolProbe: {
      check: async (tool: "claude" | "codex" | "opencode") => ({ tool, at: AT, found: true, extra: [] }),
      models: async (tool: "claude" | "codex" | "opencode") => ({ tool, at: AT, offered: [{ model: "opus" }] }),
    },
  }).base;
});

beforeEach(async () => {
  page = await browser.newPage();
});
afterEach(async () => {
  await page.close();
});

const go = (address: string) => withBrowser(page.goto(`${base}${address}`), `page.goto(${address})`);

const CLAUDE = "/providers?provider=Claude";
const CLAUDE_CONFIG = `${CLAUDE}&aitab=config`;

test("a click on a provider in the list shows it beside the list without loading the page again (AC-7)", async () => {
  await go("/providers");
  await page.evaluate(() => { (window as unknown as { stayed: boolean }).stayed = true; });
  await page.locator(".provideritem", { hasText: "OpenCode" }).click();
  await page.locator("h3", { hasText: "OpenCode" }).waitFor();
  expect(page.url()).toContain("/providers?provider=OpenCode");
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
  await page.goBack();
  await page.getByRole("heading", { name: "Claude", exact: true }).waitFor();
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
  await go("/providers?provider=OpenCode");
  const dialog = page.locator('dialog[id="provider-remove-ask"]');
  await page.locator('button[data-ask="provider-remove-ask"]').click();
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: t("en", "dialog.cancel") }).click();
  await dialog.waitFor({ state: "hidden" });
  await go("/providers");
  expect(await page.locator(".providerlist").innerText()).toContain("OpenCode");

  await go("/providers?provider=OpenCode");
  await page.locator('button[data-ask="provider-remove-ask"]').click();
  await Promise.all([
    page.waitForURL("**/providers"),
    page.locator('dialog[id="provider-remove-ask"]').getByRole("button", { name: t("en", "dialog.ok") }).click(),
  ]);
  expect(await page.locator(".providerlist").innerText()).not.toContain("OpenCode");
});
