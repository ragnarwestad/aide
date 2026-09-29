// The New spec page's project select is `required`, so an empty project
// is stopped by the browser at the field, before anything is sent. Only a
// real browser runs that check.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-new-spec-layout-");
let browser: Browser;
let page: Page;
let base: string;

/** Two animation frames: one full task-plus-render cycle, so a focus the
 *  browser moves after the press has landed before it is read. */
function settle(p: Page): Promise<void> {
  return p.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start().base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

async function pressCreate(fill: { title: boolean }): Promise<{ requests: number; focused: string | null }> {
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  let requests = 0;
  const count = (r: { url(): string }) => {
    if (r.url().includes("/api/queue/create")) requests++;
  };
  page.on("request", count);
  try {
    if (fill.title) {
      await page.locator('#new-spec-form input[name="title"]').fill("A title");
      await page.locator('#new-spec-form textarea[name="description"]').fill("A description");
    }
    await page.locator("#new-spec-form").getByRole("button", { name: "Create" }).click();
    await settle(page);
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("name") ?? null);
    return { requests, focused };
  } finally {
    page.off("request", count);
  }
}

test("Create with no project chosen focuses the project field and sends nothing (AC-1)", async () => {
  const { requests, focused } = await pressCreate({ title: true });
  expect(focused).toBe("project");
  expect(requests).toBe(0);
  const message = await page.locator('#new-spec-form select[name="project"]').evaluate((el) => (el as HTMLSelectElement).validationMessage);
  expect(message).not.toBe("");
});

test("with everything empty Create focuses the project field first (AC-2)", async () => {
  const { focused } = await pressCreate({ title: false });
  expect(focused).toBe("project");
});

// Create shares the Project label's line, so a click on the word must
// reach the picker, never the button — which, with the form filled in,
// would send it.
test("a click on the word Project focuses the picker and sends nothing (spec 553, AC-1)", async () => {
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  let requests = 0;
  const count = (r: { url(): string }) => {
    if (r.url().includes("/api/queue/create")) requests++;
  };
  page.on("request", count);
  try {
    const form = page.locator("#new-spec-form");
    await form.locator('select[name="project"]').selectOption({ index: 1 });
    await form.locator('input[name="title"]').fill("A title");
    await form.locator('textarea[name="description"]').fill("A description");
    await form.getByText("Project", { exact: true }).click();
    await settle(page);
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("name") ?? null);
    expect(focused).toBe("project");
    expect(requests).toBe(0);
  } finally {
    page.off("request", count);
  }
});
