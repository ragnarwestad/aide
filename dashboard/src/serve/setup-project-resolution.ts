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

import type { BranchFileStepsChecker } from "../git/workflow-history.ts";
import {
  BranchStatusChecker, createGitRunner, type GitRunner,
} from "../git/branch-status.ts";
import {
  CheckoutEnsurer,
  DEFAULT_DASHBOARD_CHECKOUT_ROOT,
  ensureDashboardCheckout,
  type DashboardCheckout,
} from "../git/dashboard-checkout.ts";
import type { Job } from "../queue/queue.ts";
import {
  displayProjectDir as displayProjectDirImpl,
  machineryProjectDir as machineryProjectDirImpl,
  codeLanding as codeLandingImpl,
  promptFileFor as promptFileForImpl,
  ownedSpecsRoot as ownedSpecsRootImpl,
  machinerySpecsRoot as machinerySpecsRootImpl,
  complain as complainImpl,
  type ProjectCheckoutContext,
} from "./project-checkout.ts";
import {
  targets as targetsImpl,
  specRoots as specRootsImpl,
  rootsStillHolding as rootsStillHoldingImpl,
  peekUnlanded as peekUnlandedImpl,
  peekUnlandedCheckedAt as peekUnlandedCheckedAtImpl,
  specDir as specDirImpl,
  specRef as specRefImpl,
  dependencyFolders as dependencyFoldersImpl,
  specsRoot as specsRootImpl,
  machinerySpecDir as machinerySpecDirImpl,
  peekMachinerySpecDir as peekMachinerySpecDirImpl,
  type SpecLookupContext,
} from "./spec-lookup.ts";
import type { ServerState } from "./state.ts";

export interface ProjectResolutionOptions {
  queueProjectRoot?: string;
  dashboardCheckoutRoot?: string;
  gitRun?: GitRunner;
  projectRoot?: string;
}

