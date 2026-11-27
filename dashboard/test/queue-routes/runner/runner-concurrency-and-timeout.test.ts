// Split out of runner-invocation.test.ts by theme.

import { IMPLEMENTED } from "../../helpers/queue-server.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_QUEUE_CONCURRENCY, isQueueConcurrency, parseQueueConcurrency, processSettings } from "../../../src/serve/serve-helpers";
import { createQueueRunner, type RunnerSetupContext } from "../../../src/serve/runner-setup/index.ts";
import { liveStartedGroups } from "../../../src/queue/job-rules/started-groups.ts";
import { JOB, specHead, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness(undefined, IMPLEMENTED);

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** A stand-in runner in a folder of its own that waits until the file
 *  `go` appears. Bounded, not just "wait for the file": `afterEach`
 *  removes the folder the moment the test ends, and a stand-in that has
 *  not noticed the go file by then would wait on a path that no longer
 *  exists, forever. The ceiling (20 s) is under the tests' own 30 s
 *  timeout, so a stand-in never outlives the test that made it. */
function waitingRunner(): { own: string; go: string; fakeRunner: string } {
  const own = mkdtempSync(join(tmpdir(), "aide-concurrency-"));
  ownDirs.push(own);
  const go = join(own, "go");
  const fakeRunner = join(own, "fake-run-spec");
  writeFileSync(
    fakeRunner,
    `#!/bin/sh\nn=0\nwhile [ ! -f ${go} ] && [ $n -lt 400 ]; do sleep 0.05; n=$((n+1)); done\n`,
    { mode: 0o755 },
  );
  return { own, go, fakeRunner };
}

// --- How many at once -------------------------------
// The slot count is a number, and a number that turns out wrong should
// cost a config edit and a restart, not a release (`queue.ts:325-327`).
describe("the queue config decides how many run at once", () => {
  test("a number in 1-8 is taken; anything else falls back to two", () => {
    expect(parseQueueConcurrency(3)).toBe(3);
    expect(parseQueueConcurrency(1)).toBe(1);
    expect(parseQueueConcurrency(4)).toBe(4);
    expect(parseQueueConcurrency(6)).toBe(6);
    expect(parseQueueConcurrency(8)).toBe(8);
    // FALLS BACK, does not clamp: `concurrency: 9` would otherwise have
    // to be both 8 and 2 depending on which rule you read.
    expect(parseQueueConcurrency(9)).toBe(2);
    expect(parseQueueConcurrency(0)).toBe(2);
    expect(parseQueueConcurrency(-1)).toBe(2);
    expect(parseQueueConcurrency(2.5)).toBe(2);
    expect(parseQueueConcurrency("3")).toBe(2);
    expect(parseQueueConcurrency(undefined)).toBe(2);
  });

  test("the save's check takes the whole numbers 1 to 8 and nothing else", () => {
    for (let n = 1; n <= 8; n++) expect(isQueueConcurrency(n)).toBe(true);
    for (const bad of [0, 9, 2.5, "3", Number.NaN, undefined]) expect(isQueueConcurrency(bad)).toBe(false);
  });

  test("the Process tab shows the running queue's count and the machine's cores", () => {
    expect(processSettings({ concurrency: 3 }, 6)).toEqual({
      concurrency: 3, cores: availableParallelism(), min: 1, max: 8,
    });
  });

  test("with no value saved, the queue and the tab both use the built-in default", () => {
    const ctx = {
      store: {}, machineryProjectDir: (p: string) => p, machinerySpecsRoot: () => undefined,
      queueRunnerBin: "/bin/true", queueResultDir: "/tmp", queueConcurrency: undefined,
    } as unknown as RunnerSetupContext;
    expect(createQueueRunner(ctx)?.concurrency).toBe(DEFAULT_QUEUE_CONCURRENCY);
    expect(DEFAULT_QUEUE_CONCURRENCY).toBe(2);
    expect(processSettings(null, undefined).concurrency).toBe(2);
  });

  test("with concurrency 3, three jobs for three specs really do run at once", async () => {
    // Not a unit test of the option: this starts three real runner
    // processes through the server's own spawn path, because "the number
    // reaches the runner" is not the same claim as "three run".
    const { own, go, fakeRunner } = waitingRunner();
    const specs = ["82-second", "83-third"];
    const { base } = start({
      queueRunnerBin: fakeRunner,
      queueResultDir: join(own, "jobs"),
      queueConcurrency: 3,
    }, [], specs);
    try {
      for (const specFolder of ["81-queue-and-runner", ...specs]) {
        const res = await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
        });
        expect(res.status).toBe(200);
      }
      // The runner ticks on a 2s timer.
      const deadline = Date.now() + 15000;
      let running: unknown[] = [];
      while (Date.now() < deadline) {
        const res = await fetch(`${base}/api/queue`, );
        const body = (await res.json()) as { jobs: { state: string }[] };
        running = body.jobs.filter((j) => j.state === "running");
        if (running.length >= 3) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(running.length).toBe(3);
      // Each spawned step's group is kept for the test round's waits.
      expect(liveStartedGroups("aide", () => true).length).toBeGreaterThanOrEqual(3);
    } finally {
      writeFileSync(go, "");
    }
  }, 30000);

  test("a count saved from Settings starts the next step without a restart", async () => {
    // One runs, a second waits for a slot, and the save gives it one.
    const { own, go, fakeRunner } = waitingRunner();
    const configFile = join(own, "queue-config.json");
    writeFileSync(configFile, `{\n  // how many at once\n  "concurrency": 1\n}\n`);
    const { base } = start({
      queueRunnerBin: fakeRunner,
      queueResultDir: join(own, "jobs"),
      queueConcurrency: 1,
      queueConfigFile: configFile,
    }, [], ["82-second"]);
    const runningCount = async (want: number): Promise<number> => {
      const deadline = Date.now() + 15000;
      let running = 0;
      while (Date.now() < deadline) {
        const body = (await (await fetch(`${base}/api/queue`)).json()) as { jobs: { state: string }[] };
        running = body.jobs.filter((j) => j.state === "running").length;
        if (running >= want) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      return running;
    };
    try {
      for (const specFolder of ["81-queue-and-runner", "82-second"]) {
        const res = await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
        });
        expect(res.status).toBe(200);
      }
      expect(await runningCount(1)).toBe(1);
      const saved = await fetch(`${base}/api/queue/settings/concurrency`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ concurrency: 2 }),
      });
      expect(saved.status).toBe(200);
      const after = readFileSync(configFile, "utf-8");
      expect(after).toContain("// how many at once");
      expect(after).toContain('"concurrency": 2');
      expect(await runningCount(2)).toBe(2);
    } finally {
      writeFileSync(go, "");
    }
  }, 30000);
});

describe("an over-charged cost survives the row mapping", () => {
  async function seeded(costMeasured: boolean): Promise<string> {
    const { base, dir } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST", headers, body: JSON.stringify({ ...JOB, steps: ["implement"] }),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "stopped";
    job.stopReason = "timeout";
    job.spentUsd = 35;
    job.results = [
      {
        step: "implement", ok: false, costUsd: 35, costMeasured,
        terminalReason: "timeout", at: "2026-08-21T07:58:00Z",
      },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  }

  const MARKER = '<summary title="why this is an estimate"';
  // The Running tab: the Specs list has no Cost column.

  test("the spec row's total carries no (?) marker even when it could not be measured", async () => {
    const { base } = start({ queueMirrorPath: await seeded(false) });
    const html = await (await fetch(`${base}/`)).text();
    expect(specHead(html, "81-queue-and-runner")).not.toContain(MARKER);
  });

  test("a measured total through the same seam carries no mark", async () => {
    const { base } = start({ queueMirrorPath: await seeded(true) });
    const html = await (await fetch(`${base}/`)).text();
    const head = specHead(html, "81-queue-and-runner");
    expect(head).toContain("$35.00");
    expect(head).not.toContain(MARKER);
  });
});
