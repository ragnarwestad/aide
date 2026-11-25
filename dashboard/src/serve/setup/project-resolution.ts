// Resolving what a project's specs and checkouts actually are: the
// dashboard's own checkout of it, the machinery/person checkout split,
// and every spec-lookup question built off `targets()`.
//
// Checkout and spec-lookup are ONE stage, not two, because they are
// mutually referential: `projectCheckoutCtx.targets` is spec-lookup's
// own `targets()`, and `specLookupCtx.machineryProjectDir` is
// checkout's. Keeping both halves in one function scope lets the same
// hoisting trick `createServer` used to rely on directly keep working
// here, rather than inventing a forward-reference box for a cycle that
// is entirely local to this one concern.

import type { BranchFileStepsChecker } from "../../git/workflow-history.ts";
import {
  BranchStatusChecker,
} from "../../git/branch-status.ts";
import { createGitRunner, type GitRunner } from "../../git/process/index.ts";
import {
  DEFAULT_DASHBOARD_CHECKOUT_ROOT,
  ensureDashboardCheckout,
  type DashboardCheckout,
} from "../../git/dashboard-checkout/index.ts";
import { CheckoutEnsurer } from "../../git/checkout-ensurer.ts";
import type { Job } from "../../queue/queue.ts";
import {
  displayProjectDir as displayProjectDirImpl,
  machineryProjectDir as machineryProjectDirImpl,
  codeLanding as codeLandingImpl,
  promptFileFor as promptFileForImpl,
  chromeFor as chromeForImpl,
  noSandboxFor as noSandboxForImpl,
  ownedSpecsRoot as ownedSpecsRootImpl,
  machinerySpecsRoot as machinerySpecsRootImpl,
  complain as complainImpl,
  type ProjectCheckoutContext,
} from "../project-checkout.ts";
import {
  targets as targetsImpl,
  specRoots as specRootsImpl,
  rootsStillHolding as rootsStillHoldingImpl,
  peekUnlanded as peekUnlandedImpl,
  peekUnlandedCheckedAt as peekUnlandedCheckedAtImpl,
  peekMergedOnOrigin as peekMergedOnOriginImpl,
  specDir as specDirImpl,
  specRef as specRefImpl,
  specsRoot as specsRootImpl,
  machinerySpecDir as machinerySpecDirImpl,
  peekMachinerySpecDir as peekMachinerySpecDirImpl,
  type SpecLookupContext,
} from "../spec-lookup/index.ts";
import type { ServerState } from "../state.ts";
import type { ScheduleStore } from "../../queue/schedule-store.ts";
import { clearCheckoutFault } from "../../render/ui/checkout-faults.ts";

export interface ProjectResolutionOptions {
  queueProjectRoot?: string;
  dashboardCheckoutRoot?: string;
  gitRun?: GitRunner;
  projectRoot?: string;
}

/** Two resolutions, and every caller picks one
 *  deliberately. `displayProjectDir` is the checkout a PERSON edits —
 *  what the spec list, the project pages and the manifests are read
 *  from, and the only thing it is ever used for. Nothing here writes to
 *  it: a run that branched, merged and pushed from the directory
 *  somebody was working in is what stranded three specs' code. */
export function setupProjectResolution(
  opts: ProjectResolutionOptions,
  allowed: Set<string>,
  state: ServerState,
  scheduleStore: ScheduleStore,
) {
  const projectCheckoutCtx = projectCheckoutContext(opts, state, scheduleStore, targets);
  const { complain, ...checkouts } = checkoutQuestions(projectCheckoutCtx, state);
  // One runner, two users now: the read path asks whether a branch
  // landed, the write path lands it.
  const gitRun: GitRunner = opts.gitRun ?? createGitRunner();
  const branchStatus = new BranchStatusChecker({ run: gitRun });
  const checkoutEnsurer = dashboardCheckoutEnsurer(projectCheckoutCtx, gitRun, checkouts.displayProjectDir, complain);
  const ensureCheckout = ensureCheckoutWith(checkoutEnsurer);

  // Attached by `createServer` once the schedules exist (they need
  // `targets`, which needs this context — hence late-bound).
  let branchFileSteps: BranchFileStepsChecker | undefined;
  const specLookupCtx: SpecLookupContext = {
    machineryProjectDir: checkouts.machineryProjectDir,
    machinerySpecsRoot: checkouts.machinerySpecsRoot,
    branchStatus,
    codeLanding: checkouts.codeLanding,
    targets,
    readScan: () => state.scan,
    readBranchFileSteps: () => branchFileSteps,
    writeScan: (s) => {
      state.scan = s;
    },
    projectRoot: opts.projectRoot,
    allowed,
    ownedSpecsRoot: checkouts.ownedSpecsRoot,
    gitRun,
    resolvedCheckouts: projectCheckoutCtx.resolvedCheckouts,
    ensureCheckout,
    pullRequests: state.pullRequests,
  };
  function targets() {
    return targetsImpl(specLookupCtx);
  }

  return {
    attachBranchFileSteps: (checker: BranchFileStepsChecker) => {
      branchFileSteps = checker;
    },
    checkoutEnsurer, ensureCheckout, gitRun, branchStatus,
    ...checkouts,
    targets, ...specQuestions(specLookupCtx, state),
  };
}

