// Each of the New spec form's three acceptance criteria controls carries a
// "(?)" of its own, and a press on it opens what that control does. Only a
// real browser opens a `<details>` on a press.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-new-spec-help-");
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

// The field holding the control, by the control's own name or id; its
// "(?)" sits in that field's own head.
const CONTROLS: [string, string][] = [
  ["Acceptance ticking required", '.field:has(> .fieldhead [name="acceptanceRequired"])'],
  ["Let AI formulate acceptance criteria", '.field:has(> .fieldhead [name="aiFormulateAcceptance"])'],
  ["Acceptance criteria checks", ".field:has(> .fieldhead #new-spec-criteria-checks)"],
];

test.each(CONTROLS)("the (?) of %s opens an explanation (AC-3)", async (_label, fieldSelector) => {
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  const help = page.locator(`#new-spec-form ${fieldSelector} > .fieldhead details.intro`);
  expect(await help.count()).toBe(1);
  await help.locator("summary").click();
  expect(await help.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  expect((await help.locator("p").innerText()).trim()).not.toBe("");
});

test("Let me choose the approach is not ticked when the form opens, and its (?) explains it (AC-1)", async () => {
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  const box = page.locator('#new-spec-form [name="chooseApproach"]');
  expect(await box.isChecked()).toBe(false);
  const help = page.locator('#new-spec-form .field:has(> .fieldhead [name="chooseApproach"]) > .fieldhead details.intro');
  expect(await help.count()).toBe(1);
  await help.locator("summary").click();
  expect(await help.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  expect((await help.locator("p").innerText()).trim()).not.toBe("");
});
