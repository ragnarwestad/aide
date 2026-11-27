import { fakeGit } from "../../helpers/fake-git.ts";
// The search box above the rows asks in place, as the filter links do: a
// search draws the rows again without loading the page, and a search for
// the term already shown, an empty one included, asks nothing at all.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { createdJob, queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-search-in-place-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  base = harness.start({ queueMirror: JSON.stringify([createdJob()]) }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** Counts the page loads and the rows' redraws after this call. */
const watch = (page: Page): { loads: number; redraws: number } => {
  const seen = { loads: 0, redraws: 0 };
  page.on("load", () => seen.loads++);
  page.on("request", (req) => {
    if (new URL(req.url()).searchParams.get("rows") === "1") seen.redraws++;
  });
  return seen;
};

const search = (page: Page) => page.getByRole("button", { name: "Search", exact: true }).click();

test("a search on / draws the rows in place, and one for the term already shown asks nothing", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?live=0`);
    await page.getByRole("searchbox").waitFor();
    const seen = watch(page);

    await search(page);
    await page.waitForTimeout(300);
    expect(seen).toEqual({ loads: 0, redraws: 0 });

    await page.getByRole("searchbox").fill("queue");
    await Promise.all([page.waitForResponse((res) => new URL(res.url()).searchParams.get("rows") === "1"), search(page)]);
    expect(new URL(page.url()).searchParams.get("q")).toBe("queue");
    expect(new URL(page.url()).pathname).toBe("/");

    await search(page);
    await page.waitForTimeout(300);
    expect(seen).toEqual({ loads: 0, redraws: 1 });
  } finally {
    await page.close();
  }
});


test("Jobs loads further history with the keyboard and searches outside the loaded window (AC-3, AC-4, AC-6, AC-9)", async () => {
  const history = queueHarness("aide-e2e-job-window-");
  const folders = Array.from({ length: 165 }, (_, i) => `schedule-window-history-${i}`);
  const jobs = folders.map((folder, i) => ({ ...createdJob(folder), steps: ["schedule"], createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const { base } = history.start({ queueMirror: JSON.stringify(jobs) });
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => { Object.defineProperty(window, "IntersectionObserver", { value: undefined }); });
    await page.goto(`${base}/?live=0`);
    const older = page.locator('[id="spec-aide/schedule-window-history-0@created-schedule-window-history-0"]');
    expect(await older.count()).toBe(0);
    const loaded = page.waitForResponse((res) => new URL(res.url()).searchParams.get("rows") === "1");
    await page.getByRole("link", { name: "Show more", exact: true }).focus();
    await page.keyboard.press("Enter");
    await loaded;
    await older.waitFor();
    expect(new URL(page.url()).searchParams.get("limit")).toBe("200");

    await page.goto(`${base}/?live=0`);
    await page.getByRole("searchbox").fill("window-history-0");
    await search(page);
    await older.waitFor();
    expect(new URL(page.url()).searchParams.get("q")).toBe("window-history-0");

    await page.goto(`${base}/?live=0&open=aide%2Fschedule-window-history-0%40created-schedule-window-history-0`);
    await older.waitFor();
  } finally {
    await page.close();
    history.cleanup();
  }
});

test("Jobs keeps an expanded group and member while loading and receiving new work (AC-7, AC-8)", async () => {
  const history = queueHarness("aide-e2e-group-batch-live-");
  const jobs = Array.from({ length: 165 }, (_, i) => ({ ...createdJob(`schedule-live-${i}`), steps: ["schedule"], createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const { base } = history.start({
    queueMirror: JSON.stringify(jobs), alsoSpecs: ["82-member", "83-new"],
    extra: { specCachePollMs: 0, gitRun: fakeGit({}).run },
    executionGroups: [{ id: "batch-group", project: "aide", name: "Release", members: ["81-queue-and-runner", "82-member"], branch: "group/release", state: "prepared", completedMembers: [], jobs: [] }],
  });
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => { Object.defineProperty(window, "IntersectionObserver", { value: undefined }); });
    await page.goto(base);
    const group = page.getByRole("button", { name: "Release", exact: true });
    await group.click();
    const member = page.locator('tr.spechead[data-folder="81-queue-and-runner"] a.fold');
    await member.click();
    await page.waitForFunction(() => document.querySelector('tr.spechead[data-folder="81-queue-and-runner"] a.fold')?.getAttribute("aria-expanded") === "true");
    await page.getByRole("link", { name: "Show more", exact: true }).click();
    await page.locator('[id="spec-aide/schedule-live-0@created-schedule-live-0"]').waitFor();
    expect(await group.getAttribute("aria-expanded")).toBe("true");
    expect(await member.getAttribute("aria-expanded")).toBe("true");
    const queued = await page.request.post(`${base}/api/queue`, { data: { project: "aide", specFolder: "83-new", steps: ["analyze"] } });
    expect(queued.ok()).toBe(true);
    await page.locator('tr.spechead[data-folder="83-new"]').waitFor();
    expect(await group.getAttribute("aria-expanded")).toBe("true");
    expect(await member.getAttribute("aria-expanded")).toBe("true");
    expect(await page.locator('[id="spec-aide/schedule-live-0@created-schedule-live-0"]').count()).toBe(1);
  } finally { await page.close(); history.cleanup(); }
});
