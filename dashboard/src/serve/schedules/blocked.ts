// Which queued jobs the runner must NOT start on this tick, and why —
// split out of schedules.ts by theme: that file keeps every peek fed,
// this one decides what a tick is allowed to run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverProjects } from "../../project/discover";
import { readSpecState } from "../../project/parse-spec-state.ts";
import { acceptanceStillOpen, parseStatus } from "../../project/parse-status";
import { GATED, resolveDependencyFolder } from "../serve-helpers";
import type { ScheduleContext } from "./";

/** Which queued jobs are waiting on a dependency that is not archived
 *  yet (spec 122; spec 351) — job id → the folder it is waiting for.
 *
 *  The same question `aide-run-spec`'s guard asks, asked HERE so the
 *  answer arrives before a job is spawned rather than after: a job
 *  that reached the script was refused, marked `failed`, and had to be
 *  pressed again by hand (97 three times, 102 twice, against
 *  dependencies that merged minutes later).
 *
 *  Computed fresh immediately before every `tick()`, never cached
 *  across calls: a job enqueued a line of code ago must be judged
 *  against data that existed after it did. `archivedOnOrigin` carries
 *  no TTL cache at all (REQ-2), the same way the merge answer under the
 *  old check was asked fresh (`isMerged(..., true)`, spec 213) for the
 *  same reason: a 30 s cached answer once released two jobs against a
 *  dependency that had not landed, and the script — which asks origin
 *  every time — refused them. Only `targets()` is still cached here,
 *  for 5 s, and it decides nothing on its own: a spec that names no
 *  dependency is the cheap half. */
/** How long a job waits on a dependency origin cannot be asked about
 *  before it is released as it always was. A fetch that fails for a
 *  moment — a lock taken by a landing in the same checkout — held
 *  nothing and let the job start into the script's refusal; an origin
 *  that stays unreachable must not park a job for good (spec 351). */
export const UNCONFIRMED_HOLD_MS = 10 * 60_000;

/** When each job's dependency first could not be confirmed, by job id. */
const unconfirmedSince = new Map<string, number>();

export async function blockedDependencies(ctx: ScheduleContext): Promise<Map<string, string>> {
  const blocked = new Map<string, string>();
  if (!ctx.projectRoot) return blocked;
  const waiting = ctx.queue.list().filter((job) => {
    if (job.state !== "queued") return false;
    const step = job.steps[job.stepIndex];
    return step !== undefined && GATED.has(step);
  });
  if (waiting.length === 0) return blocked;
  // The cheap half first, off the scan the page already keeps: a spec
  // that names nothing costs neither a walk of the specs root nor a
  // git call, the same way a spec without the field asks origin
  // nothing in the script.
  const named = new Map(ctx.targets().map((t) => [`${t.project}/${t.specFolder}`, t.dependsOn ?? []]));
  if (!waiting.some((j) => (named.get(`${j.project}/${j.specFolder}`) ?? []).length > 0)) return blocked;

  // Not `targets()`: that drops archived specs, and an archived
  // dependency is precisely the case that must resolve — to
  // "satisfied", without asking origin anything.
  const projects = new Map(discoverProjects(ctx.projectRoot).map((p) => [p.name, p]));
  for (const job of waiting) {
    const project = projects.get(job.project);
    const spec = project?.specs.find((s) => s.folder === job.specFolder && !s.archived);
    if (!project || !spec) continue;
    for (const id of spec.dependsOn) {
      const dep = resolveDependencyFolder(project, id);
      // An unknown identifier, or the spec itself: both are refusals
      // the script makes on its own, and neither is something waiting
      // could ever fix. Parking on one would hide a typo forever.
      if (!dep || dep.folder === spec.folder) continue;
      // `dep.archived` is a LOCAL filesystem scan and can be stale in
      // either direction (spec 351, REQ-2) — origin decides, every
      // time, even for a dependency already known archived locally, the
      // same reason spec 343 stopped trusting a local checkout for
      // "has this step's commit landed."
      //
      // Asked against the SPECS root alone, the last entry `specRoots`
      // gives (the project root when it IS the specs root too):
      // whether a spec is archived is a fact about one folder's
      // location in one repository, never about the project root the
      // way a code branch can differ per repo.
      const roots = ctx.specRoots(job.project);
      const specsRoot = roots[roots.length - 1];
      if (!specsRoot) continue;
      const archived = await ctx.branchStatus.archivedOnOrigin(specsRoot, dep.folder);
      if (archived === null) {
        const now = (ctx.now ?? Date.now)();
        const since = unconfirmedSince.get(job.id) ?? now;
        unconfirmedSince.set(job.id, since);
        if (now - since < UNCONFIRMED_HOLD_MS) {
          blocked.set(job.id, dep.folder);
          break;
        }
        continue;
      }
      unconfirmedSince.delete(job.id);
      if (!archived) {
        blocked.set(job.id, dep.folder);
        break;
      }
    }
  }
  return blocked;
}

