// What a job's per-step tables and its model choice put on the runner's
// command line: the tool, the effort, the acceptance switch, the time
// limit, and the settings a step added later falls back to.

import { describe, expect, test } from "bun:test";

// The argv is where a tool choice becomes real. Two rules, and
// the second one is the reason this is testable at all: the flag is
// appended ONLY when the resolved tool is not claude, so every config
// that predates this spec produces byte-for-byte the argv it always did.
describe("a model choice's tool reaches the runner", () => {
  const job = (model: Record<string, string>) =>
    ({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["implement"],
      timeoutSec: 2700,
      permissionMode: { implement: "bypassPermissions" },
      model,
    }) as unknown as Parameters<typeof import("../../../../src/serve/serve-helpers").runnerArgv>[0];

  test("a codex choice passes --tool and its own model name", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(job({ implement: "codex-fast" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      modelChoices: { "codex-fast": {  tool: "codex", model: "gpt-5.6" } },
    });
    expect(argv[argv.indexOf("--tool") + 1]).toBe("codex");
    // The real model, not the picker's display key.
    expect(argv[argv.indexOf("--model") + 1]).toBe("gpt-5.6");
    expect(argv).not.toContain("codex-fast");
  });

  test("a choice with no model of its own keeps using its key", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(job({ implement: "codex-fast" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      modelChoices: { "codex-fast": {  tool: "codex" } },
    });
    expect(argv[argv.indexOf("--model") + 1]).toBe("codex-fast");
  });

  test("a choice with no tool field is claude, and the argv is unchanged", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const before = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", o);
    const after = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", {
      ...o,
      modelChoices: { opus: { } },
    });
    expect(after).not.toContain("--tool");
    expect(after).toEqual(before);
    expect(after[after.indexOf("--model") + 1]).toBe("opus");
  });

  test("a server with no choices configured at all still runs claude", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv).not.toContain("--tool");
  });
});

// The sibling of the model/tool argv tests above, for effort.
describe("a chosen effort reaches the runner", () => {
  const effortJob = (effort: Record<string, string>) =>
    ({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["implement"],
      timeoutSec: 2700,
      permissionMode: { implement: "bypassPermissions" },
      model: {},
      effort,
    }) as unknown as Parameters<typeof import("../../../../src/serve/serve-helpers").runnerArgv>[0];

  test("--effort lands in argv when the job named one for this step", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(effortJob({ implement: "low" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv[argv.indexOf("--effort") + 1]).toBe("low");
  });

  test("no --effort at all when the job named none — byte-for-byte the old argv", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const withNoEffort = runnerArgv(effortJob({}), "implement", "/tmp/r.json", o);
    expect(withNoEffort).not.toContain("--effort");
  });
});

// This is `create`'s own invocation field; `analyze`'s own answer is
// moved to
// a fresh file read the caller resolves into `acceptanceNotRequiredForAnalyze`.
describe("the acceptance-not-required switch reaches the runner", () => {
  const switchJob = (acceptanceNotRequired?: boolean) =>
    ({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["analyze"],
      timeoutSec: 2700,
      permissionMode: { analyze: "bypassPermissions" },
      model: {},
      ...(acceptanceNotRequired ? { acceptanceNotRequired } : {}),
    }) as unknown as Parameters<typeof import("../../../../src/serve/serve-helpers").runnerArgv>[0];

  test("--acceptance-not-required lands in analyze's argv from the file-backed option, not the job field", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(switchJob(), "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      acceptanceNotRequiredForAnalyze: true,
    });
    expect(argv).toContain("--acceptance-not-required");
  });

  test("the job's own field no longer reaches analyze's argv at all", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(switchJob(true), "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv).not.toContain("--acceptance-not-required");
  });

  test("no flag at all when neither the job nor the file says so — byte-for-byte the old argv", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const withNoSwitch = runnerArgv(switchJob(), "analyze", "/tmp/r.json", o);
    expect(withNoSwitch).not.toContain("--acceptance-not-required");
  });

  test("the job's own field still reaches create's own invocation unchanged", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const createJob = { ...switchJob(true), steps: ["create"] } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(createJob, "create", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv).toContain("--acceptance-not-required");
  });
});

