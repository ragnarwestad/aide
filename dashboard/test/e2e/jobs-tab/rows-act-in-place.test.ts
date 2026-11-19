// The Jobs tab in a browser: a job queued while the page is open gets its row
// without loading the page again, a row folds open in place, and Cancel and
// Stop end their job in place, as they do on the Specs list.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { createdJob, queueHarness } from "../../helpers/queue-server.ts";
import { fakeGit, CLEAN_MASTER } from "../../helpers/fake-git.ts";
import { makeSpecsRepo } from "../../helpers/specs-repo.ts";
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

test("a live row update preserves an unsubmitted search", async () => {
  const { base } = harness.start({ queueMirror: JSON.stringify([createdJob()]) });
  const page = await browser.newPage();
  const waiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    await page.goto(`${base}/?open=aide/${SPEC}`);
    await page.locator(SPEC_ROW).waitFor();
    await page.route((url) => url.searchParams.get("rows") === "1", async (route) => {
      const response = await route.fetch();
      waiting.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    const id = await queueAnalyze(base);
    await waiting.promise;
    await page.getByRole("searchbox").fill("missing");
    release.resolve();
    await page.locator(`form[action="/api/queue/${id}/cancel"]`).waitFor({ state: "attached" });
    expect(await page.getByRole("searchbox").inputValue()).toBe("missing");
    expect(await page.getByRole("searchbox").evaluate((input) => document.activeElement === input)).toBe(true);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("q") === "missing", { waitUntil: "commit" }),
      page.getByRole("button", { name: "Search", exact: true }).click(),
    ]);
    await page.getByRole("link", { name: t("en", "list.searchClearTitle"), exact: true }).click();
    await page.waitForFunction(() => {
      const input = document.querySelector('input[name="q"]') as HTMLInputElement | null;
      return !new URL(location.href).searchParams.has("q") && input?.value === "";
    });
  } finally {
    release.resolve();
    await page.close();
  }
});

describe("a spec's row on the Jobs tab acts in place", () => {
  test("Run on Specs asks for phases and models, starts the job on Jobs and the title link filters the spec (AC-3, AC-4)", async () => {
    const queueDefaults = {
      timeoutSec: { default: 1200 },
      permissionMode: { default: "acceptEdits" },
      model: { default: "sonnet" },
      modelChoices: { sonnet: {}, fable: {} },
    };
    const { base } = harness.start({ extra: { queueDefaults } });
    const page = await browser.newPage();
    await page.goto(`${base}/specs/aide/${SPEC}`);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator('input[name="steps"]').first().waitFor();
    expect(await dialog.locator('select[name^="model."]').count()).toBeGreaterThan(0);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/"),
      dialog.getByRole("button", { name: "Run", exact: true }).click(),
    ]);
    await page.goto(`${base}/specs/aide/${SPEC}`);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("q") === "aide:81"),
      page.locator("#jobrows").getByRole("link", { name: /81.*Queue/ }).click(),
    ]);
    expect(new URL(page.url()).searchParams.get("q")).toBe("aide:81");
    await page.close();
  });

  test("a first queued job adds its row in place and cancelling it before it starts removes that row", async () => {
    const { base, dir, server } = harness.start({ queueMirror: JSON.stringify([nightly]) });
    makeSpecsRepo(dir);
    await server.settle();
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    expect(await page.locator(SPEC_ROW).count()).toBe(0);
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
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "OK" }).click();
    // A job that never started is removed, not kept as cancelled.
    await page.waitForFunction(async (jobId) => (await fetch(`/api/queue/${jobId}`)).status === 404, id);
    // No job ever ran, so the spec returns to Specs alone.
    await page.locator(SPEC_ROW).waitFor({ state: "detached", timeout: 10_000 });
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

