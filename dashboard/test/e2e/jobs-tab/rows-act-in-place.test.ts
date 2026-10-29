// The Jobs tab in a browser: a job queued while the page is open gets its row
// without loading the page again, a row folds open in place, and Cancel and
// Stop end their job in place, as they do on the Specs list.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { fakeGit } from "../../helpers/fake-git.ts";
import { t } from "../../../src/i18n";

browserDeadline();

const harness = queueHarness("aide-e2e-jobs-tab-");
let browser: Browser;

const SPEC = "81-queue-and-runner";
const SPEC_ROW = `tr.spechead[data-folder="${SPEC}"]`;

const nightly = {
  id: "nightly1", project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], stepIndex: 0, state: "running",
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
  test("a spec's row is on the tab before any job, a job queued on it redraws it in place and Cancel ends the job, the row staying, with no page load", async () => {
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

describe("a scheduled job's row folds and stops in place", () => {
  const JOB_ROW = 'tr.spechead[id="spec-aide/schedule-nightly"]';
  const FOLD = `${JOB_ROW} a[data-fold="open"]`;
  const STOP = `${JOB_ROW} + tr.specstate button[data-ask]`;
  const CHIP = `${JOB_ROW} + tr.specstate .badgeslot .badge`;

  test("the row is shut, its › opens it with no page load and shuts it again, and Stop and its OK end the job cancelled", async () => {
    const { base } = harness.start({ queueMirror: JSON.stringify([nightly]) });
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    await page.locator(JOB_ROW).waitFor();
    const loads = countLoads(page);

    expect(await page.locator(STOP).count()).toBe(0);

    await page.locator(FOLD).click();
    await page.locator(STOP).waitFor({ state: "visible" });
    expect(await page.locator(CHIP).isVisible()).toBe(true);
    expect(pathOf(page)).toBe("/");
    expect(new URL(page.url()).searchParams.get("open")).toBe("aide/schedule-nightly");
    expect(loads.n).toBe(0);

    await page.locator(FOLD).click();
    await page.locator(STOP).waitFor({ state: "detached" });
    expect(new URL(page.url()).searchParams.get("open")).toBeNull();

    await page.locator(FOLD).click();
    await page.locator(STOP).click();
    await page.locator("dialog[open]").getByRole("button", { name: "OK" }).click();
    await page.waitForFunction(async () => {
      const r = await fetch("/api/queue/nightly1");
      return ((await r.json()) as { job: { state: string } }).job.state === "cancelled";
    });
    expect(await stateOf(base, "nightly1")).toBe("cancelled");
    expect(pathOf(page)).toBe("/");
    expect(loads.n).toBe(0);
    await page.close();
  });

  test("opened, the row shows its Stop and its state chip at desktop width and at a phone's", async () => {
    const { base } = harness.start({ queueMirror: JSON.stringify([nightly]) });
    for (const width of [1280, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(`${base}/?open=aide/schedule-nightly`);
      await page.locator(STOP).waitFor({ state: "visible" });
      expect(await page.locator(CHIP).isVisible()).toBe(true);
      await page.close();
    }
  });
});


test("the first job arrives and the last leaves without a reload, then search still works", async () => {
  const own = mkdtempSync(join(tmpdir(), "aide-empty-running-"));
  const emptyHarness = queueHarness("aide-empty-running-board-");
  const go = join(own, "go");
  const fakeRunner = join(own, "fake-run-spec");
  writeFileSync(fakeRunner, `#!/bin/sh\nn=0\nwhile [ ! -f ${go} ] && [ $n -lt 1200 ]; do sleep 0.05; n=$((n+1)); done\n`, { mode: 0o755 });
  const page = await browser.newPage();
  try {
    const { base, dir } = emptyHarness.start({
      extra: { queueRunnerBin: fakeRunner, queueResultDir: join(own, "jobs"), queuePollMs: 200 },
    });
    rmSync(join(dir, "root", "aide", "specs", SPEC), { recursive: true });
    // The board has started in this tab, so its empty Running tab is shown.
    await page.addInitScript(() => sessionStorage.setItem("aide-started", "1"));
    await page.goto(`${base}/`);
    await page.getByText("Nothing is running.", { exact: true }).waitFor();
    const loads = countLoads(page);
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"] }),
    });
    expect(res.ok).toBe(true);
    const id = ((await res.json()) as { job: { id: string } }).job.id;
    await page.locator('a[data-fold="open"][data-key="aide/schedule-nightly"]').click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
    await page.waitForFunction(async (jobId) => {
      const r = await fetch(`/api/queue/${jobId}`);
      return ((await r.json()) as { job: { state: string } }).job.state === "cancelled";
    }, id);
    await page.getByText("Nothing is running.", { exact: true }).waitFor();
    expect(loads.n).toBe(0);
    await page.getByRole("searchbox").fill("missing");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get("q") === "missing");
    await page.getByText("Nothing is running.", { exact: true }).waitFor();
    expect(await page.getByRole("searchbox").inputValue()).toBe("missing");
  } finally {
    writeFileSync(go, "");
    await page.close();
    emptyHarness.cleanup();
    rmSync(own, { recursive: true, force: true });
  }
});

