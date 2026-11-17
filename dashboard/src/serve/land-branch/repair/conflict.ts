import { appendFileSync } from "node:fs";
import type { Job, QueueDefaults } from "../../../queue/queue.ts";
import type { MergeHooks } from "../../../git/merge-hooks.ts";
import { runScript } from "../run-script.ts";
import { stepLogLine } from "../test-gate.ts";
import { repairModel } from "./model.ts";

type Conflict = Parameters<NonNullable<MergeHooks["repairConflict"]>>[0];

/** The AI resolves files only; the wrapper verifies and saves the merge on the source branch. */
export function conflictRepairSession(defaults: QueueDefaults, job: Job, cancelled: () => boolean = () => false) {
  return async ({ work, branch, base, files }: Conflict): Promise<boolean> => {
    const decline = (reason: string): false => {
      stepLogLine(job, `automatic conflict repair stopped: ${reason}`, true);
      return false;
    };
    const run = (argv: string[], limit = 60_000, env: Record<string, string> = {}) => {
      if (cancelled()) throw new Error("conflict repair cancelled");
      return runScript(argv, work, limit, job.id, env);
    };
    const git = (args: string[]) => run(["git", "-c", "core.hooksPath=/dev/null", ...args]);
    const head = await git(["rev-parse", "HEAD"]);
    const merge = await git(["rev-parse", "MERGE_HEAD"]);
    const source = await git(["rev-parse", `refs/remotes/origin/${branch}`]);
    if (!files.length || branch === base || head.code || merge.code || source.code || merge.stdout.trim() !== source.stdout.trim()) return decline("the open merge no longer matches the source branch");
    const outsideArgs = ["diff", "--binary", "HEAD", "--", ".", ...files.map((file) => `:(top,exclude,literal)${file}`)];
    const stagedOutsideArgs = ["diff", "--cached", ...outsideArgs.slice(1)];
    const outside = await git(outsideArgs);
    const stagedOutside = await git(stagedOutsideArgs);
    const untracked = await git(["ls-files", "--others"]);
    if (outside.code || stagedOutside.code || untracked.code) return decline("git could not inspect the files outside the conflict");
    const prompt = [
      `Resolve the merge conflicts between branch ${branch} (${merge.stdout.trim()}) and ${base} (${head.stdout.trim()}).`,
      `Working directory: ${work}. Conflicted files: ${JSON.stringify(files)}. The merge is already open.`,
      "Read the project's instructions and both sides of the merge. Preserve the intended behavior of both branches.",
      "Edit only the conflicted files. Do not modify other files, create files, commit, push, switch branches, abort the merge or change HEAD or MERGE_HEAD.",
      "Do not run the full test suite. The landing rebuilds the merge and runs the project's configured tests before pushing main.",
      "If the conflict cannot be safely resolved, leave it unresolved and explain why.",
    ].join("\n");
    const model = repairModel(defaults, job, prompt);
    if (!model) { stepLogLine(job, "automatic conflict repair has no available model", true); return false; }
    stepLogLine(job, `resolving merge conflicts in ${files.join(", ")} on ${model.name} (${model.key})`);
    const result = await run(model.argv, (defaults.timeoutSec.implement ?? defaults.timeoutSec.default ?? 1200) * 1000, model.env);
    if (job.streamFile) {
      const transcript = `${job.streamFile}.conflict-repair.jsonl`;
      appendFileSync(transcript, result.stdout);
      stepLogLine(job, `conflict repair transcript: ${transcript}`);
    }
    stepLogLine(job, `conflict repair session ended (exit ${result.code})${result.stderr ? `: ${result.stderr.slice(-400)}` : ""}`, result.code !== 0);
    if (result.code || result.timedOut || /"(?:type|subtype)"\s*:\s*"(?:turn.failed|error[^"]*)"|"is_error"\s*:\s*true/.test(result.stdout)) return decline("the AI session failed or reached its time limit");
    const after = await git(["rev-parse", "HEAD"]);
    const afterMerge = await git(["rev-parse", "MERGE_HEAD"]);
    const afterOutside = await git(outsideArgs);
    const afterStagedOutside = await git(stagedOutsideArgs);
    const afterUntracked = await git(["ls-files", "--others"]);
    if (after.code || afterMerge.code || afterOutside.code || afterStagedOutside.code || afterUntracked.code || after.stdout !== head.stdout || afterMerge.stdout !== merge.stdout ||
      afterOutside.stdout !== outside.stdout || afterStagedOutside.stdout !== stagedOutside.stdout || afterUntracked.stdout !== untracked.stdout) return decline("the repair changed merge identity or files outside the conflict");
    if ((await git(["add", "--", ...files])).code) return decline("git could not stage the resolved files");
    const unresolved = await git(["diff", "--name-only", "--diff-filter=U"]);
    if (unresolved.code || unresolved.stdout.trim() || (await git(["diff", "--check", "HEAD"])).code) return decline("the resolution still has conflicts, conflict markers or whitespace errors");
    const committed = await git(["commit", "-qm", `Resolve merge conflicts with ${base}`]);
    if (committed.code) return decline(`git could not commit the resolution: ${committed.stderr.slice(-400)}`);
    if ((await git(["merge-base", "--is-ancestor", source.stdout.trim(), "HEAD"])).code) return decline("the resolved merge does not contain the source commit");
    const recovery = `refs/aide/landing-repairs/${job.id}`;
    if ((await git(["update-ref", recovery, "HEAD"])).code) return decline("git could not preserve a recovery ref");
    const pushed = await git(["push", "origin", `HEAD:refs/heads/${branch}`]);
    if (pushed.code) stepLogLine(job, `could not save the conflict resolution on ${branch}: ${pushed.stderr.slice(-400)}`, true);
    else {
      await git(["update-ref", "-d", recovery]);
      stepLogLine(job, `conflict resolution saved on ${branch}; rebuilding the merge and running tests`);
    }
    return pushed.code === 0;
  };
}
