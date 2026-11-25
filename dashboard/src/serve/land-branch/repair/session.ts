import { appendFileSync, existsSync } from "node:fs";
import type { Job, QueueDefaults } from "../../../queue/queue.ts";
import { repairModel, repairSessionFailed } from "./model.ts";
import { resolveWorktreeLinks } from "../../../project/discover";
import { scriptFor } from "../run-script.ts";
import { stepLogLine } from "../test-gate.ts";
import type { RepairRequest } from "./index.ts";
import { pushRepair, repairRunner, runRepairSession, type RepairGit, type RepairRun } from "./run.ts";

/** Run the repair on the exact tested merge, and preserve it on the
 * source branch before asking the merge machinery to rebuild and test. */
export function testRepairSession(defaults: QueueDefaults, job: Job, scriptDir?: string, cancelled: () => boolean = () => false) {
  return async (request: RepairRequest): Promise<boolean> => {
    const { root, branch, verdict } = request;
    const { run, git } = repairRunner(job, root, cancelled, "test repair");
    const before = await git(["rev-parse", "HEAD"]);
    const source = await git(["rev-parse", `refs/remotes/origin/${branch}`]);
    if (before.code || source.code) return false;
    const sha = before.stdout.trim();
    if ((await git(["merge-base", "--is-ancestor", source.stdout.trim(), sha])).code) return false;
    const filesCommand = await testFilesCommand(run, root, scriptDir);
    if (!filesCommand) return false;
    const log = job.streamFile ? `${job.streamFile.replace(/\.stream\.jsonl$/, "")}.tests.log` : undefined;
    const model = repairModel(defaults, job, repairPrompt(request, sha, log));
    if (!model) return false;
    stepLogLine(job, `repairing the landing's failing tests on ${model.name} (${model.key}), tested commit ${sha}`);
    const result = await runRepairSession(defaults, job, run, model, "repair", "test repair");
    if (result.code || result.timedOut || repairSessionFailed(result.stdout)) return false;
    if ((await git(["rev-parse", "HEAD"])).stdout.trim() !== sha) return false;
    const files = await repairedFiles(git, root);
    if (!files) return false;
    // Independently check the named files; the model's report is not proof.
    const testFiles = [...new Set(verdict.failedTests!.map((test) => test.file))];
    const isolated = await run(["/bin/bash", "-c", `${filesCommand} "$@"`, "_", ...testFiles], 30 * 60_000);
    if (log) appendFileSync(log, `\n--- repaired test files ---\n${isolated.stdout}${isolated.stderr}`);
    if (isolated.code || isolated.timedOut) return false;
    if ((await git(["add", "--", ...files])).code) return false;
    if ((await git(["commit", "-qm", "Fix regressions found by the landing tests"])).code) return false;
    // No force: a concurrent source-branch update must refuse this push.
    const recovery = `refs/aide/landing-repairs/${job.id}`;
    if ((await git(["update-ref", recovery, "HEAD"])).code) return false;
    return pushRepair(git, job, branch, recovery, "test repair");
  };
}

/** The project's command for running named test files, or undefined
 *  when it has none. */
async function testFilesCommand(run: RepairRun, root: string, scriptDir: string | undefined): Promise<string | undefined> {
  const resolver = scriptFor("aide-resolve-test-cmd", { beside: scriptDir });
  const resolved = await run([resolver, "--project-dir", root], 60_000);
  try { return JSON.parse(resolved.stdout.trim().split("\n").at(-1) ?? "{}").filesCommand || undefined; } catch { return undefined; }
}

function repairPrompt({ root, branch, verdict }: RepairRequest, sha: string, log: string | undefined): string {
  return [
    `Make the failing tests pass on the tested merge ${sha} of branch ${branch}. Main alone passed, so the branch caused the failures.`,
    `Working directory: ${root}. Failing tests: ${JSON.stringify(verdict.failedTests)}.`,
    log && existsSync(log) ? `Read the complete test output at ${log}.` : `Test output: ${verdict.detail ?? ""}`,
    "Read the branch diff against origin's default branch to understand the change. Follow this project's instructions.",
    "Decide for each failing test which side is wrong. When the branch intentionally changed the behaviour, text or file layout the test expects, and its diff, documentation or own tests show the new behaviour, the test is out of date: update it to the branch's behaviour, keep the requirement it guards covered, and say what you changed and why. That is the expected fix, not weakening the test.",
    "When the branch broke behaviour it did not mean to change, fix the code instead.",
    "Never delete or skip a test, and never loosen an assertion so that a real defect passes. Keep edits scoped to the failure. Leave commits, pushes and branch selection to Merge.",
    "Run only the failed test files. The landing runs the project's configured tests after rebuilding.",
    "Leave the tree unchanged only when you cannot tell whether the branch meant to change the behaviour, and then say what is unclear.",
  ].join("\n");
}

/** The files the repair changed or added, outside the manifest and the
 *  worktree's links; undefined when it changed none, deleted one, or git
 *  could not say. */
async function repairedFiles(git: RepairGit, root: string): Promise<string[] | undefined> {
  const changed = await git(["diff", "--name-only", "HEAD"]);
  const untracked = await git(["ls-files", "--others", "--exclude-standard"]);
  const links = resolveWorktreeLinks(root).links.split(/[\s,]+/).filter(Boolean);
  const files = [...new Set(`${changed.stdout}\n${untracked.stdout}`.split("\n").filter((p) => p && p !== ".aide/project.yaml" && !links.some((link) => p === link || p.startsWith(`${link}/`))))];
  if (changed.code || untracked.code || !files.length) return undefined;
  if ((await git(["diff", "--name-only", "--diff-filter=D", "HEAD"])).stdout.trim()) return undefined;
  return files;
}