// A description changed since the analysis is said in the analysis phase's log, which opens even with
// no transcript kept, and stays there while the new analysis runs; the phase's State/Action cell says
// the standard word alone.
test("a description changed since the analysis is in the analysis log, opened with a click, and stays there through a live update to Running", async () => {
  const own = mkdtempSync(join(tmpdir(), "aide-stale-log-"));
  const go = join(own, "go");
  const fakeRunner = join(own, "fake-run-spec");
  writeFileSync(fakeRunner, `#!/bin/sh\nn=0\nwhile [ ! -f ${go} ] && [ $n -lt 1200 ]; do sleep 0.05; n=$((n+1)); done\n`, { mode: 0o755 });
  // The specs repo: create and analyze ran, and the description was committed after the analysis.
  const subject = (step: string) => `Run /aide-${step} for ${SPEC} (headless)`;
  const git = fakeGit({
    "log --all --format=%s": { code: 0, stdout: ["analyze", "create"].map(subject).join("\n") },
    "log -1 --format=%H": { code: 0, stdout: "deadbee\t2026-08-18T09:10:36+02:00\n" },
    "log --format=%H%x09%aI%x09%s": { code: 0, stdout: `deadbee\t2026-08-18T08:57:16+02:00\t${subject("analyze")}\n` },
    "diff --quiet": { code: 1 },
  });
  const explanation = t("en", "list.descriptionChangedSince");
  const page = await browser.newPage();
  try {
    const { base } = harness.start({
      extra: { gitRun: git.run, queueRunnerBin: fakeRunner, queueResultDir: join(own, "jobs"), queuePollMs: 200 },
    });
    const analyzeLine = page.locator(`${SPEC_ROW} ~ tr.subrow[data-step="analyze"]`);
    const state = analyzeLine.locator('td[data-col="state"]');
    const log = page.locator('tr.phasemsgs[data-msgs="analyze"]');
    const fold = analyzeLine.getByRole("link", { name: t("en", "list.phaseFoldTitle", { phase: "Analyze", action: t("en", "list.foldShow") }) });
    // The freshness answer arrives on the cache schedule, so the page is asked again until it has it.
    for (let tries = 0; tries < 50; tries++) {
      await page.goto(`${base}/?open=aide/${SPEC}`);
      if (await fold.count()) break;
      await page.waitForTimeout(200);
    }
    const loads = countLoads(page);

    await fold.click();
    await log.getByText(explanation).waitFor({ timeout: 10_000 });
    expect(await state.innerText()).not.toContain(explanation);

    await queueAnalyze(base);
    await state.getByText(t("en", "list.state.running"), { exact: true }).waitFor({ timeout: 10_000 });
    expect((await state.innerText()).trim()).toBe(t("en", "list.state.running"));
    await log.getByText(explanation).waitFor({ timeout: 10_000 });
    expect(loads.n).toBe(0);
  } finally {
    writeFileSync(go, "");
    await page.close();
    rmSync(own, { recursive: true, force: true });
  }
});
