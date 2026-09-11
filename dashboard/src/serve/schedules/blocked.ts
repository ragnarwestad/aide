// Which queued jobs the runner must NOT start on this tick, and why —
// split out of schedules.ts by theme: that file keeps every peek fed,
// this one decides what a tick is allowed to run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverProjects } from "../../project/discover.ts";
import { readSpecState } from "../../project/parse-spec-state.ts";
import { acceptanceStillOpen, parseStatus } from "../../project/parse-status.ts";
import { GATED, resolveDependencyFolder } from "../serve-helpers.ts";
import type { ScheduleContext } from "../schedules.ts";

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

/** `blockedForMissingAnalyze`'s sibling for `archive`: every queued job
 *  whose next step is `archive` and whose spec, in the main checkout,
 *  still has an acceptance row nobody has ticked. Read off the state
 *  file — the branch's copy when `aide/<folder>` is open, since that is
 *  where the Checks tab's tick lands, else the disk copy — so the tick
 *  that closes the last row is what releases the job. A spec with no
 *  state file (analyzed before spec
 *  355) or no acceptance section is not held: `aide-archive-spec`'s own
 *  gate is a no-op for the latter, and the former is its call to make. */
export function blockedForUntickedAcceptance(ctx: ScheduleContext): Set<string> {
  const blocked = new Set<string>();
  if (!ctx.projectRoot) return blocked;
  const waiting = ctx.queue.list().filter((job) => {
    if (job.state !== "queued") return false;
    return job.steps[job.stepIndex] === "archive";
  });
  if (waiting.length === 0) return blocked;
  const projects = new Map(discoverProjects(ctx.projectRoot).map((p) => [p.name, p]));
  for (const job of waiting) {
    const project = projects.get(job.project);
    const spec = project?.specs.find((s) => s.folder === job.specFolder && !s.archived);
    if (!spec) continue;
    // A spec that never reached `implement` is not waiting for a tick,
    // whatever its rows say: `core/scripts/aide-archive-spec` refuses it
    // with `not-implemented-yet` before it ever looks at the acceptance
    // section, and that refusal is the reason the reader needs. Held
    // here instead, the row read "tick the Acceptance criteria" — asking
    // a person to sign off work nobody has done, on a job that would
    // then sit queued for a tick that cannot honestly be made (423,
    // 2026-09-09). Let it start: the script answers as its own
    // pre-check, before any model is spawned, and the job ends with
    // "nothing is implemented yet — run implement first" on the row.
    if (!completedSteps(ctx, spec.dir, job.specFolder).includes("implement")) continue;
    // The branch copy first, as the row and the Checks tab read it —
    // a tick on a spec with an open branch is written there, and the
    // disk copy stays unticked until archive lands.
    const branchAnswer = ctx.readBranchFileSteps().peekFileSteps(spec.dir, job.specFolder).steps;
    if (acceptanceStillOpen(branchAnswer?.acceptanceOpen, readSpecState(spec.dir)?.acceptanceCriteria)) {
      blocked.add(job.id);
    }
  }
  return blocked;
}
