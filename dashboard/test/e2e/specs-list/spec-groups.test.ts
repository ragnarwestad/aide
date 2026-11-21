import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { makeSpecsRepo } from "../../helpers/specs-repo.ts";

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
  makeSpecsRepo(started.dir);
  await started.server.settle();
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

test("opening a group shows its action beside its state, without navigation", async () => {
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  const group = page.getByRole("button", { name: "Release", exact: true });
  const card = page.locator("tr[data-spec-group]");
  const state = card.locator("[data-group-state]");
  const action = card.locator("[data-group-action]");
  const url = page.url();
  await group.waitFor();
  await state.waitFor({ state: "visible" });
  await action.waitFor({ state: "hidden" });
  await group.click();
  await action.waitFor({ state: "visible" });
  await state.waitFor({ state: "visible" });
  await group.click();
  await action.waitFor({ state: "hidden" });
  await state.waitFor({ state: "visible" });
  expect(page.url()).toBe(url);
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
  expect(await page.getByRole("button", { name: "Cancel", exact: true }).count()).toBe(1);
});

test("Cancel opens an automatic group's phase choices and Start uses the new selection", async () => {
  const waitingHarness = queueHarness("aide-e2e-group-wait-");
  const folder = "81-queue-and-runner";
  const job = { id: "waiting", project: "aide", specFolder: folder, executionGroupId: "waiting-group",
    steps: ["analyze", "implement"], stepIndex: 0, state: "waiting", stopReason: "provider-limit",
    usageLimitWait: { until: "2099-01-01T12:00:00Z", resetKnown: true },
    model: {}, timeoutSec: {}, permissionMode: {}, results: [], createdAt: "2026-11-16T10:00:00Z" };
  const waiting = waitingHarness.start({ description: description(folder, 1), alsoSpecs: ["82-next"],
    alsoDescriptions: { "82-next": description("82-next", 2) }, queueMirror: JSON.stringify([job]),
    executionGroups: [{ id: "waiting-group", project: "aide", name: "Release", members: [folder, "82-next"],
      branch: "group/release", state: "stopped", currentMember: folder, completedMembers: [], jobs: [] }],
    extra: { queueDefaults: { model: { default: "sonnet" }, modelChoices: { sonnet: {}, opus: {} },
      timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" } } },
  });
  const waitingBase = waiting.base;
  makeSpecsRepo(waiting.dir);
  await waiting.server.settle();
  const p = await browser.newPage();
  try {
    await p.goto(`${waitingBase}/?live=0`);
    await p.getByRole("button", { name: "Release", exact: true }).click();
    await p.locator(`tr[data-folder="${folder}"] a.fold`).click();
    const analyze = p.getByRole("checkbox", { name: "Analyze", exact: true });
    expect(await analyze.isDisabled()).toBe(true);
    expect(await p.locator('select[name="model.analyze"]').isEnabled()).toBe(true);
    const stopped = p.waitForResponse((r) => r.url().endsWith("/action") && r.request().method() === "POST");
    await p.locator("form[data-group-default-action]").getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await stopped).status()).toBe(200);
    await analyze.waitFor();
    await analyze.uncheck();
    await p.getByRole("checkbox", { name: "Implement", exact: true }).check();
    const started = p.waitForResponse((r) => r.url().endsWith("/action") && r.request().method() === "POST");
    await p.getByRole("button", { name: "Start", exact: true }).click();
    const response = await started;
    expect(response.status()).toBe(200);
    expect((await response.json()).job.steps).toEqual(["implement"]);
  } finally { await p.close(); waitingHarness.cleanup(); }
});
