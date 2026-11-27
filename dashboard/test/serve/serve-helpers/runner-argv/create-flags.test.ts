// The flags a create job's own choices put on the runner's command line,
// and that no other step is handed.

import { describe, expect, test } from "bun:test";

// --- Create with no AI session at all -------------------------------

describe("--no-ai-formulate reaches the runner only when the job says so", () => {
  test("present when the job's box was cleared, absent otherwise", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const job = {
      project: "aide", specFolder: "new-abc123de", steps: ["create"],
       timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      createNoAiFormulate: true,
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "create", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(argv).toContain("--no-ai-formulate");

    const ticked = { ...job, createNoAiFormulate: undefined } as unknown as Parameters<typeof runnerArgv>[0];
    const argvTicked = runnerArgv(ticked, "create", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(argvTicked).not.toContain("--no-ai-formulate");
  });

  test("never appended for a step other than create", async () => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    const job = {
      project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"],
       timeoutSec: 2700, permissionMode: {}, model: {},
      createNoAiFormulate: true,
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(argv).not.toContain("--no-ai-formulate");
  });
});

// --- the new spec's acceptance criteria checks level --------------------------

describe("--criteria-checks reaches the runner only for a create that chose a level", () => {
  const job = (step: string, level?: string) =>
    ({
      project: "aide", specFolder: "new-abc123de", steps: [step],
      timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      ...(level ? { createCriteriaChecks: level } : {}),
    }) as unknown as Parameters<typeof import("../../../../src/serve/serve-helpers").runnerArgv>[0];

  const argvFor = async (step: string, level?: string) => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    return runnerArgv(job(step, level), step, "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
  };

  test("a create with Stop chosen passes --criteria-checks stop", async () => {
    const argv = await argvFor("create", "stop");
    expect(argv[argv.indexOf("--criteria-checks") + 1]).toBe("stop");
  });

  test("a create without a level passes no flag", async () => {
    expect(await argvFor("create")).not.toContain("--criteria-checks");
  });

  test.each([["implement"]])("never for %s", async (step) => {
    expect(await argvFor(step, "stop")).not.toContain("--criteria-checks");
  });
});

// --- whether the new spec asks to choose between its approaches ---------------

describe("--choose-approach reaches the runner for a create from the form", () => {
  const job = (step: string, chooseApproach?: boolean) =>
    ({
      project: "aide", specFolder: "new-abc123de", steps: [step],
      timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      ...(chooseApproach === undefined ? {} : { createChooseApproach: chooseApproach }),
    }) as unknown as Parameters<typeof import("../../../../src/serve/serve-helpers").runnerArgv>[0];

  const argvFor = async (step: string, chooseApproach?: boolean) => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    return runnerArgv(job(step, chooseApproach), step, "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
  };

  test.each([[true, "yes"], [false, "no"]])("a create with the box %p passes --choose-approach %s", async (ticked, value) => {
    const argv = await argvFor("create", ticked);
    expect(argv[argv.indexOf("--choose-approach") + 1]).toBe(value);
  });

  test("a create job from before the box existed passes no flag", async () => {
    expect(await argvFor("create")).not.toContain("--choose-approach");
  });

  test.each([["implement"]])("never for %s", async (step) => {
    expect(await argvFor(step, true)).not.toContain("--choose-approach");
  });
});

// --- What a new spec builds on --------------------------------------

describe("a chosen dependency reaches the runner", () => {
  const createJob = (dependsOn?: string[]) =>
    ({
      project: "aide", specFolder: "new-abcd1234", steps: ["create"],
       timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      ...(dependsOn ? { createDependsOn: dependsOn } : {}),
    }) as unknown as Parameters<typeof import("../../../../src/serve/serve-helpers").runnerArgv>[0];

  const argvFor = async (dependsOn?: string[]) => {
    const { runnerArgv } = await import("../../../../src/serve/serve-helpers");
    return runnerArgv(createJob(dependsOn), "create", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
  };

  test("every chosen folder goes over as one --depends-on value", async () => {
    const argv = await argvFor(["92-a-spec-can-depend", "97-freshness"]);
    expect(argv).toContain("--depends-on");
    expect(argv[argv.indexOf("--depends-on") + 1]).toBe("92-a-spec-can-depend,97-freshness");
    // The two fields it sits beside are untouched.
    expect(argv[argv.indexOf("--title") + 1]).toBe("A new spec");
  });

  test("a create that names none passes no such flag", async () => {
    expect(await argvFor()).not.toContain("--depends-on");
    expect(await argvFor([])).not.toContain("--depends-on");
  });
});
