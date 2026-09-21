// The Test servers page at every width: the table fills the page's frame,
// looks like the specs list's table, and drops Branch, then Project, then
// Status as the window narrows, without ever scrolling sideways or
// cutting a cell's content.
//
// Nothing here is reachable from a string: widths, wrapping and which
// columns a window shows are layout's and a media query's answer.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { MAIN_TEST_SERVER_KEY } from "../../../src/serve/test-servers/lifecycle.ts";
import type { TestServer } from "../../../src/serve/test-servers/store.ts";
import { queueHarness, ran } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-test-servers-");
let browser: Browser;
let page: Page;
let base: string;

const board = (overrides: Partial<TestServer> = {}): TestServer => ({
  branch: "aide/81-queue-and-runner",
  commit: "abc1234deadbeef",
  port: 8801,
  wrapperPid: 1,
  pid: 4242,
  url: "http://127.0.0.1:8801/?token=t0ken",
  workDir: "/tmp/aide-e2e-test-servers",
  logPath: "/tmp/aide-e2e-test-servers/board.log",
  status: "running",
  startedAt: "2026-09-20T00:00:00.000Z",
  ...overrides,
});

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({ extra: { testServersIsAlive: () => true }, alsoSpecs: ["82-second"] });
  base = started.base;
  ran(started.dir, []);
  const store = started.server.testServersStore();
  store.set("aide", "81-queue-and-runner", board());
  store.set("aide", MAIN_TEST_SERVER_KEY, board({ branch: "main", port: 8802, url: "http://127.0.0.1:8802/?token=m4in" }));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const LONG_FOLDER = "519-" + "a-very-long-folder-name-".repeat(4) + "end"; // 120 characters
const LONG_ADDRESS = "a-tailnet-host.tail1234abcd.ts.net:8801"; // ~40 characters

async function open(width: number, longNames = false): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await withBrowser(page.goto(`${base}/test-servers?live=0`), `page.goto at ${width}px`);
  if (!longNames) return;
  await page.evaluate(([folder, address]) => {
    const spec = document.querySelector('table.testservers tbody td[data-col="ts-spec"] a');
    if (spec) spec.textContent = folder!;
    const link = document.querySelector('table.testservers tbody td[data-col="ts-address"] a');
    if (link) link.textContent = address!;
  }, [LONG_FOLDER, LONG_ADDRESS]);
}

/** The columns the window shows, read off the FIRST body row: at 640px
 *  and below the head row is gone, so headings cannot be asked. A column
 *  that has left is collapsed, so its cells have no width. */
const shownColumns = (): Promise<string[]> =>
  page.locator("table.testservers tbody tr").first().locator("td[data-col]").evaluateAll((cells) =>
    cells.filter((c) => c.getBoundingClientRect().width > 0).map((c) => c.getAttribute("data-col") ?? ""),
  );

const ALL = ["ts-project", "ts-spec", "ts-branch", "ts-status", "ts-address", "ts-stop"];
// One width either side of each breakpoint — 58rem (928px), 46.5rem (744)
// and 42rem (672) — measured in Chromium against list.css (see the
// comments above the `testservers` rules there).
const NO_BRANCH = ALL.filter((c) => c !== "ts-branch");
const NO_PROJECT = NO_BRANCH.filter((c) => c !== "ts-project");
const LAST_THREE = NO_PROJECT.filter((c) => c !== "ts-status");
const STEPS: { width: number; shown: string[] }[] = [
  { width: 1280, shown: ALL },
  { width: 1000, shown: ALL },
  { width: 929, shown: ALL },
  { width: 928, shown: NO_BRANCH },
  { width: 850, shown: NO_BRANCH },
  { width: 745, shown: NO_BRANCH },
  { width: 744, shown: NO_PROJECT },
  { width: 700, shown: NO_PROJECT },
  { width: 673, shown: NO_PROJECT },
  { width: 672, shown: LAST_THREE },
  { width: 600, shown: LAST_THREE },
  { width: 500, shown: LAST_THREE },
  { width: 390, shown: LAST_THREE },
  { width: 360, shown: LAST_THREE },
];

