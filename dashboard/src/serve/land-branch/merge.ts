// The landing every self-landing step shares: merge a step's own
// branch into the default branch of every repo it pushed to, and
// report per repo.

import { realPathOrOriginal as real } from "../../git/real-path.ts";

/** Whether two paths name the same directory, whatever each side spells
 *  it. `aide-run-spec` reports the root git gave it, and git resolves
 *  symlinks; the dashboard holds the path it was configured with. On
 *  macOS a checkout under `$TMPDIR` is `/var/folders/...` to one and
 *  `/private/var/folders/...` to the other, so a plain string comparison
 *  said they were different repositories — and the code root nobody
 *  recognised got no test gate, no code-first ordering and no PR-mode
 *  exception. A suite that was red on the merge landed on main that way.
 *
 *  A path that cannot be resolved — a checkout removed under us —
 *  answers as itself rather than throwing, so the comparison is then
 *  exactly the string one it replaces. */
export function sameRoot(a: string, b: string): boolean {
  return a === b || real(a) === real(b);
}
import type { Job } from "../../queue/queue.ts";
import type { StepOutcome } from "../../queue/runner";
import { formatSentence } from "../../messages/format.ts";
import type { RepoMergeResult } from "../../git/branch-merge/index.ts";
import { installCheckout } from "../deployment";
import { rememberMergedUnderRoots, rememberUnderRoots } from "./handed-to-merge.ts";
import { isDashboardRoot } from "../deployment";
import type { LandContext, Landing } from "./types.ts";
import { landingPolicy } from "./policy/index.ts";
import { emptyTally, landingPlan, type LandingRun } from "./merge-steps/run.ts";
import { mergeRepo } from "./merge-steps/repo.ts";
import { checkOrigin } from "./merge-steps/origin-check.ts";
import { recordLanded, recordLandingFailure, recordLandingThrew } from "./merge-steps/settle.ts";

export { pickRefusal } from "./merge-steps/repo.ts";

/** Merge a step's own branch into the default branch of every repo it
 *  pushed to, and report per repo — the landing every self-landing
 *  step shares.
 *
 *  The branch and, by default, the repos come from the RESULT, never
 *  from `specBranch(...)` or `queue.branchesFor(...)`. Two reasons,
 *  one per caller: a create step's folder did not exist when its
 *  branch was named, and `onStepDone` runs SYNCHRONOUSLY inside
 *  `complete()`, before the runner has written this step's own
 *  `branchUrls` into the store — so a spec whose first-ever queue job
 *  is the one landing would find that history empty. The outcome in
 *  hand has neither problem. Archive is the one caller that has to
 *  look further, and says so itself (`what.repos`).
 *
 *  Every merge goes through `mergeLock`, one repo at a time. Four
 *  steps land themselves now, and two specs sharing one specs repo can
 *  finish within seconds of each other under queue concurrency — which
 *  is the collision the lock exists to serialize. `create` is inside
 *  it too: outside it would be survivable only while self-landings
 *  were rare.
 *
 *  Plan first, code last, for the same reason the manual route sorted
 *  them: a run records the project before its specs root, so a reader
 *  watching the page saw the code land before the plan describing it,
 *  and the code is the one that matters. */
export async function landBranch(
  ctx: LandContext,
  job: Job,
  outcome: Partial<StepOutcome>,
  what: Landing,
): Promise<void> {
  if (ctx.beforeLanding && !(await ctx.beforeLanding(job))) return;
  try {
    const branch = outcome.branch;
    const codeRoot = ctx.machineryProjectDir(job.project);
    const codeRoots = { has: (root: string) => sameRoot(root, codeRoot) };
    const plan = landingPlan(ctx, job, landingPolicy(what.step), codeRoots, what.repos ?? outcome.branchUrls ?? []);
    if (!branch || plan.repos.length === 0) {
      if (what.nothingToLand) ctx.queue.update(job.id, { error: what.nothingToLand });
      return;
    }
    const run: LandingRun = { ctx, job, outcome, what, branch, plan, tally: emptyTally() };
    if (!(await mergeRepos(run))) return;
    await checkOrigin(run);
    if (run.tally.failures.length > 0) {
      recordLandingFailure(run);
      return;
    }
    await recordLanded(run);
  } catch (err) {
    recordLandingThrew(ctx, job, what, err);
  }
}

/** Every repo in landing order, one at a time; false when the landing
 *  was cancelled under a merge and nothing more is to be written. */
