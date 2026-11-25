// Each of the New spec form's three spec settings carries a
// "(?)" of its own, and a press on it opens what that control does. Only a
// real browser opens a `<details>` on a press.
import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-new-spec-help-");
let page: Page;
let base: string;

e2eBrowser(harness, async (browser) => {
  page = await browser.newPage();
  base = harness.start().base;
});

async function openForm(): Promise<void> {
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
}

// The field holding the control, by the control's own name or id; its
// "(?)" sits in that field's own head.
const CONTROLS: [string, string][] = [
  ["Acceptance ticking required", '.field:has(> .fieldhead [name="acceptanceRequired"])'],
  ["Acceptance criteria checks", ".field:has(> .fieldhead #new-spec-criteria-checks)"],
];

test.each(CONTROLS)("the (?) of %s opens an explanation", async (_label, fieldSelector) => {
  await openForm();
  const help = page.locator(`#new-spec-form ${fieldSelector} > .fieldhead details.intro`);
  expect(await help.count()).toBe(1);
  await help.locator("summary").click();
  expect(await help.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  expect((await help.locator("p").innerText()).trim()).not.toBe("");
});

test("Let me choose the approach is not ticked when the form opens, and its (?) explains it", async () => {
  await openForm();
  const box = page.locator('#new-spec-form [name="chooseApproach"]');
  expect(await box.isChecked()).toBe(false);
  const help = page.locator('#new-spec-form .field:has(> .fieldhead [name="chooseApproach"]) > .fieldhead details.intro');
  expect(await help.count()).toBe(1);
  await help.locator("summary").click();
  expect(await help.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  expect((await help.locator("p").innerText()).trim()).not.toBe("");
});
