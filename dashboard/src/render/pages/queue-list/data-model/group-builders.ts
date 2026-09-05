// Turning the raw jobs, targets and archived records into the rows this
// page actually draws — one SpecGroup per spec, however many jobs or
// none it took.

import { currentWorkRoundJobs } from "../../../../queue/queue.ts";
import { anyCostUnmeasured, inFlight, type QueueRowView } from "../../../ui/job-state.ts";
import { activityMs, phasesFor, totalDurationOf } from "./phases.ts";
import {
  ARCHIVED_OPEN_STATE,
  ARCHIVED_STATE,
  CLOSED_STATE,
  PHASE_LINES,
  groupKey,
  type ArchivedSpecView,
  type QueueTarget,
  type SpecGroup,
} from "./types.ts";

// A spec with no job is still a spec. It is the ONLY row on this page
// where the whole workflow is still ahead of you, which is exactly the
// row the analyze button belongs on.
function emptyGroup(t: QueueTarget, now: number): SpecGroup {
  const phases = phasesFor([], t);
  const total = totalDurationOf(phases, now);
  return {
    project: t.project,
    specFolder: t.specFolder,
    // It came from a target, so the folder is on disk by construction.
    named: true,
    state: "not-started",
    spentUsd: 0,
    costUnmeasured: false,
    phases,
    totalDurationMs: total?.ms,
    totalDurationSince: total?.since,
    ...fromTarget(t),
  };
}

/** What a row reads off its own spec rather than off its jobs. Written
 *  once because both constructors need it, and a row showing another
 *  spec's done-set or progress is the one way this join can go wrong. */
function fromTarget(
  t: QueueTarget | undefined,
): Pick<
  SpecGroup,
  | "done"
  | "title"
  | "description"
  | "phase"
  | "dependsOn"
  | "analyzeStale"
  | "createdAt"
  | "createdAtChecking"
  | "freshnessUnknown"
> {
  return {
    done: t?.done ?? [],
    title: t?.title,
    // Read but not drawn: the search's third field (spec 221).
    description: t?.description,
    phase: t?.phase,
    dependsOn: t?.dependsOn ?? [],
    analyzeStale: t?.analyzeStale ?? false,
    freshnessUnknown: t?.freshnessUnknown,
    // From the TARGET and from nowhere else (spec 199). There is
    // deliberately no fallback to a job's own `createdAt`/`startedAt`:
    // that is the field this change exists to stop reading, and a
    // fallback would leave the row jumping for exactly the specs git
    // cannot date.
    createdAt: t?.createdAt,
    createdAtChecking: t?.createdAtChecking,
  };
}

const isCreate = (r: QueueRowView): boolean => r.steps.includes("create");

export function groupBySpec(
  rows: QueueRowView[],
  targets: QueueTarget[],
  archived?: string[],
  archivedSpecs?: ArchivedSpecView[],
  now: number = Date.now(),
): SpecGroup[] {
  const byKey = new Map<string, QueueRowView[]>();
  for (const r of rows) {
    const key = groupKey(r.project, r.specFolder);
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }
  const byKeyTarget = new Map(targets.map((t) => [groupKey(t.project, t.specFolder), t]));
  const known = new Set(byKeyTarget.keys());
  // Which projects we are entitled to judge. An empty target list is
  // "we do not know", never "everything is archived": a specs root that
  // is not checked out on this host looks exactly the same from here,
  // and a project losing its whole history to a momentarily unreadable
  // disk is not recoverable by a filter.
  const judgeable = new Set(targets.map((t) => t.project));
  const archivedSet = new Set(archived ?? []);
  const fromJobs = [...byKey.entries()]
    // Archived beats every other reason to keep a group visible. An
    // unreadable specs root and an in-flight create job both argue for
    // showing something anyway; a folder already in archive/ answers
    // "did this spec finish" with certainty, so none of the other
    // branches get a vote. The check used to sit on the create branch
    // alone, and a project with no other live target still slipped an
    // archived spec's row through `judgeable` — every phase reading
    // "not run yet" under a job reporting done (spec 134).
    // There was an exception here until spec 221: a spec whose own
    // branch is STILL on origin kept its JOB row, archived or not (spec
    // 193), because a row was the only way to see that its work had
    // never landed. It had to come through this path because there was
    // no other — so it read as an ordinary, fully-interactive job row,
    // offering a Run the server would have refused. Every archived spec
    // gets a reader row now, and spec 193's answer rides on that row as
    // a MARK (`ArchivedSpecView.notLanded`) instead of as a reason to
    // draw one. The two must not be re-separated: a second, different
    // kind of archived row is what 1-description.md rules out by name.
    .filter(
      ([key, all]) =>
        !archivedSet.has(key) &&
        // A create job's spec is not a known target BY CONSTRUCTION: the
        // folder is what the job is making, and until it lands there is
        // nothing on disk to match. Without this it would be filtered out
        // in exactly the projects that already have specs — so the job the
        // reader just started would render nothing at all.
        (known.has(key) || !judgeable.has(all[0]!.project) || all.some(isCreate)),
    )
    .map(([key, all]) => [key, currentWorkRoundJobs(all)] as const)
    .filter(([, all]) => all.length > 0)
    .map(([key, all]) => jobGroup(all, byKeyTarget.get(key), now));
  return [
    ...fromJobs,
    // Only ever a list the server chose to build: under the default
    // filter it is absent, and this adds nothing at all.
    ...(archivedSpecs ?? []).map(readerGroup),
    ...targets.filter((t) => {
      const jobs = byKey.get(groupKey(t.project, t.specFolder));
      return !jobs || currentWorkRoundJobs(jobs).length === 0;
    }).map((t) => emptyGroup(t, now)),
  ];
}

