// A running scheduled job's row on the Running page, opened with its ›, shows a
// step its log marks afterwards, with no page load: the growth check, the
// stream's reopen on the fold and the redraw together, which only a browser runs.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
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

const harness = queueHarness("aide-e2e-schedule-steps-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const KEY = "aide/schedule-nightly";
const said = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }) + "\n";

describe("a running scheduled job's open row (AC-4)", () => {
  test("shows a step the log marks after the row was opened, without the page being loaded again (AC-4)", async () => {
    const own = mkdtempSync(join(tmpdir(), "aide-e2e-schedule-steps-own-"));
    ownDirs.push(own);
    const go = join(own, "go");
    const fakeRunner = join(own, "fake-run-spec");
    // Stays alive until the test is over, bounded so it cannot outlive it.
    writeFileSync(fakeRunner, `#!/bin/sh\nn=0\nwhile [ ! -f ${go} ] && [ $n -lt 1200 ]; do sleep 0.05; n=$((n+1)); done\n`, { mode: 0o755 });
    const results = join(own, "jobs");
    const { base } = harness.start({
      extra: { queueRunnerBin: fakeRunner, queueResultDir: results, queuePollMs: 200, scheduleOutputRoot: join(own, "schedule-output") },
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"] }),
    });
    const id = ((await res.json()) as { job: { id: string } }).job.id;
    const deadline = Date.now() + 15_000;
    for (;;) {
      const body = (await (await fetch(`${base}/api/queue/${id}`)).json()) as { job: { state: string } };
      if (body.job.state === "running") break;
      if (Date.now() > deadline) throw new Error("the job never started");
      await Bun.sleep(100);
    }
    const stream = join(results, `${id}.schedule.stream.jsonl`);
    writeFileSync(stream, said("--- Step 1 of 2: Read the list — started"));

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      let navigations = 0;
      page.on("request", (r) => {
        if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++;
      });
      await page.goto(`${base}/`);
      await page.locator(`a.fold[data-key="${KEY}"]`).click();
      await page.waitForSelector('tr.subrow[data-step="Step 1 of 2"]', { timeout: 8_000 });

      appendFileSync(stream, said("--- Step 2 of 2: Write the report — started"));
      await page.waitForSelector('tr.subrow[data-step="Step 2 of 2"]', { timeout: 8_000 });
      expect(navigations).toBe(1);
    } finally {
      await context.close();
      writeFileSync(go, "");
    }
  });
});
