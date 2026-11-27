// A group stopped at a provider's limit, on the Running tab: Cancel opens the
// waiting member's phase choices, and Start sends the new selection.
import { expect, test } from "bun:test";
import type { Browser } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { e2eBrowser } from "../../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { makeSpecsRepo } from "../../helpers/specs-repo.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-group-wait-");
let browser: Browser;

const description = (folder: string, position: number) =>
  `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`;

e2eBrowser(harness, (launched) => {
  browser = launched;
});

test("Cancel opens an automatic group's phase choices and Start uses the new selection", async () => {
  const folder = "81-queue-and-runner";
  const job = { id: "waiting", project: "aide", specFolder: folder, executionGroupId: "waiting-group",
    steps: ["analyze", "implement"], stepIndex: 0, state: "waiting", stopReason: "provider-limit",
    usageLimitWait: { until: "2099-01-01T12:00:00Z", resetKnown: true },
    model: {}, timeoutSec: {}, permissionMode: {}, results: [], createdAt: "2026-11-16T10:00:00Z" };
  const waiting = harness.start({ description: description(folder, 1), alsoSpecs: ["82-next"],
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
  } finally { await p.close(); }
});
