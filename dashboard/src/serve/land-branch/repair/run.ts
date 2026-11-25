// What both repairs share: the git and processes they run in the merge's
// tree, the AI session itself, and saving the result on the source branch.

import { appendFileSync } from "node:fs";
import type { Job, QueueDefaults } from "../../../queue/queue.ts";
import { runScript } from "../run-script.ts";
import { stepLogLine } from "../test-gate.ts";
import type { repairModel } from "./model.ts";

type ScriptResult = Awaited<ReturnType<typeof runScript>>;
export type RepairRun = (argv: string[], timeout?: number, env?: Record<string, string>) => Promise<ScriptResult>;
export type RepairGit = (args: string[]) => Promise<ScriptResult>;

/** Processes run in `dir` for `job`, refused once the repair is
 *  cancelled; git runs with no hooks. */
export function repairRunner(job: Job, dir: string, cancelled: () => boolean, label: string): { run: RepairRun; git: RepairGit } {
  const run: RepairRun = (argv, timeout = 60_000, env = {}) => {
    if (cancelled()) throw new Error(`${label} cancelled`);
    return runScript(argv, dir, timeout, job.id, env);
  };
  const git: RepairGit = (args) => run(["git", "-c", "core.hooksPath=/dev/null", ...args], 60_000);
  return { run, git };
}

/** The AI session, under implement's time limit, with its transcript
 *  kept beside the step's own. */
export async function runRepairSession(
  defaults: QueueDefaults,
  job: Job,
  run: RepairRun,
  model: NonNullable<ReturnType<typeof repairModel>>,
  transcriptName: string,
  label: string,
): Promise<ScriptResult> {
  const result = await run(model.argv, (defaults.timeoutSec.implement ?? defaults.timeoutSec.default ?? 1200) * 1000, model.env);
  if (job.streamFile) {
    const transcript = `${job.streamFile}.${transcriptName}.jsonl`;
    appendFileSync(transcript, result.stdout);
    stepLogLine(job, `${label} transcript: ${transcript}`);
  }
  stepLogLine(job, `${label} session ended (exit ${result.code})${result.stderr ? `: ${result.stderr.slice(-400)}` : ""}`, result.code !== 0);
  return result;
}

/** Push the repaired HEAD to the source branch, with no force, and drop
 *  the recovery ref once it is saved there. */
export async function pushRepair(git: RepairGit, job: Job, branch: string, recovery: string, what: string): Promise<boolean> {
  const pushed = await git(["push", "origin", `HEAD:refs/heads/${branch}`]);
  if (pushed.code) {
    stepLogLine(job, `could not save the ${what} on ${branch}: ${pushed.stderr.slice(-400)}`, true);
    return false;
  }
  await git(["update-ref", "-d", recovery]);
  return true;
}
