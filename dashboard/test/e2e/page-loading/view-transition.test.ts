// A page load from one of the board's pages to another glides over with the
// browser's own view transition, and with none when the reader has asked for
// reduced motion. Only a browser decides whether a transition runs, so this
// is a browser test: a `pagereveal` listener, set before the page is drawn,
// records whether the reveal carried a transition.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-view-transition-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start().base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** From the Running tab, a click on the Specs tab; what the Specs page's
 *  `pagereveal` said about a transition. */
async function revealOnSpecs(reducedMotion: "reduce" | "no-preference"): Promise<string | null> {
  const context = await browser.newContext({ reducedMotion });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.addEventListener("pagereveal", (e) => {
        sessionStorage.setItem("reveal", (e as unknown as { viewTransition: unknown }).viewTransition ? "transition" : "none");
      });
    });
    await withBrowser(page.goto(`${base}/?live=0`), "page.goto(Running)");
    await withBrowser(
      Promise.all([page.waitForURL(/\/specs/), page.locator('a[href="/specs"]:visible').first().click()]),
      "click the Specs tab",
    );
    return await page.evaluate(() => sessionStorage.getItem("reveal"));
  } finally {
    await context.close();
  }
}

describe("pages of the board change with a view transition", () => {
  test("from the Running tab to Specs the new page is revealed with a transition (AC-1)", async () => {
    expect(await revealOnSpecs("no-preference")).toBe("transition");
  });

  test("with reduced motion asked for, the new page is revealed with none (AC-2)", async () => {
    expect(await revealOnSpecs("reduce")).toBe("none");
  });
});
