// Spec 514, AC-1: where the knob of the Notifications switch sits, and
// what colour its track is, in a real browser — layout and paint exist
// only there. Run by the user.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-notifications-switch-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  base = harness.start({}).base;
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** The knob's box against its track's, and the track's colour, with the switch set to `checked`. */
async function measure(checked: boolean) {
  await page.evaluate((on) => {
    document.querySelector("#push-toggle")!.setAttribute("aria-checked", String(on));
  }, checked);
  return page.evaluate(() => {
    const sw = document.querySelector("#push-toggle")!;
    const track = sw.querySelector(".switchtrack")!.getBoundingClientRect();
    const knob = sw.querySelector(".switchknob")!.getBoundingClientRect();
    return {
      leftGap: knob.left - track.left,
      rightGap: track.right - knob.right,
      colour: getComputedStyle(sw.querySelector(".switchtrack")!).backgroundColor,
    };
  });
}

test("the knob sits at the right end when on and at the left end when off, and the track's colour differs (AC-1)", async () => {
  await page.goto(`${base}/settings?tab=notifications`);
  await page.waitForFunction(() => !document.querySelector("[data-push-status]")!.textContent!.startsWith("Checking"));
  const off = await measure(false);
  const on = await measure(true);
  expect(off.leftGap).toBeLessThan(off.rightGap);
  expect(on.rightGap).toBeLessThan(on.leftGap);
  expect(on.colour).not.toBe(off.colour);
});
