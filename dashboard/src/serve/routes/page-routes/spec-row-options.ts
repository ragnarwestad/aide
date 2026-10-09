// What a spec's row is drawn with, whichever page draws it. The Specs list and
// the Jobs tab both draw a spec's row with the list's row builder, so both
// take these options from here and add what is their own.

import type { Language } from "../../../i18n";
import type { SpecsPageOptions } from "../../../render";
import { openOverlappingSpecs } from "../../../project/overlapping-specs.ts";
import { isWikiBuild } from "../../../queue/steps.ts";
import { modelChoiceOptions } from "../../serve-helpers";
import { phaseMessagesFor } from "../../spec-views/phase-messages.ts";
import { codeBranchOnOrigin } from "../../test-servers/branch-on-origin.ts";
import type { RoutesContext } from "..";

export function specRowOptions(ctx: RoutesContext, url: URL, lang: Language): SpecsPageOptions {
  return {
    runnerAvailable: ctx.opts.runnerAvailable ?? ctx.runner !== null,
    targets: ctx.withFreshness(ctx.targets()),
    archived: ctx.readScan()?.archived ?? [],
    lang,
    modelChoices: modelChoiceOptions(ctx.queue),
    defaultModels: ctx.queue.defaults.model,
    // A model picked for a phase before any job exists, and which phases a
    // reader chose: what a fresh render shows instead of re-deriving them
    // from history alone.
    pendingModels: ctx.queue.pendingModels,
    pendingSteps: ctx.queue.pendingSteps,
    // The same capability check `spec-page.ts` and `project-pages.ts` call,
    // and the cached answer of whether origin holds the spec's branch in the
    // checkout the start route asks.
    testServerAvailable: (project: string, specFolder: string) =>
      ctx.testServers.previewAvailable(project) &&
      codeBranchOnOrigin(ctx.branchStatus, ctx.testServers.aideCheckout(project), specFolder),
    // The address the sweep holds for a branch Cloudflare has built; only
    // while origin still holds the branch it was built from.
    branchPreview: (project: string, specFolder: string) =>
      codeBranchOnOrigin(ctx.branchStatus, ctx.testServers.aideCheckout(project), specFolder)
        ? ctx.readBranchPreview(project, specFolder)
        : undefined,
    // The specs a stopped analysis recorded as sharing its files, less those
    // archived since. Called only for a row whose analyze stopped on them.
    overlappingSpecs: (project: string, specFolder: string) =>
      openOverlappingSpecs(ctx.specDir(project, specFolder), (folder) => ctx.specRef(project, folder)),
    // The messages of a phase the address unfolded. Called only for those, so
    // a redraw reads no transcript for a phase nobody opened.
    phaseMessages: (attemptIds: string[], step: string) => phaseMessagesFor(ctx.queue, attemptIds, step),
    // How a row is folded lives in the address, so it survives a reload.
    filter: {
      open: url.searchParams.get("open") ?? undefined,
      checks: url.searchParams.get("checks") ?? undefined,
      phases: url.searchParams.get("phases") ?? undefined,
    },
  };
}

/** The jobs a spec's row is drawn from, on the Specs list and the Jobs tab
 *  alike: those of a project the queue may run, neither a scheduled job (no
 *  spec folder) nor a wiki build (its state is on the project's Wiki tab). */
export function listedSpecJobs<J extends { project: string; specFolder: string; steps: readonly string[] }>(
  ctx: Pick<RoutesContext, "allowed">,
  jobs: J[],
): J[] {
  return jobs.filter((j) => ctx.allowed.has(j.project) && !j.specFolder.startsWith("schedule-") && !isWikiBuild(j));
}
