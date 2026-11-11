import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-spec-groups-");
let browser: Browser;
let page: Page;
let base: string;

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
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("a group can be unfolded and its specs opened in place", async () => {
  await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(/specs)");
  const group = page.getByRole("button", { name: "Release", exact: true });
  const spec = page.locator('tr.spechead[data-folder="82-first"]');
  await group.waitFor();
  await spec.waitFor({ state: "hidden" });
  await group.click();
  await spec.waitFor({ state: "visible" });
  await spec.locator("a.fold").click();
  await page.locator('[data-spec-detail="aide/82-first"] .spec-editor-mount[data-mounted]').waitFor();
  expect(await group.count()).toBe(1);
  await group.click();
  await spec.waitFor({ state: "hidden" });
  await group.click();
  await spec.waitFor({ state: "visible" });
});

test("group Start queues only the first member (A757 AC-7, A757 AC-9)", async () => {
  const response = await fetch(`${base}/api/queue/groups/aide/Release`, { method: "POST" });
  expect(response.status).toBe(200);
  const body = await response.json() as { job: { specFolder: string } };
  expect(body.job.specFolder).toBe("82-first");
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
  await page.goto(`${base}/specs?live=0`);
  expect(await page.getByRole("button", { name: "Start", exact: true }).isDisabled()).toBe(true);
});
