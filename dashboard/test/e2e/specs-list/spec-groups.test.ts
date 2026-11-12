import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-spec-groups-");
let browser: Browser;
let page: Page;
let base: string;
let startedMember: string;

const description = (folder: string, position: number) =>
  `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({
    description: description("81-queue-and-runner", 2),
    alsoSpecs: ["82-first", "83-third"],
    alsoDescriptions: {
      "82-first": description("82-first", 1),
      "83-third": description("83-third", 3),
    },
  });
  base = started.base;
  await page.goto(`${base}/?live=0`);
  await page.getByRole("button", { name: "Release", exact: true }).click();
  const answered = page.waitForResponse((response) =>
    response.request().method() === "POST");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  const body = await response.json() as { job: { specFolder: string } };
  startedMember = body.job.specFolder;
  await page.getByRole("button", { name: "Release", exact: true }).click();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("Running keeps one group card and its member detail open in place (AC-1, AC-2, AC-5)", async () => {
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  const group = page.getByRole("button", { name: "Release", exact: true });
  const spec = page.locator('tr.spechead[data-folder="82-first"]');
  await group.waitFor();
  await spec.waitFor({ state: "hidden" });
  await group.click();
  await spec.waitFor({ state: "visible" });
  expect(await group.count()).toBe(1);
  await group.click();
  await spec.waitFor({ state: "hidden" });
  await group.click();
  await spec.waitFor({ state: "visible" });
});

test("Running hides the execution-group action line while its group is collapsed (AC-7)", async () => {
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  const group = page.getByRole("button", { name: "Release", exact: true });
  const actions = page.locator("tr[data-execution-group-actions]");
  await group.waitFor();
  await actions.waitFor({ state: "hidden" });
  await group.click();
  await actions.waitFor({ state: "visible" });
  await group.click();
  await actions.waitFor({ state: "hidden" });
});

test("group Start queues only the first member (AC-6, AC-9, AC-15)", async () => {
  expect(startedMember).toBe("82-first");
  const queue = await (await fetch(`${base}/api/queue`)).json() as { jobs: Array<{ specFolder: string }> };
  expect(queue.jobs.filter((job) => job.specFolder === "81-queue-and-runner")).toHaveLength(0);

  const thirdBeforeSecond = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: "83-third", steps: ["analyze"] }),
  });
  expect(thirdBeforeSecond.status).toBe(409);

  const ordinaryLater = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }),
  });
  expect(ordinaryLater.status).toBe(409);
  await page.goto(`${base}/?live=0`);
  await page.getByRole("button", { name: "Release", exact: true }).click();
  expect(await page.getByRole("button", { name: "Stop", exact: true }).count()).toBe(1);
});
