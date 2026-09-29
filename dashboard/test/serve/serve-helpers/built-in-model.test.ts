import { describe, expect, test } from "bun:test";
import { QUEUE_DEFAULTS } from "../../../src/serve/serve-helpers";
import { runnerArgv, stepTool } from "../../../src/serve/serve-helpers/runner-argv.ts";
import { mergeQueueDefaults, type Job } from "../../../src/queue/queue.ts";
import { resolveStepModel } from "../../../src/queue/model-name.ts";
import { WORKFLOW_STEPS } from "../../../src/queue/steps.ts";

/** The choices as the serving host lists them: capitalised names, each
 *  handing Claude Code its own model string. */
const HOST_CHOICES = {
  Fable: { model: "fable" },
  Opus: { model: "opus" },
  Sonnet: { model: "sonnet" },
};

/** A job nothing was picked for: no per-step model, no whole-job pick. */
const unpicked = (step: string): Job =>
  ({
    project: "aide", specFolder: "81-queue-and-runner", steps: [step],
    timeoutSec: {}, permissionMode: {}, model: {},
  }) as unknown as Job;

const argvFor = (step: string, defaults: ReturnType<typeof mergeQueueDefaults>): string[] =>
  runnerArgv(unpicked(step), step, "/tmp/r.json", {
    runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    ...defaults,
  });

describe("the built-in model for a step nothing was saved for", () => {
  test("every step runs on opus when there is no queue config at all (AC-1)", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(resolveStepModel(unpicked(step), step, QUEUE_DEFAULTS.model)).toBe("opus");
    }
  });

  test("every step runs on the host's Opus choice, on Claude Code (AC-1)", () => {
    const host = mergeQueueDefaults(QUEUE_DEFAULTS, { modelChoices: HOST_CHOICES });
    for (const step of WORKFLOW_STEPS) {
      expect(resolveStepModel(unpicked(step), step, host.model)).toBe("Opus");
      expect(stepTool(unpicked(step), step, host)).toBe("claude");
      const argv = argvFor(step, host);
      expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
      expect(argv).not.toContain("--tool");
    }
  });

  test("a step with a saved model runs on that, not on the built-in (AC-4)", () => {
    const host = mergeQueueDefaults(QUEUE_DEFAULTS, {
      modelChoices: HOST_CHOICES, model: { analyze: "Sonnet" },
    });
    expect(resolveStepModel(unpicked("analyze"), "analyze", host.model)).toBe("Sonnet");
    expect(resolveStepModel(unpicked("implement"), "implement", host.model)).toBe("Opus");
  });
});