test("the first job arrives and remains as finished history without a reload, then search still works", async () => {
  const own = mkdtempSync(join(tmpdir(), "aide-empty-running-"));
  const emptyHarness = queueHarness("aide-empty-running-board-");
  const go = join(own, "go");
  const fakeRunner = join(own, "fake-run-spec");
  writeFileSync(fakeRunner, `#!/bin/sh\nn=0\nwhile [ ! -f ${go} ] && [ $n -lt 1200 ]; do sleep 0.05; n=$((n+1)); done\n`, { mode: 0o755 });
  const page = await browser.newPage();
  try {
    const { base } = emptyHarness.start({
      emptySpecs: true,
      extra: { queueRunnerBin: fakeRunner, queueResultDir: join(own, "jobs"), queuePollMs: 200 },
    });
    // The board has started in this tab, so its empty Jobs tab is shown.
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
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
    await page.waitForFunction(async (jobId) => {
      const r = await fetch(`/api/queue/${jobId}`);
      return ((await r.json()) as { job: { state: string } }).job.state === "cancelled";
    }, id);
    await page.locator('a[data-fold="open"][data-key="aide/schedule-nightly"]').waitFor();
    expect(loads.n).toBe(0);
    await page.getByRole("searchbox").fill("missing");
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("q") === "missing", { waitUntil: "commit" }),
      page.getByRole("button", { name: "Search", exact: true }).click(),
    ]);
    await page.getByText("Nothing on this tab matches this filter.", { exact: true }).waitFor();
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
  const staleHarness = queueHarness("aide-stale-log-board-");
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
  let cancelJob: (() => Promise<Response>) | undefined;
  try {
    const { base } = staleHarness.start({
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

    const id = await queueAnalyze(base);
    cancelJob = () => fetch(`${base}/api/queue/${id}/cancel`, { method: "POST" });
    await state.getByText(t("en", "list.state.running"), { exact: true }).waitFor({ timeout: 10_000 });
    expect((await state.innerText()).trim()).toBe(t("en", "list.state.running"));
    await log.getByText(explanation).waitFor({ timeout: 10_000 });
    expect(loads.n).toBe(0);
  } finally {
    try {
      if (cancelJob) await cancelJob();
      await page.close();
    } finally {
      staleHarness.cleanup();
      writeFileSync(go, "");
      rmSync(own, { recursive: true, force: true });
    }
  }
});

test("Types can select Merge separately and its card names the source branch (AC-2)", async () => {
  const baseJob = { project: "aide", stepIndex: 0, state: "queued", timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-11-16T12:00:00Z" };
  const { base } = harness.start({ queueMirror: JSON.stringify([
    { ...baseJob, id: "land-filter", specFolder: "land", steps: ["land"], branch: "fix/example" },
    { ...baseJob, id: "deploy-filter", specFolder: "deploy", steps: ["deploy"] },
  ]), extra: { gitRun: fakeGit(CLEAN_MASTER).run } });
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?live=0`);
    const menu = page.locator('details.menu[data-filter="kind"]');
    await menu.locator("summary").click();
    await menu.getByRole("checkbox", { name: "None", exact: true }).click();
    await menu.getByRole("checkbox", { name: "None", exact: true, checked: true }).waitFor();
    await menu.getByRole("checkbox", { name: "Merge (1)", exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get("kind") === "land");
    await page.getByText(/Merge to .* · fix\/example/, { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("kind")).toBe("land");
    await page.getByText("Deploy aide", { exact: true }).waitFor({ state: "hidden" });
  } finally { await page.close(); }
});


test("live merge activity changes without folding the open row (AC-5, AC-6, AC-7)", async () => {
  const own = mkdtempSync(join(tmpdir(), "merge-live-"));
  const file = join(own, "live.land.stream.jsonl");
  const log = file.replace(".stream.jsonl", ".run.log");
  writeFileSync(file, "");
  const mark = (task: number) => appendFileSync(log, `aide-run-spec 12:00:00 +0s --- Step ${task} of 4: Task — started\n`);
  mark(1);
  const { base } = harness.start({ queueMirror: JSON.stringify([{
    id: "live-merge", project: "aide", specFolder: "land", steps: ["land"], stepIndex: 0,
    state: "running", pid: process.pid, branch: "feature/live", streamFile: file, results: [],
    timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-11-18T12:00:00Z",
  }]), extra: { gitRun: fakeGit(CLEAN_MASTER).run, queueRunnerBin: "/bin/true", queueResultDir: own } });
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?open=aide/land:land`);
    await page.getByText("Merging", { exact: true }).waitFor();
    const loads = countLoads(page);
    mark(2);
    await page.getByText("Testing", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("open")).toBe("aide/land:land");
    mark(3);
    await page.getByText("Running", { exact: true }).waitFor();
    expect(loads.n).toBe(0);
  } finally { await page.close(); rmSync(own, { recursive: true, force: true }); }
});
