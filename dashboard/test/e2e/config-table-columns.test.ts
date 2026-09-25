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
async function share(width: number, edit = false): Promise<{ value: number; comment: number }> {
  await page.setViewportSize({ width, height: 900 });
  await withBrowser(page.goto(`${base}/projects/paceup${edit ? "?edit=1" : ""}`), `page.goto at ${width}px`);
  return page.evaluate((path) => {
    const cell = [...document.querySelectorAll('td[data-col="setting-value"]')]
      .find((td) => td.textContent?.includes(path) || (td.querySelector("textarea") as HTMLTextAreaElement | null)?.value.includes(path))!;
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
  test(`at ${width}px a long path wraps, so Value and Comment share the table evenly (AC-5)`, async () => {
    const { value, comment } = await share(width);
    expect([comment > 0.35, Math.abs(value - comment) < 0.05]).toEqual([true, true]);
  });
}

// --- edit mode: the fields fit what they hold ---------------------------

const LONG_VALUE = `${LONG_PATH}${LONG_PATH}`;

async function openEdit(width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await withBrowser(page.goto(`${base}/projects/paceup?edit=1`), `edit page.goto at ${width}px`);
}

const specsField = () => page.locator('textarea[name="specsPath"]');

for (const width of [1280, 820, 390]) {
  test(`at ${width}px every settings field is as wide as its cell (AC-1)`, async () => {
    await openEdit(width);
    const gaps = await page.evaluate(() =>
      [...document.querySelectorAll('td[data-col="setting-value"] :is(textarea, select)')].map((el) => {
        const cell = el.closest("td")!;
        const cs = getComputedStyle(cell);
        const inner = cell.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return Math.abs(el.getBoundingClientRect().width - inner);
      }),
    );
    expect(gaps.length).toBe(6);
    expect(gaps.every((g) => g <= 1)).toBe(true);
    if (width > 390) {
      const { value, comment } = await share(width, true);
      expect([comment > 0.35, Math.abs(value - comment) < 0.05]).toEqual([true, true]);
    }
  });

  test(`at ${width}px a long specs path is shown whole, wrapped (AC-2)`, async () => {
    await openEdit(width);
    await specsField().fill(LONG_VALUE);
    const m = await specsField().evaluate((el) => {
      const f = el as HTMLTextAreaElement;
      return { rows: f.clientHeight > 2 * parseFloat(getComputedStyle(f).lineHeight || "16"), clipped: f.scrollHeight > f.clientHeight };
    });
    expect(m).toEqual({ rows: true, clipped: false });
  });
}

test("a field follows a resize, more typing and a cut back (AC-2)", async () => {
  await openEdit(1280);
  await specsField().fill(LONG_VALUE);
  const clipped = () => specsField().evaluate((el) => el.scrollHeight > el.clientHeight);
  await page.setViewportSize({ width: 820, height: 900 });
  // The window's resize event reaches the page a moment after the size.
  await page.waitForFunction(() => {
    const f = document.querySelector('textarea[name="specsPath"]') as HTMLTextAreaElement;
    return f.scrollHeight <= f.clientHeight;
  });
  expect(await clipped()).toBe(false);
  await specsField().press("End");
  await specsField().pressSequentially("x".repeat(30));
  expect(await clipped()).toBe(false);
  await specsField().fill("/short");
  const rows = await specsField().evaluate((el) => el.clientHeight < 2 * parseFloat(getComputedStyle(el).lineHeight || "16"));
  expect(rows).toBe(true);
});

test("Enter raises one submit and leaves no line break; a filled break is folded (AC-3)", async () => {
  await openEdit(1280);
  await page.evaluate(() => {
    (window as unknown as { __submits: number }).__submits = 0;
    document.querySelector("form.projectsettingsform")!.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      (window as unknown as { __submits: number }).__submits++;
    }, true);
  });
  await specsField().fill("/a");
  await specsField().press("Enter");
  expect(await page.evaluate(() => (window as unknown as { __submits: number }).__submits)).toBe(1);
  expect(await specsField().inputValue()).toBe("/a");
  await specsField().fill("a\nb");
  expect(await specsField().inputValue()).toBe("a b");
});
