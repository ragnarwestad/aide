// Landing a step's own branch into the default branch of every repo it
// pushed to (specs 93, 136, 149) — pulled out of `createServer`'s
// closure the same way `handleRoutes` and the spec-view builders were
// (spec: split serve.ts, step 4). Split by theme into land-branch/
// (split land-branch.ts by theme): types.ts (LandContext, the Landing
// description), install.ts (installAfterMerge), merge.ts
// (landBranch itself), steps.ts (the four per-step Landing
// descriptions) and freshness.ts (withFreshness, specs 97/154). Kept
// as a barrel at this path because setup/land.ts imports from it.

export type { LandContext } from "./types.ts";
export { installAfterMerge } from "./install.ts";
export { landBranch } from "./merge.ts";
export {
  landNewSpec, landStepBranch, landStoppedStepBranch, landArchivedSpec, landClosedSpec,
} from "./steps.ts";
export { withFreshness } from "./freshness.ts";
export { createLaunchdRestart, restartAfterLanding, runningJobNames, type RestartHook } from "./restart.ts";
