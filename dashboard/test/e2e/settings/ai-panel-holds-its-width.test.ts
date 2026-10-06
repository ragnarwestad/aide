// An AI's panel on Settings → AI holds one width whichever of its three
// tabs is open, and its tab row stays where it is. Installation's
// preflight output is the widest thing any tab holds; it must wrap or
// scroll inside the panel rather than widen it. Only a real browser lays
// the page out, so the widths are measured in Chromium.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { forgetChecks, recordCheck } from "../../../src/render/ui/tool-checks.ts";

browserDeadline();

const SENTENCE =
  "Claude Code is installed in the usual place and was found on the path, and every one of the settings files that Aide writes is where it should be";
const CHECKSUM = `sha256 ${"0123456789abcdef".repeat(4)}`;

const harness = queueHarness("aide-e2e-ai-panel-width-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start().base;
  recordCheck({
    tool: "claude",
    commands: ["aide-preflight claude"],
    at: new Date().toISOString(),
    found: true,
    lines: [SENTENCE, CHECKSUM],
    extra: [],
  });
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  forgetChecks();
});

interface Layout {
  panel: { left: number; right: number; width: number };
  tabLefts: number[];
  /** Per `pre.checkoutput`: fits its own box, or scrolls inside it. */
  outputsContained: boolean[];
  pageWidth: number;
  windowWidth: number;
}

function measure(p: Page): Promise<Layout> {
  return p.evaluate(() => {
    const r = document.querySelector("section.toolpanel[data-tool]")!.getBoundingClientRect();
    return {
      panel: { left: r.left, right: r.right, width: r.width },
      tabLefts: [...document.querySelectorAll("nav[data-aitabs] a")].map((a) => a.getBoundingClientRect().left),
      outputsContained: [...document.querySelectorAll<HTMLElement>("pre.checkoutput")].map(
        (el) => el.scrollWidth <= el.clientWidth || getComputedStyle(el).overflowX !== "visible",
      ),
      pageWidth: document.documentElement.scrollWidth,
      windowWidth: window.innerWidth,
    };
  });
}

async function open(part: string): Promise<Layout> {
  const address = `/settings?tab=claude&aitab=${part}`;
  await withBrowser(page.goto(`${base}${address}`), `page.goto(${address})`);
  return measure(page);
}

async function clickTab(name: string, part: string): Promise<Layout> {
  const tabs = page.locator("nav[data-aitabs]");
  await Promise.all([
    page.waitForURL(`**/settings?tab=claude&aitab=${part}`),
    tabs.getByRole("link", { name, exact: true }).click(),
  ]);
  return measure(page);
}

test("the panel and its tabs hold still across the three tabs (AC-1, AC-2, AC-4)", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const models = await open("models");
  const usage = await clickTab("Usage", "subscription");
  const installation = await clickTab("Installation", "installation");
  expect(await page.getByText(SENTENCE).count()).toBeGreaterThan(0);
  for (const other of [usage, installation]) {
    expect(Math.abs(other.panel.left - models.panel.left)).toBeLessThan(0.5);
    expect(Math.abs(other.panel.width - models.panel.width)).toBeLessThan(0.5);
    other.tabLefts.forEach((left, i) => expect(Math.abs(left - models.tabLefts[i]!)).toBeLessThan(3));
  }
});

test("Installation's output fits its box or scrolls, and the page stays inside the window (AC-3)", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const models = await open("models");
  const installation = await open("installation");
  expect(Math.abs(installation.panel.width - models.panel.width)).toBeLessThan(0.5);
  expect(installation.outputsContained.length).toBeGreaterThan(0);
  expect(installation.outputsContained.every(Boolean)).toBe(true);
  expect(installation.pageWidth).toBeLessThanOrEqual(installation.windowWidth);
});

test("on a phone the panel stays inside the window on Installation (AC-3)", async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  const installation = await open("installation");
  expect(installation.panel.right).toBeLessThanOrEqual(installation.windowWidth);
  expect(installation.pageWidth).toBeLessThanOrEqual(installation.windowWidth);
  expect(installation.outputsContained.every(Boolean)).toBe(true);
});