export function setupProjectResolution(opts: ProjectResolutionOptions, allowed: Set<string>, state: ServerState) {
  // Two resolutions since spec 205, and every caller picks one
  // deliberately. `displayProjectDir` is the checkout a PERSON edits —
  // what the spec list, the project pages and the manifests are read
  // from, and the only thing it is ever used for. Nothing here writes to
  // it: a run that branched, merged and pushed from the directory
  // somebody was working in is what stranded three specs' code on
  // 2026-08-23.
  // Where the dashboard's OWN clones live. Named as an option so a test
  // can put them in a temp directory; there is no other reason to move
  // them.
  const checkoutBase = opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT;
  /** What `ensureCheckout` last worked out, so the SYNC readers can ask
   *  where a project's own specs are without awaiting a clone. Empty
   *  until the first ensure settles, which is what the fallback below is
   *  for. */
  const resolvedCheckouts = new Map<string, DashboardCheckout>();
  /** The last thing said about each project, so a refusal that has not
   *  changed is not said again. Every tick asks, and a project whose
   *  origin is unreachable would otherwise fill the log with one line
   *  every two seconds for as long as the server runs. */
  const saidAbout = new Map<string, string>();

  const projectCheckoutCtx: ProjectCheckoutContext = {
    queueProjectRoot: opts.queueProjectRoot,
    checkoutBase,
    resolvedCheckouts,
    saidAbout,
    targets,
    readScan: () => state.scan,
  };
  function displayProjectDir(project: string) {
    return displayProjectDirImpl(projectCheckoutCtx, project);
  }
  function machineryProjectDir(project: string) {
    return machineryProjectDirImpl(projectCheckoutCtx, project);
  }
  function codeLanding(project: string) {
    return codeLandingImpl(projectCheckoutCtx, project);
  }
  function promptFileFor(job: Job, step: string) {
    return promptFileForImpl(projectCheckoutCtx, job, step);
  }
  function ownedSpecsRoot(project: string) {
    return ownedSpecsRootImpl(projectCheckoutCtx, project);
  }
  function machinerySpecsRoot(project: string) {
    return machinerySpecsRootImpl(projectCheckoutCtx, project);
  }
  function complain(project: string, said: string) {
    return complainImpl(projectCheckoutCtx, project, said);
  }
  const checkoutEnsurer = new CheckoutEnsurer((project) =>
    ensureDashboardCheckout(gitRun, {
      base: checkoutBase,
      project,
      personDir: displayProjectDir(project),
    })
      .then((result) => {
        if (result.ok) saidAbout.delete(project);
        else complain(project, result.error ?? "it could not be made");
        if (result.checkout) resolvedCheckouts.set(project, result.checkout);
        return result.checkout;
      })
      .catch((err) => {
        complain(project, String(err));
        return undefined;
      }),
  );
  /** Make the dashboard's own checkout if it is not there, and answer
   *  where it is. One promise per project at a time: two requests
   *  arriving together must not run two `git clone`s into one directory.
   *
   *  A project whose clone CANNOT be made — no origin, an unreachable
   *  one — answers `undefined`, and every caller falls back to the
   *  checkout it used before this spec. */
  const ensureCheckout = (project: string): Promise<DashboardCheckout | undefined> => checkoutEnsurer.get(project);
  // One runner, two users now: the read path asks whether a branch
  // landed, the write path lands it.
  const gitRun: GitRunner = opts.gitRun ?? createGitRunner();
  const branchStatus = new BranchStatusChecker({ run: gitRun });

  // Attached by `createServer` once the schedules exist (they need
  // `targets`, which needs this context — hence late-bound).
  let branchFileSteps: BranchFileStepsChecker | undefined;
  const specLookupCtx: SpecLookupContext = {
    machineryProjectDir,
    machinerySpecsRoot,
    branchStatus,
    codeLanding,
    targets,
    readScan: () => state.scan,
    readBranchFileSteps: () => branchFileSteps,
    writeScan: (s) => {
      state.scan = s;
    },
    projectRoot: opts.projectRoot,
    allowed,
    ownedSpecsRoot,
    gitRun,
    resolvedCheckouts,
    ensureCheckout,
  };
  function targets() {
    return targetsImpl(specLookupCtx);
  }
  function specRoots(project: string) {
    return specRootsImpl(specLookupCtx, project);
  }
  function rootsStillHolding(project: string, branch: string, fresh: boolean) {
    return rootsStillHoldingImpl(specLookupCtx, project, branch, fresh);
  }
  function peekUnlanded(): string[] {
    const result = peekUnlandedImpl(specLookupCtx);
    state.unlanded = result.unlanded;
    state.prOpen = result.prOpen;
    return state.unlanded;
  }
  function peekUnlandedCheckedAt() {
    return peekUnlandedCheckedAtImpl(specLookupCtx);
  }
  function specDir(project: string, specFolder: string) {
    return specDirImpl(specLookupCtx, project, specFolder);
  }
  function specRef(project: string, specFolder: string) {
    return specRefImpl(specLookupCtx, project, specFolder);
  }
  function dependencyFolders(project: string, dir: string) {
    return dependencyFoldersImpl(specLookupCtx, project, dir);
  }
  function specsRoot(dir: string) {
    return specsRootImpl(specLookupCtx, dir);
  }
  function machinerySpecDir(project: string, dir: string) {
    return machinerySpecDirImpl(specLookupCtx, project, dir);
  }
  function peekMachinerySpecDir(project: string, dir: string) {
    return peekMachinerySpecDirImpl(specLookupCtx, project, dir);
  }

  return {
    attachBranchFileSteps: (checker: BranchFileStepsChecker) => {
      branchFileSteps = checker;
    },
    checkoutEnsurer, ensureCheckout, gitRun, branchStatus,
    displayProjectDir, machineryProjectDir, codeLanding, promptFileFor, ownedSpecsRoot, machinerySpecsRoot,
    targets, specRoots, rootsStillHolding, peekUnlanded, peekUnlandedCheckedAt,
    specDir, specRef, dependencyFolders, specsRoot, machinerySpecDir, peekMachinerySpecDir,
  };
}
