import { afterAll, beforeAll, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { queueHarness } from "../../helpers/queue-server.ts";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { CLEAN_MASTER, fakeGit } from "../../helpers/fake-git.ts";

browserDeadline();
const harness = queueHarness("aide-failed-merge-actions-");
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); harness.cleanup(); });

const failedMerge = { id: "m1", project: "aide", specFolder: "land", steps: ["land"], stepIndex: 0, state: "failed", branch: "fix/topic",
  timeoutSec: {}, permissionMode: {}, model: {}, results: [], createdAt: "2026-11-20T10:00:00Z", finishedAt: "2026-11-20T10:05:00Z" };

test("a failed Merge offers Start as its button and Remove in its card menu", async () => {
  const { base } = harness.start({
    queueMirror: JSON.stringify([failedMerge]),
    extra: { gitRun: fakeGit({
      ...CLEAN_MASTER,
      "ls-remote --exit-code --heads origin refs/heads/fix/topic": { code: 0, stdout: "abc\trefs/heads/fix/topic\n" },
    }).run },
  });
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?state=all&open=aide/land:land&live=0`);
    await page.getByRole("button", { name: "Start", exact: true }).waitFor();
    await page.getByLabel("More actions for Merge to", { exact: false }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
    await page.waitForFunction(async () => !!(await (await fetch("/api/queue/m1")).json()).job.removedAt);
    await page.getByRole("button", { name: "Start", exact: true }).waitFor({ state: "detached" });
  } finally { await page.close(); }
});
