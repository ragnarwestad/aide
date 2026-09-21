// Spec 516: the waiting layer (`dialog.pageoverlay`) sits in the middle of the
// screen, in a real browser. Chromium centres a modal dialog by default, so
// the centring cases pass with or without the rule; the long-note case is the
// one that fails without it, and the stylesheet guard in
// `test/design/css-guard-layout.test.ts` is what pins the rule itself.
//
// Not run by the session: Aide is not a project where the session runs the
// e2e suite. CI runs it (`make test-e2e`), and by hand:
// `cd dashboard && bun test --timeout 20000 test/e2e/waiting-layer-is-centred.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();
const FOLDER = "81-queue-and-runner";
const GAP = 16;
const LONG_NOTE = Array.from({ length: 40 }, () => "Deploying, this takes a while.").join(" ");

const harness = queueHarness("aide-e2e-waiting-layer-");
let browser: Browser;
let base: string;
let context: BrowserContext | undefined;

beforeAll(async () => {
  browser = await chromium.launch();
  base = harness.start().base;
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

async function openLayer(path: string, width: number, height: number, note: string): Promise<Page> {
  await context?.close();
  context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  const page = await context.newPage();
  await page.goto(`${base}${path}?live=0`);
  await page.evaluate((detail) => {
    document.dispatchEvent(new CustomEvent("aide-overlay-open", { detail }));
  }, note);
  await page.locator("dialog.pageoverlay[open]").waitFor();
  return page;
}

async function box(page: Page) {
  return (await page.locator("dialog.pageoverlay").boundingBox())!;
}

function expectCentred(b: { x: number; y: number; width: number; height: number }, w: number, h: number) {
  expect(Math.abs(b.x + b.width / 2 - w / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.y + b.height / 2 - h / 2)).toBeLessThanOrEqual(1);
}

describe("the waiting layer is centred (AC-1, AC-2, AC-6)", () => {
  test("at a phone's width the layer's centre is the screen's centre (AC-1) (AC-6)", async () => {
    const page = await openLayer("/", 375, 800, "Deploying");
    expectCentred(await box(page), 375, 800);
  });

  const SIZES: [string, number, number][] = [
    ["a phone", 375, 800], ["a phone sideways", 800, 375], ["a desktop window", 1280, 900],
  ];
  for (const path of ["/", `/specs/aide/${FOLDER}`]) {
    for (const [name, w, h] of SIZES) {
      test(`${path} at ${name}: centred on both axes (AC-2)`, async () => {
        const page = await openLayer(path, w, h, "Deploying");
        expectCentred(await box(page), w, h);
      });
    }
  }

  test("it stays centred when the viewport shrinks, as a keyboard that resizes the page does (AC-3)", async () => {
    const page = await openLayer("/", 375, 800, "Deploying");
    await page.setViewportSize({ width: 375, height: 400 });
    const b = await box(page);
    expectCentred(b, 375, 400);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(400);
  });

  // 320 px WIDE is what makes this bite: the note's own max-width is
  // 22rem (352 px), so without the layer's `max-width` the box is wider
  // than the screen. 375 x 300 alone passed with the rule deleted. The
  // height pair that came with it, 320 x 140, is dropped: no window is
  // that short, and the layer looks right in one (asked 2026-09-21).
  for (const [w, h] of [[320, 640], [375, 300]] as const) {
    test(`a note taller than ${w} x ${h} stays ${GAP} px inside every edge and scrolls inside itself (AC-4)`, async () => {
      const page = await openLayer("/", w, h, LONG_NOTE);
      const b = await box(page);
      // Measured against the viewport the browser lays the box out in,
      // not the size asked for: at a short height Chromium's mobile
      // emulation adds a classic 16 px scrollbar OUTSIDE the viewport,
      // so the page is 391 px wide in a 375 px window and a box centred
      // with `margin: auto` puts its gap where the screen ends. A phone
      // has overlay scrollbars and no such gap between the two.
      const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      expect(b.x).toBeGreaterThanOrEqual(GAP - 0.5);
      expect(b.y).toBeGreaterThanOrEqual(GAP - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(view.w - GAP + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(view.h - GAP + 0.5);
      const scrolls = await page.locator("dialog.pageoverlay").evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(scrolls).toBe(true);
    });
  }

  test("the spinner keeps its size, the note sits below it and the backdrop covers the screen (AC-5)", async () => {
    const page = await openLayer("/", 375, 800, "Deploying");
    const spin = page.locator("dialog.pageoverlay .spin");
    const size = await spin.evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight]);
    expect(size).toEqual([16, 16]);
    const spinBox = (await spin.boundingBox())!;
    const note = (await page.locator("dialog.pageoverlay .overlaynote").boundingBox())!;
    expect(note.y).toBeGreaterThanOrEqual(spinBox.y + 8);
    const corners = await page.evaluate(() => [[0, 0], [innerWidth - 1, innerHeight - 1]]
      .map(([x, y]) => document.elementFromPoint(x!, y!)?.tagName));
    expect(corners).toEqual(["DIALOG", "DIALOG"]);
  });
});
