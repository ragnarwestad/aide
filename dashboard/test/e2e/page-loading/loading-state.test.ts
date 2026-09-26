// Spec 515: what only a real browser can answer about the spec page's
// loading element. A small server sends the real head, waits on a gate,
// then sends a rest, so the moment between the two can be looked at.
// Run by hand, apart from `make test`:
//   bun test --timeout 30000 test/e2e/page-loading/loading-state.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { renderSpecPageHead, renderSpecPageRest } from "../../../src/render";
import { queueHarness } from "../../helpers/queue-server.ts";
import { GENERATED, NAV, view } from "../../render/pages/spec-page-fixtures.ts";

browserDeadline();

const FOLDER = "150-one-page-shows-the-whole-spec";
let browser: Browser;
let held: (() => void)[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  browser = await chromium.launch();
  server = Bun.serve({
    port: 0,
    fetch() {
      const enc = new TextEncoder();
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      held.push(release);
      const body = new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(enc.encode(renderSpecPageHead(FOLDER, "en"))); },
        async pull(c) {
          await gate;
          c.enqueue(enc.encode(renderSpecPageRest(view(), GENERATED, NAV, { lang: "en" })));
          c.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
});

afterAll(async () => {
  for (const r of held) r();
  await server.stop(true);
  await browser.close();
});

async function openWhileHeld(opts: { colorScheme?: "light" | "dark"; reducedMotion?: "reduce" | "no-preference"; theme?: string; js?: boolean }) {
  const context = await browser.newContext({
    colorScheme: opts.colorScheme ?? "light",
    reducedMotion: opts.reducedMotion ?? "no-preference",
    javaScriptEnabled: opts.js ?? true,
    viewport: { width: 800, height: 600 },
  });
  const page = await context.newPage();
  const navigation = page.goto(`http://localhost:${server.port}/`, { waitUntil: "commit" });
  await navigation;
  await page.waitForSelector(".pageloading", { state: "attached" });
  return { page, context, release: () => held[held.length - 1]!() };
}

describe("the loading element while the second half is held back", () => {
  for (const [name, scheme] of [["light", "light"], ["dark", "dark"]] as const) {
    test(`covers the viewport in the ${name} theme, centred, one mark, bars animating (AC-2)`, async () => {
      const { page, context, release } = await openWhileHeld({ colorScheme: scheme });
      try {
        const box = await page.locator(".pageloading").boundingBox();
        expect(box).toEqual({ x: 0, y: 0, width: 800, height: 600 });
        const bg = await page.locator(".pageloading").evaluate((e) => getComputedStyle(e).backgroundColor);
        expect(bg).toBe(scheme === "light" ? "rgb(239, 236, 229)" : "rgb(22, 24, 28)");
        const visible = await page.locator(".pageloading .mark-l").isVisible();
        expect(visible).toBe(scheme === "light");
        expect(await page.locator(".pageloading .mark-d").isVisible()).toBe(scheme === "dark");
        const animated = await page.locator(".pageloading rect").first().evaluate((e) => getComputedStyle(e).animationName);
        expect(animated).not.toBe("none");
      } finally {
        release();
        await context.close();
      }
    });
  }

  test("an explicit dark choice wins over a light machine (AC-2)", async () => {
    const context = await browser.newContext({ colorScheme: "light", viewport: { width: 800, height: 600 } });
    // The reader's choice arrives the way the product reads it: the
    // `theme` key in localStorage, which the head script applies before
    // the page paints. Setting the attribute here instead put it on the
    // empty document the navigation then replaced.
    await context.addInitScript(() => localStorage.setItem("theme", "dark"));
    const page = await context.newPage();
    await page.goto(`http://localhost:${server.port}/`, { waitUntil: "commit" });
    await page.waitForSelector(".pageloading", { state: "attached" });
    try {
      expect(await page.locator(".pageloading .mark-d").isVisible()).toBe(true);
      expect(await page.locator(".pageloading .mark-l").isVisible()).toBe(false);
    } finally {
      held[held.length - 1]!();
      await context.close();
    }
  });

  test("with reduced motion asked for, the bars stand still (AC-2)", async () => {
    const { page, context, release } = await openWhileHeld({ reducedMotion: "reduce" });
    try {
      const animated = await page.locator(".pageloading rect").first().evaluate((e) => getComputedStyle(e).animationName);
      expect(animated).toBe("none");
    } finally {
      release();
      await context.close();
    }
  });
});

describe("the loading element once the second half has arrived", () => {
  test("it is not displayed, with JavaScript switched off (AC-3)", async () => {
    const { page, context, release } = await openWhileHeld({ js: false });
    try {
      release();
      await page.waitForSelector("main", { state: "attached" });
      await page.waitForLoadState("load");
      expect(await page.locator(".pageloading").evaluate((e) => getComputedStyle(e).display)).toBe("none");
    } finally {
      await context.close();
    }
  });
});

describe("the Steps tab reloads itself with the refresh in the body", () => {
  const harness = queueHarness("aide-e2e-page-loading-");
  afterAll(() => harness.cleanup());

  test("the browser reloads about 10 s after the second half (AC-1)", async () => {
    const { base } = harness.start();
    const context = await browser.newContext();
    const page = await context.newPage();
    let loads = 0;
    page.on("request", (r) => { if (r.isNavigationRequest() && r.url().includes("tab=steps")) loads++; });
    try {
      await page.goto(`${base}/specs/aide/81-queue-and-runner?tab=steps`);
      expect(loads).toBe(1);
      await page.waitForTimeout(12_000);
      expect(loads).toBeGreaterThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
});
