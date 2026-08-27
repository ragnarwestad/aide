// The queue row view: what every list, job page and spec page draws a
// job from — pulled out of `createServer`'s closure the same way the
// earlier clusters were (spec: split serve.ts, step 6). Small context:
// unlike `schedules.ts`, nothing here reads a `let` reassigned later in
// boot, so every field is a plain value.

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { specBranch } from "../git/branch-status.ts";
import { previewUrlFor } from "../git/preview-url.ts";
import { parseManifest, type ManifestData } from "../project/parse-manifest.ts";
import {
  QueueStore, tailEdits, type BranchRef, type Job,
} from "../queue/queue.ts";
import type { AideRunStore } from "../queue/aide-run-store.ts";
import type { QueueRowView } from "../render.ts";
import { resolveStepModel, resolveTimeoutSec } from "./serve-helpers.ts";

export interface JobRowContext {
  machineryProjectDir: (project: string) => string;
  displayProjectDir: (project: string) => string;
  queue: QueueStore;
  store: AideRunStore;
}

// Which repos this ONE job has a branch in. A job written before spec
// 89 has `branchUrl` and no `branchUrls`; synthesising a one-entry
// list from it reproduces the old single-repo behaviour verbatim,
// rather than making every pre-existing job's link vanish on deploy.
function jobBranches(ctx: JobRowContext, job: Job): BranchRef[] {
  return job.branchUrls?.length
    ? job.branchUrls
    : job.branchUrl
      ? [{ root: ctx.machineryProjectDir(job.project), url: job.branchUrl }]
      : [];
}

// A repo's directory basename — `aide`, `aide-specs` — which is the
// vocabulary the problem was described in. The full path is never sent
// to the browser: the server re-derives every root itself on a POST.
const repoLabel = (root: string): string => root.split(sep).filter(Boolean).pop() ?? root;

// Read FRESH, per render, not once at startup: adding
// `deployment.preview` to a manifest is an edit to a text file, and it
// should show on the next page load rather than the next deploy. Same
// cost class as the `4-status.md` reads `targets()` already does per
// spec. No manifest, or an unreadable one, is not an error worth a
// page over — it simply means this project has nothing to preview.
function projectManifest(ctx: JobRowContext, project: string): ManifestData | undefined {
  try {
    const text = readFileSync(join(ctx.displayProjectDir(project), ".aide", "project.yaml"), "utf-8");
    const result = parseManifest(text);
    return result.ok ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export async function jobRow(ctx: JobRowContext, job: Job): Promise<QueueRowView> {
  // The step whose model the row is about: the one running, or the
  // last one for a job that has finished.
  const step = job.steps[job.stepIndex] ?? job.steps[job.steps.length - 1];
  // Asked of EACH repo's own checkout. Asking the project's own root
  // about a branch that lives in the specs repo was not merely a
  // missing warning: a stale remote-tracking ref of the same name in
  // the project answered it cleanly, and the page said "merged" about
  // work that was not (1-description.md, "Measured again").
  const branch = specBranch(job.specFolder);
  // Asked of the project's OWN checkout only. A spec pushes a branch
  // of the same name to the repo holding its plan, and a plan is not
  // something anyone can open and try — the same distinction the merge
  // button already draws, drawn the same way, by comparing roots.
  const codeRoot = ctx.machineryProjectDir(job.project);
  const preview = projectManifest(ctx, job.project)?.deployment?.preview;
  const branchUrls = await Promise.all(
    jobBranches(ctx, job).map(async (b) => ({
      label: repoLabel(b.root),
      url: b.url,
      ...(b.root === codeRoot && { previewUrl: previewUrlFor(preview, branch) }),
    })),
  );
  return {
    id: job.id,
    project: job.project,
    specFolder: job.specFolder,
    // What a create job's row is called while its folder is still a
    // provisional key: `new-abc123de` says nothing to anyone.
    createTitle: job.createTitle,
    steps: job.steps,
    stepIndex: job.stepIndex,
    // Spec 160: which of them the row may still be given or relieved
    // of. Asked of the queue's own module, so the box and the route
    // that takes its tick cannot disagree about where the tail
    // starts.
    editableSteps: tailEdits(job),
    state: job.state,
    landing: job.landing,
    model: step ? resolveStepModel(job, step, ctx.queue.defaults.model) : job.modelChoice,
    spentUsd: job.spentUsd,
    // The stored split is five numbers; the page shows one. Flattened
    // here, at the boundary, so no render file has to know what a
    // result file looks like (spec 118).
    spentTokens: job.spentTokens,
    // One number, for the step this row speaks for: `stateLabel` puts
    // it into words ("stopped — 45 min") and has no step to resolve
    // against of its own.
    timeoutSec: resolveTimeoutSec(job.timeoutSec, step ?? "default", ctx.queue.defaults.timeoutSec),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    branchUrls,
    // Spec 220: stored on the job, not derived here like `branchUrls`
    // — only the run that called `gh` knows the URL, and there is
    // nothing on this machine to work it out from.
    prUrl: job.prUrl,
    prError: job.prError,
    stopReason: job.stopReason,
    error: job.error,
    // Why the landing was refused, when it was refused for something
    // the row can act on. Stored on the job (spec 149), because a
    // landing has no browser to redirect the reason to.
    errorReason: job.errorReason,
    // Which third of an implement is running (spec 210). Only for
    // `implement`, which is the one step that reports its phases, and
    // only off the job's LIVE `sessionId` — the queue clears that the
    // moment a step ends, so a finished job cannot pick up a leftover
    // row from the session it once used.
    tddPhase:
      step === "implement" && job.state === "running" && job.sessionId
        ? ctx.store.get(job.sessionId)?.phase
        : undefined,
    results: job.results.map((r) => ({
      step: r.step, ok: r.ok, costUsd: r.costUsd, tokens: r.tokens?.total,
      // When the step ENDED (spec 199). The only per-step instant
      // there is — a job has one `startedAt` however many steps it
      // ran — so it is what a phase's own duration is sliced out of.
      at: r.at,
      // Carried, not dropped: the totals the list and the overview tab
      // build out of these results have no other way to know a figure
      // they are summing was over-charged (spec 152).
      costMeasured: r.costMeasured,
    })),
  };
}
