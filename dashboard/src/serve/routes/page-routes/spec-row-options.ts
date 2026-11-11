// What a spec's row is drawn with, whichever page draws it. The Specs list and
// the Jobs tab both draw a spec's row with the list's row builder, so both
// take these options from here and add what is their own.

import { providerPickerOptions } from "../../providers/options.ts";
import type { Language } from "../../../i18n";
import { inFlight, jobKind, waitsForPerson } from "../../../queue/queue.ts";
import type { SpecsPageOptions } from "../../../render";
import type { JobLike } from "../../../render/pages/jobs-page/rows.ts";
import { openOverlappingSpecs } from "../../../project/overlapping-specs.ts";
import { modelChoiceOptions } from "../../serve-helpers";
import { jobStepLines } from "../../spec-views/job-marks.ts";
import { phaseMessagesFor, sideMessagesFor } from "../../spec-views/phase-messages.ts";
import { codeBranchOnOrigin } from "../../test-servers/branch-on-origin.ts";
import type { SidePart } from "../../../queue/providers/side-tools.ts";
import type { RoutesContext } from "..";
import { branchForSpec } from "../../../project/discover/group.ts";

export function specRowOptions(ctx: RoutesContext, url: URL, lang: Language): SpecsPageOptions {
  return {
    runnerAvailable: ctx.opts.runnerAvailable ?? ctx.runner !== null,
    targets: ctx.withFreshness(ctx.targets()),
    archived: ctx.readScan()?.archived ?? [],
    lang,
    modelChoices: modelChoiceOptions(ctx.queue),
    defaultModels: ctx.queue.defaults.model,
    ...providerPickerOptions(ctx.queue),
    // A model picked for a phase before any job exists, and which phases a
    // reader chose: what a fresh render shows instead of re-deriving them
    // from history alone.
    pendingModels: ctx.queue.pendingModels,
    pendingProviders: ctx.queue.pendingProviders,
    pendingSteps: ctx.queue.pendingSteps,
    // Called only for the open row of a Close, Reopen, deploy or scheduled job.
    closeOrReopenSteps: (jobId: string) => {
      const job = ctx.queue.get(jobId);
      return job ? jobStepLines(job, lang) : [];
    },
    // The same capability check `spec-page.ts` and `project-pages.ts` call,
    // and the cached answer of whether origin holds the spec's branch in the
    // checkout the start route asks.
    testServerAvailable: (project: string, specFolder: string) => {
      const dir = ctx.specDir(project, specFolder);
      return ctx.testServers.previewAvailable(project) &&
        codeBranchOnOrigin(ctx.branchStatus, ctx.testServers.aideCheckout(project), specFolder, dir ? branchForSpec(dir, specFolder) : undefined);
    },
    // The address the sweep holds for a branch Cloudflare has built; only
    // while origin still holds the branch it was built from.
    branchPreview: (project: string, specFolder: string) => {
      const dir = ctx.specDir(project, specFolder);
      return codeBranchOnOrigin(ctx.branchStatus, ctx.testServers.aideCheckout(project), specFolder, dir ? branchForSpec(dir, specFolder) : undefined)
        ? ctx.readBranchPreview(project, specFolder)
        : undefined;
    },
    // The specs a stopped analysis recorded as sharing its files, less those
    // archived since. Called only for a row whose analyze stopped on them.
    overlappingSpecs: (project: string, specFolder: string) =>
      openOverlappingSpecs(ctx.specDir(project, specFolder), (folder) => ctx.specRef(project, folder)),
    // The messages of a phase the address unfolded. Called only for those, so
    // a redraw reads no transcript for a phase nobody opened.
    phaseMessages: (attemptIds: string[], step: string) => phaseMessagesFor(ctx.queue, attemptIds, step),
    // The same for a side session's line (Review, Verify) under Implement.
    sideMessages: (attemptIds: string[], part: SidePart) => sideMessagesFor(ctx.queue, attemptIds, part),
    // How a row is folded lives in the address, so it survives a reload.
    filter: {
      open: url.searchParams.get("open") ?? undefined,
      checks: url.searchParams.get("checks") ?? undefined,
      phases: url.searchParams.get("phases") ?? undefined,
    },
  };
}

/** The jobs a spec's row is drawn from, on the Specs list and the Jobs tab
 *  alike: those of a project the queue may run that are neither a scheduled job
 *  nor a deploy (no spec folder), nor a Close or Reopen the Jobs tab draws as a
 *  row of its own, so such a job never speaks for its spec on either page. */
export function listedSpecJobs<J extends JobLike>(ctx: Pick<RoutesContext, "allowed">, jobs: J[]): J[] {
  const at = (job: J): number => Date.parse(job.createdAt) || 0;
  const own = new Set(
    jobs.filter((job) => {
      if (!["close", "reopen"].includes(jobKind(job))) return false;
      if (inFlight(job)) return true;
      if (!waitsForPerson(job)) return false;
      return !jobs.some(
        (later) => later.project === job.project && later.specFolder === job.specFolder &&
          later.state !== "cancelled" && at(later) > at(job),
      );
    }).map((job) => job.id),
  );
  return jobs.filter(
    (job) => ctx.allowed.has(job.project) && !["schedule", "deploy", "cleanup"].includes(jobKind(job)) && !own.has(job.id),
  );
}