async function mergeRepos(run: LandingRun): Promise<boolean> {
  for (const repo of run.plan.repos) {
    const step = await mergeRepo(run, repo);
    if (step === "cancelled") return false;
    if (step === "stop") break;
    if (step === "next") continue;
    await repoLanded(run, repo, step.merged, !!step.handed.specOnly);
  }
  return true;
}

/** One repo merged: the caches it corrects, the install it owes, and
 *  the branch delete that may have failed after it. */
async function repoLanded(run: LandingRun, repo: { root: string }, result: RepoMergeResult, specOnly: boolean): Promise<void> {
  const { ctx, job, what, branch } = run;
  // The real folder name, reported by the finalize step
  // that just ran under this repo's own merge — never guessed
  // from `outcome`, which still carries the provisional key a
  // create step wrote its files under.
  if (result.assignedSpecFolder) what.landed = { ...what.landed, specFolder: result.assignedSpecFolder };
  ctx.branchStatus.invalidate(repo.root, branch);
  // The open-branch cache is the other half of the same
  // correction, and it is what the archived row reads. The branch
  // was forgotten before the checkout moved (`handed-to-merge.ts`);
  // a branch still on origin because its delete failed IS open,
  // so it is taken back here, and the sentence for that
  // case is written from `deleteErrors` below.
  if (result.branchDeleteError) rememberUnderRoots(ctx, job.project, repo.root, branch);
  // Merged, so only a cleanup is left — never for a close's discarded
  // branch or a folder copied alone, whose branch did not merge.
  if (result.branchDeleteError && !result.discarded && !specOnly) {
    rememberMergedUnderRoots(ctx, job.project, repo.root, branch);
  }
  // A discarded root never merged anything — nothing to
  // install. The step below is `mergeBranchIntoDefault`'s own
  // success handling, which `deleteBranchOnly` never earns.
  if (!result.discarded) await installLanded(run, repo, result);
  if (result.branchDeleteError) recordDeleteError(run, repo.root, result);
}

/** Merged is not deployed. For a tool that lives in `~/.local/bin`, the
 *  code landing on the default branch changes nothing on the machine
 *  until it is installed — which is why merged code can keep running as
 *  the old version. The install belongs to the project, so the project
 *  says what it is. */
async function installLanded(run: LandingRun, repo: { root: string }, result: RepoMergeResult): Promise<void> {
  const { ctx, job, plan } = run;
  if (!plan.codeRoots.has(repo.root)) return;
  // A landing never restarts the dashboard (a restart kills every
  // job's process), and in its own checkout never installs either:
  // a runner newer than the served page refuses its calls. Deploy
  // installs and restarts together, when the person chooses.
  if (!isDashboardRoot(ctx, repo.root)) {
    const installed = await installCheckout(repo.root, ctx.queueInstallTimeoutMs);
    if (!installed.ok) {
      result.installError = installed.error;
      result.installDetail = installed.detail;
    }
  }
  else console.error(
    `queue: a code change landed in the dashboard's own checkout (${repo.root}) — the served page and the installed scripts still run the older code; install and restart it with Deploy when it suits`,
  );
  // Never fatal, and never silent either: the merge already
  // happened, so this is reported beside it rather than
  // turning a successful merge into a failure. A server log has
  // no reader whose `lang` could apply; English is the source
  // language throughout this catalog (Recommended solution,
  // Storage, point 3).
  if (result.installError) {
    console.error(
      `queue: landing ${job.project}/${job.specFolder} in ${repo.root} — ${formatSentence("en", result.installError)}`,
    );
  }
}

function recordDeleteError(run: LandingRun, root: string, result: RepoMergeResult): void {
  const { job, tally } = run;
  const del = result.branchDeleteError!;
  console.error(
    `queue: landing ${job.project}/${job.specFolder} in ${root} — ${formatSentence("en", del)}`,
  );
  tally.leftBehindRoots.add(root);
  // The ROOT is folded into the message's own template here —
  // this is the one place that knows whether several repos are
  // being reported at once. `git/branch-merge/` always
  // composes this as a `BoardMessage`, never a plain string.
  tally.deleteErrors.push(
    typeof del === "object"
      ? {
          key: result.detail ? ("landing.branchDeleteFailedWhy" as const) : del.key,
          values: { ...del.values, root, ...(result.detail ? { detail: result.detail } : {}) },
        }
      : del,
  );
}
