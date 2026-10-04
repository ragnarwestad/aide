// What each of an AI's three Checks reads sits behind a "(?)" inside that
// tab's Check form, hidden until the reader opens it. Only a real browser
// opens a `<details>` on a press.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { t } from "../../../src/i18n";
import { TOOL_PARTS, TOOL_TABS } from "../../../src/render";

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

/** Opens one tab inside an AI's tab, checks the explanation is hidden,
 *  opens its Check form's "(?)", and hands back the popover's text. */
async function openHelp(tool: string, part: string, hidden: string): Promise<string> {
  const address = `/settings?tab=${tool}&aitab=${part}`;
  await withBrowser(page.goto(`${base}${address}`), `page.goto(${address})`);
  expect(await page.getByText(hidden, { exact: false }).first().isVisible()).toBe(false);
  const help = page.locator(`#check-${tool}-${part} details.intro`);
  expect(await help.count()).toBe(1);
  await help.locator("summary").click();
  expect(await help.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  return (await help.locator("p").innerText()).trim();
}

for (const tool of TOOL_TABS) {
  test.each([...TOOL_PARTS])(`${tool}: what the %s tab's Check reads is behind the (?) in its Check form (AC-3)`, async (part) => {
    const help = t("en", `settings.checkHelp.${part}.${tool}`);
    expect(await openHelp(tool, part, help)).toBe(help);
  });
}
