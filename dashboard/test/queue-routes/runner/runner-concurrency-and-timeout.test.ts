// Split out of runner-invocation.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseQueueConcurrency } from "../../../src/serve/serve.ts";
import { JOB, TOKEN, specHead, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// --- Spec 91, criterion 26: how many at once -------------------------------
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

  test("with concurrency 3, three jobs for three specs really do run at once", async () => {
    // Not a unit test of the option: this starts three real runner
    // processes through the server's own spawn path, because "the number
    // reaches the runner" is not the same claim as "three run".
    const own = mkdtempSync(join(tmpdir(), "aide-concurrency-"));
    ownDirs.push(own);
    const go = join(own, "go");
    const fakeRunner = join(own, "fake-run-spec");
    writeFileSync(fakeRunner, `#!/bin/sh\nwhile [ ! -f ${go} ]; do sleep 0.05; done\n`, { mode: 0o755 });
    const specs = ["82-second", "83-third"];
    const { base } = start({
      queueToken: TOKEN,
      queueRunnerBin: fakeRunner,
      queueResultDir: join(own, "jobs"),
      queueConcurrency: 3,
    }, [], specs);
    try {
      for (const specFolder of ["81-queue-and-runner", ...specs]) {
        const res = await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-aide-token": TOKEN },
          body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
        });
        expect(res.status).toBe(200);
      }
      // The runner ticks on a 2s timer.
      const deadline = Date.now() + 15000;
      let running: unknown[] = [];
      while (Date.now() < deadline) {
        const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
        const body = (await res.json()) as { jobs: { state: string }[] };
        running = body.jobs.filter((j) => j.state === "running");
        if (running.length >= 3) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(running.length).toBe(3);
    } finally {
      writeFileSync(go, "");
    }
  }, 30000);
});

// Spec 125: the argv is where a tool choice becomes real. Two rules, and
// the second one is the reason this is testable at all: the flag is
// appended ONLY when the resolved tool is not claude, so every config
// that predates this spec produces byte-for-byte the argv it always did.
describe("a model choice's tool reaches the runner", () => {
  const job = (model: Record<string, string>) =>
    ({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["implement"],
      budgetUsd: 15,
      timeoutSec: 2700,
      permissionMode: { implement: "bypassPermissions" },
      model,
    }) as unknown as Parameters<typeof import("../../../src/serve/serve.ts").runnerArgv>[0];

  test("a codex choice passes --tool and its own model name", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(job({ implement: "codex-fast" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      modelChoices: { "codex-fast": { budgetUsd: 5, tool: "codex", model: "gpt-5.6" } },
    });
    expect(argv[argv.indexOf("--tool") + 1]).toBe("codex");
    // The real model, not the picker's display key.
    expect(argv[argv.indexOf("--model") + 1]).toBe("gpt-5.6");
    expect(argv).not.toContain("codex-fast");
  });

  test("a choice with no model of its own keeps using its key", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(job({ implement: "codex-fast" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      modelChoices: { "codex-fast": { budgetUsd: 5, tool: "codex" } },
    });
    expect(argv[argv.indexOf("--model") + 1]).toBe("codex-fast");
  });

  test("a choice with no tool field is claude, and the argv is unchanged", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const before = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", o);
    const after = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", {
      ...o,
      modelChoices: { opus: { budgetUsd: 15 } },
    });
    expect(after).not.toContain("--tool");
    expect(after).toEqual(before);
    expect(after[after.indexOf("--model") + 1]).toBe("opus");
  });

  test("a server with no choices configured at all still runs claude", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv).not.toContain("--tool");
  });
});

// Spec 364: the sibling of the model/tool argv tests above, for effort.
describe("a chosen effort reaches the runner", () => {
  const effortJob = (effort: Record<string, string>) =>
    ({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["implement"],
      budgetUsd: 15,
      timeoutSec: 2700,
      permissionMode: { implement: "bypassPermissions" },
      model: {},
      effort,
    }) as unknown as Parameters<typeof import("../../../src/serve/serve.ts").runnerArgv>[0];

  test("--effort lands in argv when the job named one for this step", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(effortJob({ implement: "low" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv[argv.indexOf("--effort") + 1]).toBe("low");
  });

  test("no --effort at all when the job named none — byte-for-byte the old argv", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const withNoEffort = runnerArgv(effortJob({}), "implement", "/tmp/r.json", o);
    expect(withNoEffort).not.toContain("--effort");
  });
});

// Spec 386: whole-job, like createDependsOn — appended to every step's
// own invocation, not looked up per step the way effort/model are.
describe("the acceptance-not-required switch reaches the runner", () => {
  const switchJob = (acceptanceNotRequired?: boolean) =>
    ({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["analyze"],
      budgetUsd: 15,
      timeoutSec: 2700,
      permissionMode: { analyze: "bypassPermissions" },
      model: {},
      ...(acceptanceNotRequired ? { acceptanceNotRequired } : {}),
    }) as unknown as Parameters<typeof import("../../../src/serve/serve.ts").runnerArgv>[0];

  test("--acceptance-not-required lands in argv when the job chose it", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(switchJob(true), "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv).toContain("--acceptance-not-required");
  });

  test("no flag at all when the job named nothing — byte-for-byte the old argv", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const withNoSwitch = runnerArgv(switchJob(), "analyze", "/tmp/r.json", o);
    expect(withNoSwitch).not.toContain("--acceptance-not-required");
  });
});