/** An archived spec's row: a record, not a control (spec 221).
 *
 *  It goes through neither `jobGroup` nor `emptyGroup`, and that is the
 *  point. Both build a row off JOBS — a lead job to speak for it, an
 *  attempt per phase — and an archived spec's jobs are gone from the
 *  queue's two-hundred-deep memory for all but the newest of them.
 *
 *  It is still the same ROW, though, and since spec 224 it is drawn by
 *  the same builder: `isArchivedRow` is what locks it, and the lock is
 *  what keeps every control on it from offering a press the server
 *  would refuse (`ARCHIVE_ONLY_STEP`, queue.ts). There were two row
 *  builders until then, kept level by hand, and they had already
 *  drifted — no fold and no phase lines on one side only.
 *
 *  The four phases, therefore, and not the `phases: []` this built
 *  until spec 224: the row opens now, and what it opens on is what the
 *  spec's own `4-status.md` claims. No `attempts`, because there is no
 *  job to attribute one to — `wordPhase` renders a truthful "done" from
 *  `happened` alone, so the lines and the pip strip are correct without
 *  one, and the duration and cost cells are simply blank. */
function readerGroup(s: ArchivedSpecView): SpecGroup {
  return {
    project: s.project,
    specFolder: s.folder,
    // It came out of a folder on disk, so the name IS the spec's.
    named: true,
    // Closed checked first (spec 406, REQ-7): a closed spec must never
    // read as either archived state, even a defensive one — see
    // `ArchivedSpecView.closed`'s own comment for why the two are
    // checked independently rather than assumed exclusive. Otherwise
    // the one place the two archived states are told apart.
    state: s.closed ? CLOSED_STATE : s.notLanded ? ARCHIVED_OPEN_STATE : ARCHIVED_STATE,
    spentUsd: Object.values(s.phaseOutcomes).reduce((sum, o) => sum + (o.cost ?? 0), 0),
    costUnmeasured: Object.values(s.phaseOutcomes).some((o) => o.costUnmeasured),
    // Spec 260: the sibling roll-up for a Codex-only archive, which has
    // no `cost` on any phase outcome to sum above — `undefined` (never
    // 0) when nothing recorded a token figure either, same "absent, not
    // zero" rule `cost` already follows.
    spentTokens: Object.values(s.phaseOutcomes).some((o) => o.tokens !== undefined)
      ? Object.values(s.phaseOutcomes).reduce((sum, o) => sum + (o.tokens ?? 0), 0)
      : undefined,
    // Spec 273: the same reduce as spentUsd above, over time instead of
    // money — reliable for every archived spec with per-phase Tracking
    // info, unlike the one-shot queue-history stamp this replaces.
    totalDurationMs: Object.values(s.phaseOutcomes).reduce((sum, o) => sum + (o.timeSpentMs ?? 0), 0),
    // Spec 247: `outcome?.model` — spec 245's new, one-record-per-file
    // format — wins over `s.models[step]` — spec 244's old,
    // `4-status.md`-only format — when both could theoretically apply.
    // They never do for the same real archive (`2-analysis.md`,
    // "Findings"), so this is a merge order, not a live disagreement.
    phases: PHASE_LINES.map((step) => {
      const outcome = s.phaseOutcomes[step];
      return {
        step,
        attempts: [],
        history: {},
        model: outcome?.model ?? s.models[step],
        // No `s.efforts[step]`-style fallback the way `model` has one:
        // effort is introduced fresh in spec 245's per-phase-file format
        // (spec 364), with no earlier, `4-status.md`-only format to fall
        // back to.
        effort: outcome?.effort,
        timeSpentMs: outcome?.timeSpentMs,
        cost: outcome?.cost,
        costUnmeasured: outcome?.costUnmeasured,
        tokens: outcome?.tokens,
        attemptCount: outcome?.attempts,
      };
    }),
    done: s.done,
    title: s.title,
    description: s.description,
    dependsOn: [],
    analyzeStale: false,
    // Copied onto the same top-level fields `fromTarget()` populates for
    // a live row (spec 317, plan review's must-fix 1): the sort key and
    // the Created cell both read `SpecGroup.createdAt` alone, whichever
    // kind of row it is, and a `readerGroup()` that left it unset would
    // sort every archived row as "unknown" regardless of its real date.
    createdAt: s.createdAt,
    createdAtChecking: s.createdAtChecking,
    archive: s,
  };
}

