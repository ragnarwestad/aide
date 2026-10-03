// What a press of Check finds out sits behind a "(?)" inside each AI tab's
// Check form, hidden until the reader opens it. Only a real browser opens a
// `<details>` on a press.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { t } from "../../../src/i18n";
import { TOOL_TABS } from "../../../src/render/pages/settings-page/tools.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-check-help-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start().base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** Opens the tab, checks the explanation is hidden, opens the Check form's
 *  "(?)", and hands back the popover's text. */
async function openHelp(tool: string, hidden: string): Promise<string> {
  await withBrowser(page.goto(`${base}/settings?tab=${tool}`), `page.goto(/settings?tab=${tool})`);
  expect(await page.getByText(hidden, { exact: false }).first().isVisible()).toBe(false);
  const help = page.locator(`#check-${tool} details.intro`);
  expect(await help.count()).toBe(1);
  await help.locator("summary").click();
  expect(await help.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  return (await help.locator("p").innerText()).trim();
}

test.each([...TOOL_TABS])("%s: what Check finds out is behind the (?) in the Check form (AC-2)", async (tool) => {
  const can = t("en", `settings.checkCan.${tool}`);
  expect(await openHelp(tool, can)).toContain(can);
});

test("Copilot: what the check cannot tell is behind the same (?) (AC-3)", async () => {
  const cannot = t("en", "settings.checkCannot.copilot");
  const shown = await openHelp("copilot", cannot);
  expect(shown).toContain(cannot);
  expect(shown).toContain(t("en", "settings.checkCan.copilot"));
});
