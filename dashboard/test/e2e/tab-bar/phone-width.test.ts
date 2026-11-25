import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-tab-bar-");
let page: Page;
let base: string;

e2eBrowser(harness, async (browser) => {
  page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  base = harness.start().base;
  await withBrowser(page.goto(`${base}/?lang=es`), "page.goto(Jobs)");
});

test("phone tabs keep their accessible names", async () => {
  const tabs = page.locator("body > nav.tabbar a.tab");
  expect(await tabs.count()).toBe(4);
  for (const name of ["Trabajos", "Especificaciones", "Proyectos", "Programación"]) {
    expect(await page.getByRole("link", { name: new RegExp(`^${name}( \\(\\d+\\))?$`) }).count()).toBe(1);
  }
});
