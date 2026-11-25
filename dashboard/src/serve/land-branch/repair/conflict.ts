import type { Job, QueueDefaults } from "../../../queue/queue.ts";
import type { MergeHooks } from "../../../git/merge-hooks.ts";
import { stepLogLine } from "../test-gate.ts";
import { repairModel, repairSessionFailed } from "./model.ts";
import { pushRepair, repairRunner, runRepairSession, type RepairGit } from "./run.ts";

type Conflict = Parameters<NonNullable<MergeHooks["repairConflict"]>>[0];
type Decline = (reason: string) => false;

/** The AI resolves files only; the wrapper verifies and saves the merge on the source branch. */
export function conflictRepairSession(defaults: QueueDefaults, job: Job, cancelled: () => boolean = () => false) {
  return async ({ work, branch, base, files }: Conflict): Promise<boolean> => {
    const decline: Decline = (reason) => {
      stepLogLine(job, `automatic conflict repair stopped: ${reason}`, true);
      return false;
    };
    const { run, git } = repairRunner(job, work, cancelled, "conflict repair");
    const head = await git(["rev-parse", "HEAD"]);
    const merge = await git(["rev-parse", "MERGE_HEAD"]);
    const source = await git(["rev-parse", `refs/remotes/origin/${branch}`]);
    if (!files.length || branch === base || head.code || merge.code || source.code || merge.stdout.trim() !== source.stdout.trim()) return decline("the open merge no longer matches the source branch");
    const outside = await outsideConflict(git, files);
    if (!outside) return decline("git could not inspect the files outside the conflict");
    const model = repairModel(defaults, job, conflictPrompt(work, branch, base, files, merge.stdout.trim(), head.stdout.trim()));
    if (!model) { stepLogLine(job, "automatic conflict repair has no available model", true); return false; }
    stepLogLine(job, `resolving merge conflicts in ${files.join(", ")} on ${model.name} (${model.key})`);
    const result = await runRepairSession(defaults, job, run, model, "conflict-repair", "conflict repair");
    if (result.code || result.timedOut || repairSessionFailed(result.stdout)) return decline("the AI session failed or reached its time limit");
    const after = await git(["rev-parse", "HEAD"]);
    const afterMerge = await git(["rev-parse", "MERGE_HEAD"]);
    const afterOutside = await outsideConflict(git, files);
    if (!afterOutside || after.code || afterMerge.code || after.stdout !== head.stdout || afterMerge.stdout !== merge.stdout ||
      afterOutside.some((text, i) => text !== outside[i])) return decline("the repair changed merge identity or files outside the conflict");
    return saveResolution(git, job, { branch, base, files, source: source.stdout.trim() }, decline);
  };
}

/** What lies outside the conflicted files — unstaged, staged and
 *  untracked — or undefined when git could not say. */
async function outsideConflict(git: RepairGit, files: string[]): Promise<string[] | undefined> {
  const outsideArgs = ["diff", "--binary", "HEAD", "--", ".", ...files.map((file) => `:(top,exclude,literal)${file}`)];
  const outside = await git(outsideArgs);
  const stagedOutside = await git(["diff", "--cached", ...outsideArgs.slice(1)]);
  const untracked = await git(["ls-files", "--others"]);
  if (outside.code || stagedOutside.code || untracked.code) return undefined;
  return [outside.stdout, stagedOutside.stdout, untracked.stdout];
}

function conflictPrompt(work: string, branch: string, base: string, files: string[], mergeSha: string, headSha: string): string {
  return [
    `Resolve the merge conflicts between branch ${branch} (${mergeSha}) and ${base} (${headSha}).`,
    `Working directory: ${work}. Conflicted files: ${JSON.stringify(files)}. The merge is already open.`,
    "Read the project's instructions and both sides of the merge. Preserve the intended behavior of both branches.",
    "Edit only the conflicted files. Do not modify other files, create files, commit, push, switch branches, abort the merge or change HEAD or MERGE_HEAD.",
    "Do not run the full test suite. The landing rebuilds the merge and runs the project's configured tests before pushing main.",
    "If the conflict cannot be safely resolved, leave it unresolved and explain why.",
  ].join("\n");
}

/** Commit the resolved files, check the result still carries the source
 *  commit, and save it on the source branch. */
async function saveResolution(
  git: RepairGit,
  job: Job,
  { branch, base, files, source }: { branch: string; base: string; files: string[]; source: string },
  decline: Decline,
): Promise<boolean> {
  if ((await git(["add", "--", ...files])).code) return decline("git could not stage the resolved files");
  const unresolved = await git(["diff", "--name-only", "--diff-filter=U"]);
  if (unresolved.code || unresolved.stdout.trim() || (await git(["diff", "--check", "HEAD"])).code) return decline("the resolution still has conflicts, conflict markers or whitespace errors");
  const committed = await git(["commit", "-qm", `Resolve merge conflicts with ${base}`]);
  if (committed.code) return decline(`git could not commit the resolution: ${committed.stderr.slice(-400)}`);
  if ((await git(["merge-base", "--is-ancestor", source, "HEAD"])).code) return decline("the resolved merge does not contain the source commit");
  const recovery = `refs/aide/landing-repairs/${job.id}`;
  if ((await git(["update-ref", recovery, "HEAD"])).code) return decline("git could not preserve a recovery ref");
  if (!(await pushRepair(git, job, branch, recovery, "conflict resolution"))) return false;
  stepLogLine(job, `conflict resolution saved on ${branch}; rebuilding the merge and running tests`);
  return true;
}
