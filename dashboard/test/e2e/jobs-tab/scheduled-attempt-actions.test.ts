import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { queueHarness } from "../../helpers/queue-server.ts";
import { browserDeadline } from "../../helpers/browser-deadline.ts";

browserDeadline();
const harness = queueHarness("aide-scheduled-actions-");
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); harness.cleanup(); });

const attempt = (id: string, name: string) => ({ id, project: "aide", specFolder: `schedule-${name}`, steps: ["schedule"], stepIndex: 0,
  state: "waiting", stopReason: "provider-limit", usageLimitWait: { until: "2027-01-01T00:00:00Z", resetKnown: true },
  timeoutSec: {}, permissionMode: {}, model: { schedule: "codex-fast" }, results: [], createdAt: "2026-11-01T00:00:00Z" });

test("a quota wait is cancelled from its row, and a cancelled or failed run offers Remove alone", async () => {
  const { base } = harness.start({ queueMirror: JSON.stringify([attempt("old-report", "nightly"), { ...attempt("other-report", "other"), state: "failed" }]) });
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?state=all&open=aide/schedule-nightly,aide/schedule-other&live=0`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
    await page.waitForFunction(async () => (await (await fetch("/api/queue/old-report")).json()).job.state === "cancelled");
    await page.getByRole("button", { name: "Remove", exact: true }).nth(1).waitFor();
    expect(await page.getByRole("button", { name: "Start", exact: true }).count()).toBe(0);
    await page.locator('button[data-ask="jobremove-old-report"]').click();
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
    await page.waitForFunction(async () => !!(await (await fetch("/api/queue/old-report")).json()).job.removedAt);
    await page.locator("#spec-aide\\/schedule-nightly").waitFor({ state: "detached" });
  } finally { await page.close(); }
});
