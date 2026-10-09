// The Jobs tab in a browser: a job queued while the page is open gets its row
// without loading the page again, a row folds open in place, and Cancel and
// Stop end their job in place, as they do on the Specs list.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-jobs-tab-");
let browser: Browser;

const SPEC = "81-queue-and-runner";
const SPEC_ROW = `tr.spechead[data-folder="${SPEC}"]`;

const wiki = {
  id: "wiki1", project: "aide", specFolder: "wiki-aide", steps: ["wiki"], stepIndex: 0, state: "running",
  timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-10-08T03:00:00Z", startedAt: "2026-10-08T03:00:00Z",
};

const queueAnalyze = async (base: string): Promise<string> => {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze"] }),
  });
  expect(res.ok).toBe(true);
  return ((await res.json()) as { job: { id: string } }).job.id;
};

const stateOf = async (base: string, id: string): Promise<string> =>
  ((await (await fetch(`${base}/api/queue/${id}`)).json()) as { job: { state: string } }).job.state;

/** Counts the page loads after this call: a press that acts in place adds none. */
const countLoads = (page: Page): { n: number } => {
  const loads = { n: 0 };
  page.on("load", () => loads.n++);
  return loads;
};

const pathOf = (page: Page): string => new URL(page.url()).pathname;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

describe("a spec's row on the Jobs tab acts in place", () => {
  test("a spec's row is on the tab before any job, a job queued on it redraws it in place and Cancel ends the job, the row staying, with no page load (AC-1, AC-3)", async () => {
    const { base } = harness.start({});
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    await page.locator(SPEC_ROW).waitFor({ timeout: 10_000 });
    const loads = countLoads(page);

    const id = await queueAnalyze(base);
    await page.locator(`${SPEC_ROW} a[data-fold="open"]`).waitFor();
    expect(loads.n).toBe(0);

    // The fold opens the row's phase lines; the address names the spec and stays on the Jobs tab.
    await page.locator(`${SPEC_ROW} a[data-fold="open"]`).click();
    await page.locator("tr.subrow").first().waitFor();
    expect(pathOf(page)).toBe("/");
    expect(new URL(page.url()).searchParams.get("open")).toBe(`aide/${SPEC}`);
    expect(loads.n).toBe(0);

    // Cancel asks first; its OK posts and redraws the rows.
    await page.locator("button[data-ask]").first().click();
    await page.locator("dialog[open]").getByRole("button", { name: "OK" }).click();
    await page.waitForFunction(async (jobId) => {
      const r = await fetch(`/api/queue/${jobId}`);
      return ((await r.json()) as { job: { state: string } }).job.state === "cancelled";
    }, id);
    expect(await stateOf(base, id)).toBe("cancelled");
    // The spec is still Active: its row stays, with nothing left to cancel.
    await page.locator(SPEC_ROW).waitFor({ timeout: 10_000 });
    await page.locator(`form[action="/api/queue/${id}/cancel"]`).waitFor({ state: "detached", timeout: 10_000 });
    expect(pathOf(page)).toBe("/");
    expect(loads.n).toBe(0);
    await page.close();
  });
});

describe("a wiki job's row folds and stops in place", () => {
  const WIKI_ROW = 'tr.spechead[id="spec-aide/wiki-aide"]';
  const FOLD = `${WIKI_ROW} a[data-fold="open"]`;
  const STOP = `${WIKI_ROW} + tr.specstate button[data-ask]`;
  const CHIP = `${WIKI_ROW} + tr.specstate .badgeslot .badge`;

  test("the row is shut, its › opens it with no page load and shuts it again, and Stop and its OK end the job cancelled (AC-5)", async () => {
    const { base } = harness.start({ queueMirror: JSON.stringify([wiki]) });
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    await page.locator(WIKI_ROW).waitFor();
    const loads = countLoads(page);

    expect(await page.locator(STOP).count()).toBe(0);

    await page.locator(FOLD).click();
    await page.locator(STOP).waitFor({ state: "visible" });
    expect(await page.locator(CHIP).isVisible()).toBe(true);
    expect(pathOf(page)).toBe("/");
    expect(new URL(page.url()).searchParams.get("open")).toBe("aide/wiki-aide");
    expect(loads.n).toBe(0);

    await page.locator(FOLD).click();
    await page.locator(STOP).waitFor({ state: "detached" });
    expect(new URL(page.url()).searchParams.get("open")).toBeNull();

    await page.locator(FOLD).click();
    await page.locator(STOP).click();
    await page.locator("dialog[open]").getByRole("button", { name: "OK" }).click();
    await page.waitForFunction(async () => {
      const r = await fetch("/api/queue/wiki1");
      return ((await r.json()) as { job: { state: string } }).job.state === "cancelled";
    });
    expect(await stateOf(base, "wiki1")).toBe("cancelled");
    expect(pathOf(page)).toBe("/");
    expect(loads.n).toBe(0);
    await page.close();
  });

  test("opened, the row shows its Stop and its state chip at desktop width and at a phone's (AC-5)", async () => {
    const { base } = harness.start({ queueMirror: JSON.stringify([wiki]) });
    for (const width of [1280, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(`${base}/?open=aide/wiki-aide`);
      await page.locator(STOP).waitFor({ state: "visible" });
      expect(await page.locator(CHIP).isVisible()).toBe(true);
      await page.close();
    }
  });
});
