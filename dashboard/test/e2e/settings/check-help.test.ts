// What an AI's one Check reads sits behind a "(?)" inside its Check form,
// hidden until the reader opens it. Only a real browser opens a
// `<details>` on a press.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { t } from "../../../src/i18n";
import { TOOL_TABS } from "../../../src/render";
import { checkHelp } from "../../../src/render/pages/settings-page/tools.ts";

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

/** Opens an AI's tab, checks the explanation is hidden, opens its Check
 *  form's "(?)", and hands back the popover's text. */
async function openHelp(tool: string, hidden: string): Promise<string> {
  const address = `/settings?tab=${tool}`;
  await withBrowser(page.goto(`${base}${address}`), `page.goto(${address})`);
  expect(await page.getByText(hidden, { exact: false }).first().isVisible()).toBe(false);
  const help = page.locator(`#check-${tool} details.intro`);
  expect(await help.count()).toBe(1);
  await help.locator("summary").click();
  expect(await help.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  return (await help.locator("p").innerText()).trim();
}

for (const tool of TOOL_TABS) {
  test(`${tool}: what its Check reads is behind the (?) in its Check form`, async () => {
    const lead = t("en", "settings.checkHelpAll");
    expect(checkHelp("en", tool)).toContain(lead);
    expect(await openHelp(tool, lead)).toContain(lead);
  });
}
