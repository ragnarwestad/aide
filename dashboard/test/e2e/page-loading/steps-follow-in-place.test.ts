// The spec page's Steps tab and a job page follow their job in place: no
// reload, no request while nothing runs, and a log that keeps the reader's
// place. Scroll, selection and navigation only exist in a real browser.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

const harness = queueHarness("aide-e2e-follow-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const FOLDER = "81-queue-and-runner";
const said = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }) + "\n";
const lines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => said(`line ${from + i}`)).join("");

async function enqueue(base: string, specFolder = FOLDER): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
  });
  return ((await res.json()) as { job: { id: string } }).job.id;
}

/** Counts a page's navigations and its follow asks. */
function watch(page: Page): { navigations: () => number; asks: () => number } {
  let navigations = 0;
  let asks = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++;
    else if (r.url().includes("follow=1")) asks++;
  });
  return { navigations: () => navigations, asks: () => asks };
}

describe("a page whose job is done holds still (AC-1)", () => {
  test("twelve seconds on, with another job queued, neither page navigates or asks (AC-1)", async () => {
    const first = harness.start({ alsoSpecs: ["82-other"] });
    const id = await enqueue(first.base);
    const stream = join(first.dir, "analyze.stream.jsonl");
    writeFileSync(stream, said("all done"));
    const mirror = join(first.dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.results = [{ step: "analyze", ok: true, tool: "claude", costUsd: 0, costMeasured: true, terminalReason: "completed", streamFile: stream, at: "2026-09-19T10:00:00Z" }];
    writeFileSync(mirror, JSON.stringify(jobs));
    const { base } = harness.start({ alsoSpecs: ["82-other"], extra: { queueMirrorPath: mirror } });

    const context = await browser.newContext();
    try {
      const steps = await context.newPage();
      const jobPage = await context.newPage();
      const stepsSeen = watch(steps);
      const jobSeen = watch(jobPage);
      await Promise.all([steps.goto(`${base}/specs/aide/${FOLDER}?tab=steps`), jobPage.goto(`${base}/jobs/${id}?tab=steps`)]);
      await enqueue(base, "82-other");
      await steps.waitForTimeout(12_000);
      expect([stepsSeen.navigations(), jobSeen.navigations()]).toEqual([1, 1]);
      expect([stepsSeen.asks(), jobSeen.asks()]).toEqual([0, 0]);
    } finally {
      await context.close();
    }
  });
});

describe("a page whose job runs follows it in place", () => {
  /** A server whose runner stays alive until `finish()`, bounded so the stand-in
   *  cannot outlive the test, with one job running its analyze step. */
  async function runningJob() {
    const own = mkdtempSync(join(tmpdir(), "aide-e2e-follow-runner-"));
    ownDirs.push(own);
    const go = join(own, "go");
    const fakeRunner = join(own, "fake-run-spec");
    writeFileSync(fakeRunner, `#!/bin/sh\nn=0\nwhile [ ! -f ${go} ] && [ $n -lt 1200 ]; do sleep 0.05; n=$((n+1)); done\n`, { mode: 0o755 });
    const results = join(own, "jobs");
    const { base } = harness.start({ extra: { queueRunnerBin: fakeRunner, queueResultDir: results, queuePollMs: 200 } });
    const id = await enqueue(base);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const body = (await (await fetch(`${base}/api/queue/${id}`)).json()) as { job: { state: string } };
      if (body.job.state === "running") break;
      if (Date.now() > deadline) throw new Error("the job never started");
      await Bun.sleep(100);
    }
    const stream = join(results, `${id}.analyze.stream.jsonl`);
    const runLog = join(results, `${id}.analyze.run.log`);
    const finish = () => {
      writeFileSync(join(results, `${id}.json`), JSON.stringify({ ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed" }));
      writeFileSync(go, "");
    };
    return { base, id, stream, runLog, finish };
  }

  const box = (page: Page) => page.locator(".logbox").first();
  const logHas = (page: Page, text: string) =>
    page.waitForFunction((t) => document.querySelector(".logbox pre")?.textContent?.includes(t) ?? false, text, { timeout: 5_000 });

  test("lines reach the Log, keep the reader's place, and the finished step stays open (AC-2, AC-3, AC-4, AC-5, AC-6)", async () => {
    const run = await runningJob();
    writeFileSync(run.stream, lines(1, 150));
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    try {
      const steps = await context.newPage();
      const jobPage = await context.newPage();
      const stepsSeen = watch(steps);
      const jobSeen = watch(jobPage);
      await Promise.all([
        steps.goto(`${run.base}/specs/aide/${FOLDER}?tab=steps`),
        jobPage.goto(`${run.base}/jobs/${run.id}`),
      ]);
      await Promise.all([logHas(steps, "line 150"), logHas(jobPage, "line 150")]);

      // A line in the transcript, and later one in the run log, appears in both pages' Log.
      appendFileSync(run.stream, said("line 151"));
      await Promise.all([logHas(steps, "line 151"), logHas(jobPage, "line 151")]);
      appendFileSync(run.runLog, "Aide: tests and commit\n");
      await Promise.all([logHas(steps, "tests and commit"), logHas(jobPage, "tests and commit")]);
      expect([stepsSeen.navigations(), jobSeen.navigations()]).toEqual([1, 1]);

      // At the end of a log longer than its box, new lines are followed (AC-4).
      const place = () =>
        box(jobPage).evaluate((el) => ({ top: Math.abs(el.scrollTop), fromTop: el.scrollHeight - el.clientHeight - Math.abs(el.scrollTop), tall: el.scrollHeight > el.clientHeight }));
      expect((await place()).tall).toBe(true);
      expect((await place()).top).toBeLessThanOrEqual(1);
      appendFileSync(run.stream, lines(152, 160));
      await logHas(jobPage, "line 160");
      expect((await place()).top).toBeLessThanOrEqual(1);

      // Scrolled up, the box stays where the reader is (AC-5).
      await box(jobPage).evaluate((el) => {
        el.scrollTop = -Math.floor((el.scrollHeight - el.clientHeight) / 2);
      });
      const before = await place();
      appendFileSync(run.stream, lines(161, 170));
      await logHas(jobPage, "line 170");
      expect(Math.abs((await place()).fromTop - before.fromTop)).toBeLessThanOrEqual(1);

      // The page's scroll, the open row and a selection in the earlier lines are kept (AC-3).
      await jobPage.evaluate(() => {
        window.scrollTo(0, 200);
        const pre = document.querySelector(".logbox pre")!;
        const text = [...pre.childNodes].find((n) => n.nodeType === 3)!;
        const range = document.createRange();
        range.setStart(text, 1);
        range.setEnd(text, 20);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
      });
      const held = await jobPage.evaluate(() => ({ y: window.scrollY, selected: String(window.getSelection()) }));
      expect(held.selected.length).toBeGreaterThan(0);
      appendFileSync(run.stream, lines(171, 175));
      await logHas(jobPage, "line 175");
      const kept = await jobPage.evaluate(() => ({ y: window.scrollY, selected: String(window.getSelection()), open: !!document.querySelector(".logbox") }));
      expect(kept).toEqual({ ...held, open: true });

      // The step finishes: its row shows the outcome, the log stays open with its last line, the address names it (AC-6).
      // A row that holds a selection waits for it to go, so the reader lets go first.
      await jobPage.evaluate(() => window.getSelection()!.removeAllRanges());
      appendFileSync(run.stream, said("the last line"));
      run.finish();
      for (const page of [steps, jobPage]) {
        await page.waitForFunction(() => document.body.textContent?.includes("completed") ?? false, undefined, { timeout: 8_000 });
        await logHas(page, "the last line");
        expect(new URL(page.url()).searchParams.get("step")).toBe("0");
      }
      expect([stepsSeen.navigations(), jobSeen.navigations()]).toEqual([1, 1]);
    } finally {
      await context.close();
    }
  });
});
