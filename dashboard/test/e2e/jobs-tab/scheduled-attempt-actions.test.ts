import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../../helpers/queue-server.ts";
import { browserDeadline } from "../../helpers/browser-deadline.ts";

browserDeadline();
const harness = queueHarness("aide-scheduled-actions-");
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); harness.cleanup(); });

const attempt = (id: string, name: string) => ({ id, project: "aide", specFolder: `schedule-${name}`, steps: ["schedule"], stepIndex: 0,
  state: "stopped", stopReason: "provider-limit", usageLimitWait: { until: "2027-01-01T00:00:00Z", resetKnown: true },
  timeoutSec: {}, permissionMode: {}, model: { schedule: "codex-fast" }, results: [], createdAt: "2026-11-01T00:00:00Z" });

test("quota Cancel and Run use shared confirmation and isolated current schedule picks (AC-1, AC-4, AC-5, AC-8)", async () => {
  const extra: import("../../../src/serve/serve.ts").ServerOptions = { port: 0 };
  const { base } = harness.start({ queueMirror: JSON.stringify([attempt("old-report", "nightly"), { ...attempt("other-report", "other"), state: "failed" }]),
    before: (dir) => {
      extra.queueConfigFile = join(dir, "config.json");
      writeFileSync(extra.queueConfigFile, JSON.stringify({ schedules: { aide: ["nightly", "other"].map((name) => ({
        name, cron: "0 3 * * *", prompt: "report.md", model: "sonnet", provider: "Claude", since: "2999-01-01T00:00:00Z",
      })) } }));
    },
    extra: Object.assign(extra, { queueDefaults: { timeoutSec: {}, permissionMode: {}, model: { default: "sonnet" },
      modelChoices: { sonnet: {}, "codex-fast": { tool: "codex" } },
      providers: { Claude: { name: "Claude", tool: "claude" }, Codex: { name: "Codex", tool: "codex" } } } }),
  });
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?state=all&open=aide/schedule-nightly,aide/schedule-other&live=0`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
    await page.waitForFunction(async () => (await (await fetch("/api/queue/old-report")).json()).job.state === "cancelled");
    await page.getByRole("button", { name: "Run", exact: true }).first().waitFor();
    await page.locator('button[data-ask="jobrun-old-report"]').click();
    const dialog = page.getByRole("dialog");
    expect(await dialog.getByRole("combobox", { name: "Claude", exact: true }).inputValue()).toBe("Claude");
    expect(await dialog.getByRole("combobox", { name: "Model", exact: true }).inputValue()).toBe("sonnet");
    await dialog.getByRole("combobox", { name: "Claude", exact: true }).selectOption("Codex");
    expect(await dialog.getByRole("combobox", { name: "Model", exact: true }).inputValue()).toBe("codex-fast");
    const intercepted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const runPath = "**/api/queue/schedule/aide/nightly/run";
    await page.route(runPath, async (route) => {
      intercepted.resolve();
      await release.promise;
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Retry refused for this attempt" }) });
    });
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await intercepted.promise;
    expect(await dialog.getByRole("button", { name: "OK", exact: true }).isDisabled()).toBe(true);
    release.resolve();
    await page.getByText("Problem: Retry refused for this attempt", { exact: true }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.unroute(runPath);
    await page.locator('button[data-ask="jobrun-old-report"]').click();
    const sent = page.waitForResponse((r) => r.url().endsWith("/api/queue/schedule/aide/nightly/run") && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    const response = await sent;
    expect(response.ok()).toBe(true);
    const fresh = (await response.json()).job;
    expect(fresh.id).not.toBe("old-report");
    expect(fresh.provider.schedule).toBe("Codex");
    expect(fresh.model.schedule).toBe("codex-fast");
    await page.waitForFunction(async () => (await (await fetch("/api/queue")).json()).jobs.length === 3);
    await page.locator('button[data-ask="jobrun-other-report"]').click();
    expect(await page.getByRole("dialog").getByRole("combobox", { name: "Claude", exact: true }).inputValue()).toBe("Claude");
    await page.keyboard.press("Escape");
  } finally { await page.close(); }
});