test("the table is as wide as the page's frame, and no heading moves for a long name (AC-1)", async () => {
  await open(1280);
  const measure = () =>
    page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect();
      const main = document.querySelector("main")!;
      const cs = getComputedStyle(main);
      const table = box(document.querySelector("table.testservers")!);
      return {
        frameLeft: box(main).left + parseFloat(cs.paddingLeft),
        frameWidth: box(main).width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        table: { left: table.left, width: table.width },
        heads: [...document.querySelectorAll("table.testservers thead th")].map((th) => [box(th).left, box(th).width]),
      };
    });
  const before = await measure();
  expect(Math.abs(before.table.left - before.frameLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.table.width - before.frameWidth)).toBeLessThanOrEqual(1);
  await open(1280, true);
  expect((await measure()).heads).toEqual(before.heads);
});

test("a heading and a body cell look like the specs list's (AC-2)", async () => {
  const look = (selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel)!;
      const cs = getComputedStyle(el);
      return [
        cs.backgroundColor, cs.color, cs.fontSize, cs.fontWeight,
        cs.borderTopWidth, cs.borderBottomWidth, cs.paddingTop, cs.paddingBottom,
      ];
    }, selector);
  const tableLook = (selector: string) =>
    page.evaluate((sel) => {
      const cs = getComputedStyle(document.querySelector(sel)!);
      return [cs.backgroundColor, cs.borderTopWidth, cs.borderTopColor, cs.borderTopLeftRadius];
    }, selector);

  await open(1280);
  const ours = {
    head: await look("table.testservers thead th:nth-child(2)"),
    body: await look("table.testservers tbody tr:nth-child(2) td:nth-child(2)"),
    table: await tableLook("table.testservers"),
  };
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  const theirs = {
    head: await look("table.speclist thead th:nth-child(2)"),
    body: await look("table.speclist tbody tr.spechead:nth-child(n+2) td:nth-child(2)"),
    table: await tableLook("table.speclist"),
  };
  expect(ours).toEqual(theirs);
});

test("each step down drops one more column, in the order Branch, Project, Status (AC-3)", async () => {
  let previous: string[] | undefined;
  for (const { width, shown: expected } of STEPS) {
    await open(width, true);
    const shown = await shownColumns();
    expect(shown).toEqual(expected);
    if (previous) {
      expect(shown.length).toBeLessThanOrEqual(previous.length);
      expect(previous).toEqual(expect.arrayContaining(shown));
    }
    previous = shown;
  }
});

test("at every width nothing scrolls sideways, no cell's content is wider than the cell, and Stop stays on one line (AC-3)", async () => {
  for (const width of [1280, 1000, 850, 700, 600, 500, 390, 360]) {
    await open(width, true);
    const result = await page.evaluate(() => {
      const visible = (el: Element) => el.getBoundingClientRect().width > 0;
      const cells = [...document.querySelectorAll("table.testservers tbody td")].filter(visible);
      const heads = [...document.querySelectorAll("table.testservers thead th")];
      const wrap = document.querySelector(".tablewrap")!;
      return {
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
        box: wrap.scrollWidth - wrap.clientWidth,
        clipped: cells.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.getAttribute("data-col")),
        // Above 640px a hidden column's heading is hidden with its cells.
        headsAgree: window.innerWidth <= 640 || heads.every((h, i) => {
          const cell = document.querySelector(`table.testservers tbody tr:first-child td:nth-child(${i + 1})`)!;
          return visible(h) === visible(cell);
        }),
        stopHeight: (document.querySelector("table.testservers .btn") as HTMLElement).getBoundingClientRect().height,
        stopLine: parseFloat(getComputedStyle(document.querySelector("table.testservers .btn")!).lineHeight) || 0,
      };
    });
    expect(result.doc).toBeLessThanOrEqual(result.win);
    expect(result.box).toBeLessThanOrEqual(0);
    expect(result.clipped).toEqual([]);
    expect(result.headsAgree).toBe(true);
    expect(result.stopHeight).toBeLessThan(result.stopLine * 2 + 16);
  }
});