function jobGroup(all: QueueRowView[], target: QueueTarget | undefined, now: number): SpecGroup {
  const recent = [...all].sort((a, b) => activityMs(b) - activityMs(a));
  const spec = fromTarget(target);
  const lead = recent.find(inFlight) ?? recent[0]!;
  // The five, always, in order — a phase nobody has run yet still holds
  // its place, which is what makes progress readable at a glance. A
  // step outside them (explore, manifest) is appended rather
  // than dropped: a job that ran is never invisible. `create` is one of
  // the five since spec 116, so a create job lands on its own line at
  // the front rather than being appended after archive.
  // Built before the group, because the spec's total is a sum over
  // these same lines and re-deriving them would be two answers to one
  // question. `phasesFor` is where that join lives now (spec 239) —
  // the file-side answers this page shows on a line are added on top of
  // it, and the total reads neither.
  const phases = phasesFor(all, target);
  const total = totalDurationOf(phases, now);
  return {
    project: lead.project,
    specFolder: lead.specFolder,
    lead,
    state: lead.state,
    spentUsd: all.reduce((sum, r) => sum + r.spentUsd, 0),
    costUnmeasured: all.some((r) => anyCostUnmeasured(r.results)),
    // Summed over the jobs that HAVE a figure, and absent when none
    // does — so a spec whose runs all predate spec 118 shows a dash
    // rather than a total of nothing.
    spentTokens: all.some((r) => r.spentTokens !== undefined)
      ? all.reduce((sum, r) => sum + (r.spentTokens ?? 0), 0)
      : undefined,
    // Newest-first, so the first job that reported one wins.
    prUrl: recent.find((r) => r.prUrl)?.prUrl,
    prError: recent.find((r) => r.prError)?.prError,
    // The LEAD job's own answer (spec 341, REQ-4), not the newest job
    // that happens to have one set: `recent.find(...)` used to scan
    // past a lead job with no `pushError` straight to an older job that
    // had one, so a spec whose current job pushed fine still showed a
    // stale failure with advice that no longer applied.
    pushError: lead.pushError,
    landingError: lead.landingError,
    // From the same lead job, and for the landing mark beside it: a
    // landing the project's own suite refused is waiting, not broken.
    errorReason: lead.errorReason,
    phases,
    // The same roll-up shape as `spentUsd` above, over time instead of
    // money — and EVERY attempt of every phase counts now (spec 340), a
    // phase re-run three times contributing all three, whether or not
    // the whole workflow is done (spec 281). A phase still in flight
    // contributes its own elapsed-so-far via `totalDurationSince`,
    // rather than being excluded until it settles. Read off `phases`
    // above (spec 284), not recomputed from `all` — the latter would
    // re-read every not-yet-attempted phase's stamped file a second
    // time.
    totalDurationMs: total?.ms,
    totalDurationSince: total?.since,
    ...spec,
    // A create job has no target to read a title off — the spec it is
    // making is not on disk yet — so the job's own title is the row's.
    // Only as a fallback: once the spec has landed, the folder's own
    // 1-description.md is the better answer, and the one every other
    // row already uses.
    title: spec.title ?? all.find((r) => r.createTitle)?.createTitle,
    // Whether the name above the line is a real folder or a placeholder.
    // A target IS the folder on disk, so a group without one is a create
    // job whose spec has not landed and whose name is a provisional key
    // that says nothing to anyone — the one case where the title has to
    // stay on the row (see `specSummary`).
    named: !!target,
  };
}
