import { expect, test } from "bun:test";
import { stepDoneHandler, type RunnerSetupContext } from "../../../src/serve/runner-setup.ts";
import type { Job } from "../../../src/queue/queue.ts";

test("required dependencies are handled only after the stopped analysis has landed", async () => {
  const calls: string[] = [];
  let finishLanding!: () => void;
  const landing = new Promise<void>((resolve) => { finishLanding = resolve; });
  let handled!: () => void;
  const done = new Promise<void>((resolve) => { handled = resolve; });
  const ctx = {
    specDir: () => undefined, peekMachinerySpecDir: (_p: string, dir: string) => dir,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, machineryProjectDir: () => "/code",
    machinerySpecsRoot: () => "/specs", landStoppedStepBranch: () => landing,
    handleSharedFiles: async () => { calls.push("handled"); handled(); },
  } as unknown as RunnerSetupContext;
  const job = { project: "aide", specFolder: "1-a", steps: ["analyze"], stepIndex: 0 } as Job;
  const hook = stepDoneHandler(ctx);
  hook(job, "analyze", { ok: false, terminalReason: "shared-files", branchUrls: [{ root: "/specs", url: "branch" }] });
  expect(calls).toEqual([]);
  finishLanding();
  await Promise.race([done, Bun.sleep(1000).then(() => { throw new Error("dependency handling never ran"); })]);
  expect(calls).toEqual(["handled"]);
});