function projectCheckoutContext(
  opts: ProjectResolutionOptions,
  state: ServerState,
  scheduleStore: ScheduleStore,
  targets: ProjectCheckoutContext["targets"],
): ProjectCheckoutContext {
  return {
    queueProjectRoot: opts.queueProjectRoot,
    scheduleStore,
    // Where the dashboard's OWN clones live. Named as an option so a test
    // can put them in a temp directory; there is no other reason to move
    // them.
    checkoutBase: opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT,
    /** What `ensureCheckout` last worked out, so the SYNC readers can ask
     *  where a project's own specs are without awaiting a clone. Empty
     *  until the first ensure settles, which is what the fallback below is
     *  for. */
    resolvedCheckouts: new Map<string, DashboardCheckout>(),
    /** The last thing said about each project, so a refusal that has not
     *  changed is not said again. Every tick asks, and a project whose
     *  origin is unreachable would otherwise fill the log with one line
     *  every two seconds for as long as the server runs. */
    saidAbout: new Map<string, string>(),
    targets,
    readScan: () => state.scan,
  };
}

/** The questions about a project's checkouts, each bound to `ctx`. */
function checkoutQuestions(ctx: ProjectCheckoutContext, state: ServerState) {
  return {
    displayProjectDir: (project: string) => displayProjectDirImpl(ctx, project),
    machineryProjectDir: (project: string) => machineryProjectDirImpl(ctx, project),
    codeLanding: (project: string) => codeLandingImpl(ctx, project),
    promptFileFor: (job: Job, step: string) => promptFileForImpl(ctx, job, step),
    chromeFor: (job: Job, step: string) => chromeForImpl(ctx, job, step),
    noSandboxFor: (job: Job, step: string) => noSandboxForImpl(ctx, job, step),
    ownedSpecsRoot: (project: string) => ownedSpecsRootImpl(ctx, project),
    machinerySpecsRoot: (project: string) => machinerySpecsRootImpl(ctx, project),
    complain: (project: string, said: string, banner = true, more?: Parameters<typeof complainImpl>[4]) => {
      if (state.stopped) return;
      return complainImpl(ctx, project, said, banner, more);
    },
  };
}

type Complain = ReturnType<typeof checkoutQuestions>["complain"];

function dashboardCheckoutEnsurer(
  ctx: ProjectCheckoutContext,
  gitRun: GitRunner,
  displayProjectDir: (project: string) => string,
  complain: Complain,
): CheckoutEnsurer {
  return new CheckoutEnsurer((project, mayClone) =>
    ensureDashboardCheckout(gitRun, {
      base: ctx.checkoutBase,
      project,
      personDir: displayProjectDir(project),
      mayClone,
    })
      .then((result) => {
        if (result.ok) {
          ctx.saidAbout.delete(project);
          clearCheckoutFault(project);
        } else {
          complain(project, result.error ?? "it could not be made", !result.absent, {
            recheck: result.inconclusive === true,
            detail: result.detail,
          });
        }
        if (result.checkout) ctx.resolvedCheckouts.set(project, result.checkout);
        return result.checkout;
      })
      .catch((err) => {
        complain(project, String(err));
        return undefined;
      }),
  );
}

/** Make the dashboard's own checkout if it is not there, and answer
 *  where it is. One promise per project at a time: two requests
 *  arriving together must not run two `git clone`s into one directory.
 *
 *  A project whose clone CANNOT be made — no origin, an unreachable
 *  one — answers `undefined`, and every caller falls back to the
 *  checkout it used before this spec. */
function ensureCheckoutWith(checkoutEnsurer: CheckoutEnsurer) {
  return (
    project: string,
    opts?: { fresh?: boolean; clone?: boolean },
  ): Promise<DashboardCheckout | undefined> => {
    // `clone` is a press's, never a tick's: see `EnsureRequest.mayClone`.
    if (opts?.clone) return checkoutEnsurer.make(project);
    return opts?.fresh ? checkoutEnsurer.fresh(project) : checkoutEnsurer.get(project);
  };
}

/** The spec-lookup questions, each bound to `ctx`. */
function specQuestions(ctx: SpecLookupContext, state: ServerState) {
  return {
    specRoots: (project: string) => specRootsImpl(ctx, project),
    rootsStillHolding: (project: string, branch: string, fresh: boolean) => rootsStillHoldingImpl(ctx, project, branch, fresh),
    peekUnlanded: (): string[] => {
      const result = peekUnlandedImpl(ctx);
      state.unlanded = result.unlanded;
      state.prOpen = result.prOpen;
      return state.unlanded;
    },
    peekUnlandedCheckedAt: () => peekUnlandedCheckedAtImpl(ctx),
    peekMergedOnOrigin: (project: string, folder: string) => peekMergedOnOriginImpl(ctx, project, folder),
    specDir: (project: string, specFolder: string) => specDirImpl(ctx, project, specFolder),
    specRef: (project: string, specFolder: string) => specRefImpl(ctx, project, specFolder),
    specsRoot: (dir: string) => specsRootImpl(ctx, dir),
    machinerySpecDir: (project: string, dir: string) => machinerySpecDirImpl(ctx, project, dir),
    peekMachinerySpecDir: (project: string, dir: string) => peekMachinerySpecDirImpl(ctx, project, dir),
  };
}
