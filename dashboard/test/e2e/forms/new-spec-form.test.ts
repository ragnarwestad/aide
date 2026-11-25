import { expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-new-spec-form-");
let browser: Browser;
let base: string;

e2eBrowser(harness, (launched) => {
  browser = launched;
  base = harness.start().base;
});

interface Opened {
  page: Page;
  /** The body of every create post, in order. */
  posts: URLSearchParams[];
  /** Lets the create post that is being held answer. */
  release: () => void;
}

/** `/new` with every create post recorded and answered as accepted —
 *  once `release()` is called when `hold` is set. */
async function open(o: { hold?: boolean } = {}): Promise<Opened> {
  const page = await (await browser.newContext()).newPage();
  const posts: URLSearchParams[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/queue/create", async (route) => {
    posts.push(new URLSearchParams(route.request().postData() ?? ""));
    if (o.hold) await held;
    await route.fulfill({ status: 200, json: { ok: true, specFolder: "999-a-title" } });
  });
  await withBrowser(page.goto(`${base}/new?live=0`), "page.goto(/new)");
  return { page, posts, release };
}

const create = (page: Page) => page.getByRole("button", { name: "Create", exact: true });
const title = (page: Page) => page.locator('#new-spec-form input[name="title"]');
const focusedName = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("name") ?? null);

/** Two animation frames, so a focus the browser moves after a press has landed. */
function settle(p: Page): Promise<void> {
  return p.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** Project, title and description filled in. */
async function fillSpec(page: Page): Promise<void> {
  await page.locator('#new-spec-form select[name="project"]').selectOption("aide");
  await title(page).fill("A title");
  await page.locator('#new-spec-form textarea[name="description"]').fill("A description");
}

test("Create reads Creating… and is locked while its request is out, and Enter in Title presses it", async () => {
  const held = await open({ hold: true });
  await fillSpec(held.page);
  await create(held.page).click();
  await held.page.waitForFunction(() => document.querySelector('button[form="new-spec-form"]')?.textContent === "Creating…");
  expect(await create(held.page).count()).toBe(0);
  const busy = held.page.getByRole("button", { name: "Creating…" });
  expect(await busy.isDisabled()).toBe(true);
  held.release();

  const entered = await open();
  await fillSpec(entered.page);
  await Promise.all([
    entered.page.waitForRequest("**/api/queue/create"),
    title(entered.page).press("Enter"),
  ]);
  expect(entered.posts.length).toBe(1);
});

test("Create validates the required title without submitting", async () => {
const { page, posts } = await open();
await fillSpec(page);
await title(page).fill("");
await create(page).click();
await settle(page);
expect(await focusedName(page)).toBe("title");
expect(posts).toHaveLength(0);
});

test("Create submits the spec details and settings together", async () => {
  const { page, posts, release } = await open({ hold: true });
  try {
    await fillSpec(page);
    await page.getByRole("checkbox", { name: "Acceptance ticking required", exact: true }).uncheck({ timeout: 2000 });
    await page.getByLabel("Acceptance criteria checks", { exact: true }).selectOption("stop", { timeout: 2000 });
    await page.getByRole("checkbox", { name: "Let me choose the approach", exact: true }).check();
    await Promise.all([page.waitForRequest("**/api/queue/create"), create(page).click()]);
    const body = posts[0]!;
    expect(body.get("project")).toBe("aide");
    expect(body.get("title")).toBe("A title");
    expect(body.get("description")).toBe("A description");
    expect(body.has("acceptanceRequired")).toBe(false);
    expect(body.get("criteriaChecks")).toBe("stop");
    expect(body.get("chooseApproach")).toBe("1");
    expect(body.getAll("steps")).toEqual([]);
  } finally {
    release();
    await page.close();
  }
});