/** The `Workflow steps completed` line, read straight from the prose —
 *  the fallback for a spec that has no state file yet. */
function proseSteps(dir: string): string[] {
  try {
    return parseStatus(readFileSync(join(dir, "4-status.md"), "utf-8")).workflowSteps;
  } catch {
    return [];
  }
}

/** Which queued `implement` jobs are waiting on their own spec's
 *  `analyze` step (spec 344) — a job id SET, not a Map: the message is
 *  the same fixed sentence for every job it applies to, unlike a
 *  dependency's per-job folder name.
 *
 *  Same shape as `blockedDependencies`: the runner takes the answer
 *  rather than computes it, recomputed fresh before every `tick()`.
 *  Unlike that one, this asks no network question — the `Workflow
 *  steps completed` line is a local file read off the already-
 *  discovered spec directory, the same field
 *  `core/scripts/aide-run-spec`'s own gate reads for the identical
 *  refusal. */
export function blockedForMissingAnalyze(ctx: ScheduleContext): Set<string> {
  const blocked = new Set<string>();
  if (!ctx.projectRoot) return blocked;
  const waiting = ctx.queue.list().filter((job) => {
    if (job.state !== "queued") return false;
    return job.steps[job.stepIndex] === "implement";
  });
  if (waiting.length === 0) return blocked;
  const projects = new Map(discoverProjects(ctx.projectRoot).map((p) => [p.name, p]));
  for (const job of waiting) {
    const project = projects.get(job.project);
    const spec = project?.specs.find((s) => s.folder === job.specFolder && !s.archived);
    // An unresolved spec is the script's own refusal to make (unknown
    // spec), never something parking here could fix — the same rule
    // blockedDependencies already keeps for an unknown dependency id.
    if (!spec) continue;
    if (!completedSteps(ctx, spec.dir, job.specFolder).includes("analyze")) blocked.add(job.id);
  }
  return blocked;
}

/** Which queued `archive` jobs `aide-archive-spec` would only refuse,
 *  because the spec's acceptance rows are not all ticked. Only on a
 *  branch answer read since the last tick: the Checks tab ticks the
 *  BRANCH copy, so an unread or stale one is left to the script's own
 *  pre-check rather than judged off a disk copy archive has not
 *  updated yet. */
export function archiveWithOpenAcceptance(ctx: ScheduleContext): Set<string> {
  const open = new Set<string>();
  if (!ctx.projectRoot) return open;
  const waiting = ctx.queue.list().filter((job) => job.state === "queued" && job.steps[job.stepIndex] === "archive");
  if (waiting.length === 0) return open;
  const projects = new Map(discoverProjects(ctx.projectRoot).map((p) => [p.name, p]));
  for (const job of waiting) {
    const spec = projects.get(job.project)?.specs.find((s) => s.folder === job.specFolder && !s.archived);
    if (!spec) continue;
    const peek = ctx.readBranchFileSteps().peekFileSteps(spec.dir, job.specFolder);
    if (peek.checkedAt === null || peek.stale) continue;
    if (acceptanceStillOpen(peek.steps?.acceptanceOpen, readSpecState(spec.dir)?.acceptanceCriteria)) open.add(job.id);
  }
  return open;
}

/** Which workflow steps this spec has actually completed.
 *
 *  spec 355 (REQ-3): the state file, not a fresh parse of the prose
 *  beside it — the same gate `core/scripts/aide-run-spec`'s own
 *  may-implement-start check reads, now off the one shared source.
 *  The state file when the spec has one, its own prose when it has
 *  not: a spec analyzed before spec 355 landed carries no state
 *  file, and reading that as "nothing has run" held every
 *  such implement back as not analyzed (2026-09-02). The runner's own
 *  gate (spec 344) still refuses a spec that truly has not been
 *  analyzed, whichever source said so here.
 *
 *  The BRANCH copy first, as the acceptance gate reads it: a
 *  chained job's analyze is on `aide/<folder>` the moment the step
 *  ends, and its landing can fail (main moved under it) without the
 *  analysis being any less done — implement runs from that branch.
 *  Read off disk alone, such a job sat queued behind "held back: not
 *  analyzed yet" with the real reason only in landingError
 *  (2026-09-03). */
function completedSteps(ctx: ScheduleContext, dir: string, folder: string): string[] {
  const branchAnswer = ctx.readBranchFileSteps().peekFileSteps(dir, folder).steps;
  return (
    branchAnswer?.stateSteps ??
    (branchAnswer?.proseSteps.length ? branchAnswer.proseSteps : undefined) ??
    readSpecState(dir)?.completedPhases ??
    proseSteps(dir)
  );
}