// --- spec 152: the wall clock is per step, and a stand-in cost says so -------
//
// 149's implement was killed at its own 45-minute limit with its tests
// already green, and was booked at the full budget because a SIGKILLed
// run prints no usage. Two seams in this file carried that: the argv the
// runner is started with (one number for every step), and the `Job` →
// `QueueRowView` mapping, which dropped `costMeasured` on the floor so
// the totals built on it could not tell a measurement from a ceiling.
describe("a step's own time limit reaches the runner", () => {
  const jobWith = (timeoutSec: unknown, steps: string[] = ["analyze", "implement"]) =>
    ({
      project: "aide", specFolder: "81-queue-and-runner", steps,
      budgetUsd: 3, timeoutSec, permissionMode: {}, model: {},
    }) as unknown as Parameters<typeof import("../../../src/serve/serve.ts").runnerArgv>[0];

  const timeoutArg = (argv: string[]): string => argv[argv.indexOf("--timeout-sec") + 1]!;

  test("an implement is spawned with implement's number, not default's", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const job = jobWith({ analyze: 1200, implement: 5400 });
    expect(timeoutArg(runnerArgv(job, "implement", "/tmp/r.json", o))).toBe("5400");
    expect(timeoutArg(runnerArgv(job, "analyze", "/tmp/r.json", o))).toBe("1200");
  });

  // A job created before the shape changed is still sitting in the
  // store across the deploy. Read as an index it would give `undefined`
  // and the runner would be handed the string "undefined" as its
  // deadline — a crash-adjacent read, not a cosmetic one.
  test("a job persisted with the old flat number is still given a real deadline", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith(2700), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(timeoutArg(argv)).toBe("2700");
  });

  test("a step the table does not name falls to its default", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith({ default: 1200, implement: 5400 }, ["archive"]), "archive", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(timeoutArg(argv)).toBe("1200");
  });

  // Spec 177: the shape `parseJobRequest` actually produces. `perStep`
  // resolves the config's `default` into a concrete entry for each step
  // the request named, so a job's own table never carries a `default`
  // key of its own — and a step ticked onto the tail afterwards (spec
  // 160) has no entry at all. Both fallbacks above are therefore
  // `undefined` for it, and the runner is handed the string
  // "undefined" as its deadline.
  test("a tail-added step the job's table cannot name falls to the live config", async () => {
    const { resolveTimeoutSec } = await import("../../../src/serve/serve.ts");
    const live = { default: 1200, implement: 5400 };
    expect(resolveTimeoutSec({ analyze: 1200 }, "implement", live)).toBe(5400);
    expect(resolveTimeoutSec({ analyze: 1200 }, "archive", live)).toBe(1200);
  });

  test("the argv for a tail-added step carries a real number, not \"undefined\"", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith({ analyze: 1200 }, ["analyze", "implement"]), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
      timeoutSec: { default: 1200, implement: 5400 },
    });
    expect(timeoutArg(argv)).toBe("5400");
  });
});

// --- spec 177: a step added later brings its settings with it ---------------
//
// Spec 160 lets a reader tick a phase onto a job that is already
// running. The job's three per-step tables are built at CREATION from
// the steps it had then, so the added step has no entry in any of them
// — and each miss costs something different when the step comes up:
// no deadline, `acceptEdits` where `implement` needs bypassPermissions
// (specs 105 and 112 were each stamped-but-not-moved by exactly that),
// and no `--model` flag at all.
describe("a tail-added step is spawned on the same terms as its siblings", () => {
  const jobWith = (over: Record<string, unknown> = {}) =>
    ({
      project: "aide", specFolder: "81-queue-and-runner",
      steps: ["analyze", "implement"], budgetUsd: 3,
      timeoutSec: { analyze: 1200 }, permissionMode: { analyze: "acceptEdits" },
      model: { analyze: "sonnet" },
      ...over,
    }) as unknown as Parameters<typeof import("../../../src/serve/serve.ts").runnerArgv>[0];

  const base = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
  const live = {
    timeoutSec: { default: 1200, implement: 5400 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
  };

  test("it gets the config's permission mode, not the acceptEdits literal", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith(), "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
  });

  test("it gets the config's model, instead of no --model flag at all", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith(), "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
  });

  // A whole-job pick is already copied into every ORIGINAL step's own
  // `model` entry at creation, so a step added afterwards has to match
  // its siblings rather than fall through to what the config says for
  // that step in isolation.
  test("a whole-job model choice still wins over the config's per-step default", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const job = jobWith({ modelChoice: "sonnet", model: { analyze: "sonnet" } });
    const argv = runnerArgv(job, "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--model") + 1]).toBe("sonnet");
  });

  // Criterion 7: the fallback never overrides an entry the job already
  // has. Every step present at creation keeps running on exactly the
  // terms it was created with, config changes since then included.
  test("a step the job's own table names is untouched by the fallback", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve.ts");
    const job = jobWith({
      timeoutSec: { analyze: 900 }, permissionMode: { analyze: "plan" }, model: { analyze: "haiku" },
    });
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--timeout-sec") + 1]).toBe("900");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(argv[argv.indexOf("--model") + 1]).toBe("haiku");
  });
});

describe("an over-charged cost survives the row mapping", () => {
  async function seeded(costMeasured: boolean): Promise<string> {
    const { base, dir } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
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

  const MARKER = '<span class="muted small">est.</span>';

  test("the spec row marks a total it could not measure", async () => {
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: await seeded(false) });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(specHead(html, "81-queue-and-runner")).toContain(MARKER);
  });

  test("a measured total through the same seam carries no mark", async () => {
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: await seeded(true) });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    const head = specHead(html, "81-queue-and-runner");
    expect(head).toContain("$35.00");
    expect(head).not.toContain(MARKER);
  });
});
