import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";

import { CSS } from "../../../src/render/ui/css";
import { rowMessage } from "../../../src/render/ui/components";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";

browserDeadline();

const NOTICE_HOOKS = [
  "restart-notice",
  "install-warning",
  "tool-fault",
  "checkout-fault",
  "deploy-fault",
] as const;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const notices = NOTICE_HOOKS.map((hook) =>
    rowMessage(
      hook === "checkout-fault" || hook === "deploy-fault" ? "failed" : "waiting",
      `${hook}: a representative notice with enough text to exercise the shared phone layout`,
      { tag: "p", hook },
    ),
  ).join("");
  await page.setContent(`<!doctype html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${CSS}</style></head><body>
    <header><a class="brand" href="/">aide</a><div class="row">
      <details class="menu"><summary aria-label="More">...</summary></details>
    </div></header>${notices}<main></main></body></html>`);
});

afterAll(async () => {
  await browser.close();
});

async function bounds(width: number) {
  await page.setViewportSize({ width, height: 800 });
  return page.evaluate((hooks) => {
    const rect = (selector: string) => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return { left: box.left, right: box.right };
    };
    return {
      brand: rect("header .brand"),
      menu: rect("header .menu > summary"),
      notices: hooks.map((hook) => rect(`body > p.${hook}`)),
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  }, NOTICE_HOOKS);
}

function expectNoticesOnHeaderEdges(measurement: Awaited<ReturnType<typeof bounds>>) {
  for (const notice of measurement.notices) {
    expect(notice.left).toBeCloseTo(measurement.brand.left, 0);
    expect(notice.right).toBeCloseTo(measurement.menu.right, 0);
  }
}

describe("page notices under the header", () => {
  test("match the header content edges at desktop widths (AC-1)", async () => {
    for (const width of [1100, 1270]) {
      expectNoticesOnHeaderEdges(await bounds(width));
    }
  });

  test("match the header content and do not widen a phone page (AC-2)", async () => {
    const measurement = await bounds(360);

    expectNoticesOnHeaderEdges(measurement);
    expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.viewportWidth);
  });

  test("give every header notice the same shared width (AC-3)", async () => {
    for (const width of [1100, 1270, 360]) {
      const measurement = await bounds(width);
      const [first, ...rest] = measurement.notices;

      expectNoticesOnHeaderEdges(measurement);
      for (const notice of rest) {
        expect(notice.left).toBeCloseTo(first!.left, 0);
        expect(notice.right).toBeCloseTo(first!.right, 0);
      }
    }
  });
});