// --- The wall clock is per step ----------------------------------
//
// The argv the runner is started with carries each step's own time
// limit, not one number for every step.
describe("a step's own time limit reaches the runner", () => {
  const jobWith = (timeoutSec: unknown, steps: string[] = ["analyze", "implement"]) =>
    ({
      project: "aide", specFolder: "81-queue-and-runner", steps,
       timeoutSec, permissionMode: {}, model: {},
    }) as unknown as Parameters<typeof import("../../../../src/serve/serve-helpers").runnerArgv>[0];

  const timeoutArg = (argv: string[]): string => argv[argv.indexOf("--timeout-sec") + 1]!;

  test("an implement is spawned with implement's number, not default's", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
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
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(jobWith(2700), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(timeoutArg(argv)).toBe("2700");
  });

  test("a step the table does not name falls to its default", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(jobWith({ default: 1200, implement: 5400 }, ["archive"]), "archive", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(timeoutArg(argv)).toBe("1200");
  });

  // The shape `parseJobRequest` actually produces. `perStep`
  // resolves the config's `default` into a concrete entry for each step
  // the request named, so a job's own table never carries a `default`
  // key of its own — and a step ticked onto the tail afterwards
  // has no entry at all. Both fallbacks above are therefore
  // `undefined` for it, and the runner is handed the string
  // "undefined" as its deadline.
  test("a tail-added step the job's table cannot name falls to the live config", async () => {
    const { resolveTimeoutSec } = await import("../../../../src/serve/serve-helpers");
    const live = { default: 1200, implement: 5400 };
    expect(resolveTimeoutSec({ analyze: 1200 }, "implement", live)).toBe(5400);
    expect(resolveTimeoutSec({ analyze: 1200 }, "archive", live)).toBe(1200);
  });

  test("the argv for a tail-added step carries a real number, not \"undefined\"", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(jobWith({ analyze: 1200 }, ["analyze", "implement"]), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
      timeoutSec: { default: 1200, implement: 5400 },
    });
    expect(timeoutArg(argv)).toBe("5400");
  });
});

// --- A step added later brings its settings with it ---------------
//
// A reader can tick a phase onto a job that is already
// running. The job's three per-step tables are built at CREATION from
// the steps it had then, so the added step has no entry in any of them
// — and each miss costs something different when the step comes up:
// no deadline, `acceptEdits` where `implement` needs bypassPermissions
// (a spec was once stamped-but-not-moved by exactly that),
// and no `--model` flag at all.
describe("a tail-added step is spawned on the same terms as its siblings", () => {
  const jobWith = (over: Record<string, unknown> = {}) =>
    ({
      project: "aide", specFolder: "81-queue-and-runner",
      steps: ["analyze", "implement"], 
      timeoutSec: { analyze: 1200 }, permissionMode: { analyze: "acceptEdits" },
      model: { analyze: "sonnet" },
      ...over,
    }) as unknown as Parameters<typeof import("../../../../src/serve/serve-helpers").runnerArgv>[0];

  const base = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
  const live = {
    timeoutSec: { default: 1200, implement: 5400 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
  };

  test("it gets the config's permission mode, not the acceptEdits literal", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(jobWith(), "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
  });

  test("it gets the config's model, instead of no --model flag at all", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const argv = runnerArgv(jobWith(), "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
  });

  // A whole-job pick is already copied into every ORIGINAL step's own
  // `model` entry at creation, so a step added afterwards has to match
  // its siblings rather than fall through to what the config says for
  // that step in isolation.
  test("a whole-job model choice still wins over the config's per-step default", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const job = jobWith({ modelChoice: "sonnet", model: { analyze: "sonnet" } });
    const argv = runnerArgv(job, "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--model") + 1]).toBe("sonnet");
  });

  // The fallback never overrides an entry the job already
  // has. Every step present at creation keeps running on exactly the
  // terms it was created with, config changes since then included.
  test("a step the job's own table names is untouched by the fallback", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const job = jobWith({
      timeoutSec: { analyze: 900 }, permissionMode: { analyze: "plan" }, model: { analyze: "haiku" },
    });
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--timeout-sec") + 1]).toBe("900");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(argv[argv.indexOf("--model") + 1]).toBe("haiku");
  });
});
