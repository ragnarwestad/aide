// A project's Config tab on a wide screen: a long value does not starve
// the Comment column. A configured specs path — `/var/folders/…/T/tmp.
// AYE5D1XGWT/specs` on a test board — has no break a browser takes on
// its own, so auto layout sized Value to the whole path and left Comment
// a ribbon six words tall, with the `<colgroup>`'s 42% dropped.
//
// Only a browser answers this: the numbers are the layout's own.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { harness, ownDirs, projectsRoot, settled, serve } from "../project/detail/project-detail-route-fixtures.ts";
import { rmSync } from "node:fs";

browserDeadline();

let browser: Browser;
let page: Page;
let base: string;

const LONG_PATH = "/var/folders/44/7wtwdqq94j3gnkjtnyfjp71w0000gn/T/tmp.AYE5D1XGWT/specs";

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage({ extraHTTPHeaders: {} });
  const root = projectsRoot({ paceup: `AIDE_SPECS_PATH=${LONG_PATH}\n` }, ["pnpm-lock.yaml"]);
  base = serve(root, settled(root, "paceup"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** The Value cell holding the long path, and its row's Comment, as a
 *  share of the table's own width. */
async function share(width: number): Promise<{ value: number; comment: number }> {
  await page.setViewportSize({ width, height: 900 });
  await withBrowser(page.goto(`${base}/projects/paceup`), `page.goto at ${width}px`);
  return page.evaluate((path) => {
    const cell = [...document.querySelectorAll('td[data-col="setting-value"]')]
      .find((td) => td.textContent?.includes(path))!;
    const row = cell.closest("tr")!;
    const table = cell.closest("table")!.getBoundingClientRect().width;
    const comment = row.lastElementChild!.getBoundingClientRect().width;
    return { value: cell.getBoundingClientRect().width / table, comment: comment / table };
  }, LONG_PATH);
}

// The `<colgroup>` asks for 42% each, and with the path wrapping both
// land within a thousandth of the other at every width. Unwrapped, Value
// takes 52% at 1280px and 66% at 820px, leaving the Comment 30% and 12%
// — the ribbon this is about. A five-point spread is far inside either.
for (const width of [1280, 820]) {
  test(`at ${width}px a long path wraps, so Value and Comment share the table evenly`, async () => {
    const { value, comment } = await share(width);
    expect([comment > 0.35, Math.abs(value - comment) < 0.05]).toEqual([true, true]);
  });
}
