// The walk `targets()` caches: every allowed project's specs, live and
// archived, and the `SpecTarget` each live one is shown as.

import { readAcCoverage, withAcCoverage } from "../../project/ac-coverage.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FileStepsAnswer } from "../../git/workflow-history.ts";
import { specProgressOf } from "../schedules/spec-progress.ts";
import { STATUS_FILE } from "../../project/spec-names.ts";
import {
  discoverProjects, manifestInside, type DiscoveredProject, type SpecRef,
} from "../../project/discover";
import {
  acceptanceRowsOf, ACCEPTANCE_CRITERIA_UNTICKED_NOTE, archiveHeldBackReason, parseStatus, reopenedRound,
} from "../../project/parse-status";
import { currentPhase, readSpecState, type SpecState } from "../../project/parse-spec-state.ts";
import { specPendingChoice } from "../../project/approach-choice.ts";
import type { SpecTarget } from "../../project/spec-facts.ts";
import { resolveDependencyFolder } from "../serve-helpers";
import type { ScanState, SpecLookupContext } from "./index.ts";

type BranchAnswer = FileStepsAnswer | null;

/** Walks the projects root once. Every spec there is, archived ones
 *  included, is recorded by `project/folder` with its directory and what
 *  it IS: `targets` is live-only by design, so the page of an ARCHIVED
 *  spec looked its title up in a list that could not hold it and rendered
 *  no description line at all — silently, because the H1 comes from the
 *  folder name. One lookup answers the title and whether the spec is
 *  archived, for every spec there is.
 *
 *  An archived spec is remembered by key: a create job keeps its group
 *  visible while its spec has not landed, and "archived" is the one
 *  proof that it HAS — without it the ghost row outlives the spec (seen
 *  in practice). */
export function scanSpecs(ctx: SpecLookupContext, now: number): ScanState {
  const found: SpecTarget[] = [];
  const gone: string[] = [];
  const refs = new Map<string, SpecRef>();
  const dirs = new Map<string, string>();
  const specsRoots = new Map<string, string>();
  if (ctx.projectRoot) {
    for (const p of discoverProjects(ctx.projectRoot, ctx.ownedSpecsRoot, manifestInside(ctx.machineryProjectDir))) {
      if (!ctx.allowed.has(p.name)) continue;
      specsRoots.set(p.name, p.specsRoot);
      for (const s of p.specs) {
        dirs.set(`${p.name}/${s.folder}`, s.dir);
        refs.set(`${p.name}/${s.folder}`, s);
        if (s.archived) gone.push(`${p.name}/${s.folder}`);
        else found.push(specTarget(ctx, p, s, now));
      }
    }
  }
  return { at: now, targets: found, archived: gone, dirs, refs, specsRoots };
}

/** The status file's prose, or "" where there is none. The prose is read
 *  once, for the ONE thing that stays prose-only: the `## Archive held
 *  back` section, which is display text `4-status.json`'s schema does not
 *  carry. */
function readStatusText(dir: string): string {
  try {
    return readFileSync(join(dir, STATUS_FILE), "utf-8");
  } catch {
    return "";
  }
}

/** What a reader needs to CHOOSE a spec: what it is called and how far it
 *  has got. The state-bearing fields (phase, fileSteps, reopenedAfter,
 *  the acceptance-criteria half of heldBack) come from the state file,
 *  through the one reader — never from a fresh parse of the prose.
 *
 *  Whether a row is open, Not verified or Failed follows the one rule
 *  every reader follows: the branch copy's state file once it has been
 *  read and no write has marked it due — a tick on a spec whose
 *  `aide/<folder>` is open lands there — and main's otherwise.
 *
 *  The held-back reason: the dependency-gated one first (still checked,
 *  though largely retired), then the far more common one today: archive's
 *  own acceptance-criteria gate refusing until a person ticks those rows —
 *  a healthy wait, not a failure, and one a bare "ready" row otherwise
 *  gives no reason for. `ACCEPTANCE_CRITERIA_UNTICKED_NOTE` is the one
 *  string `restingChip()` (job-state/resting.ts) checks for to keep this
 *  case's badge "ready" rather than the dependency case's "waiting" — the
 *  two share this field because both are archive declining to proceed,
 *  but only one of them is ordinary, expected progress. */
function specTarget(ctx: SpecLookupContext, p: DiscoveredProject, s: SpecRef, now: number): SpecTarget {
  const statusText = readStatusText(s.dir);
  const state = readSpecState(s.dir);
  const branchPeek = ctx.readBranchFileSteps?.()?.peekFileSteps(s.dir, s.folder) ?? { steps: null, checkedAt: null };
  const branchAnswer = branchPeek.steps;
  const fileSteps: FileStepsAnswer = {
    proseSteps: parseStatus(statusText).workflowSteps,
    stateSteps: state?.completedPhases,
    ...(state ? { stateAcceptance: state.acceptanceCriteria } : {}),
    readAt: now,
  };
  const progress = specProgressOf(fileSteps, branchPeek, null);
  const acceptanceOpen = progress.acceptanceOpen;
  const notVerified = progress.notVerified || undefined;
  const failed = progress.failed || undefined;
  const heldBack = statusText
    ? (archiveHeldBackReason(statusText) ?? (acceptanceOpen ? ACCEPTANCE_CRITERIA_UNTICKED_NOTE : null))
    : null;
  return {
    project: p.name,
    specFolder: s.folder,
    acceptanceOpen,
    reopenedRound: reopenedRound(statusText),
    // Off the same copy as `acceptanceOpen`: a mark moved on the open
    // branch is not on main until archive lands.
    notVerified,
    failed,
    // The rows the list unfolds, off the same copy as `acceptanceOpen`:
    // its prose lines, which the tick route finds a row again by, and
    // which it writes in one commit with the state file. Carried while
    // a row is open, and while one waits for a check or failed: the
    // list unfolds them under that count too.
    readAcceptance: () => acceptanceOpen || notVerified || failed
      ? withAcCoverage(
          (progress.from === "branch" ? branchAnswer?.acceptance : undefined) ?? acceptanceRowsOf(statusText),
          branchAnswer?.acCoverage ?? readAcCoverage(s.dir),
          ctx.machineryProjectDir(p.name),
        )
      : undefined,
    // The approaches waiting for the person who asked to choose,
    // off the branch's plan first, as the rows above.
    readApproachChoice: () => specPendingChoice(s.dir, branchAnswer?.approaches) ?? undefined,
    ...describedFields(p, s, branchAnswer),
    ...stateFields(state, statusText, fileSteps, heldBack),
  };
}

/** What the spec's own files say it is. `dir` is where the freshness
 *  check runs git — never rendered: the page has no use for an absolute
 *  path, and `targets` is server-side only.
 *
 *  `dependsOn` is what its own 1-description.md says it builds on, shown
 *  on its row in the same words the run's dependency refusal uses. The
 *  branch's line first, as for the rows: a save of it is written onto the
 *  open branch, not the checkout. Each entry by the folder it resolves
 *  to, as the Running tab's picker ticks by folder; one nothing matches
 *  stays as written. `createChoices` are the four settings it was created
 *  with, for its open row on the Running tab, the branch's first for the
 *  same reason. */
function describedFields(p: DiscoveredProject, s: SpecRef, branchAnswer: BranchAnswer) {
  return {
    dir: s.dir,
    title: s.title ?? undefined,
    description: s.description ?? undefined,
    dependsOn: (branchAnswer?.dependsOn ?? s.dependsOn).map((id) => resolveDependencyFolder(p, id)?.folder ?? id),
    group: branchAnswer?.group ?? s.group,
    createChoices: branchAnswer?.createChoices ?? s.createChoices,
  };
}

/** How far the spec has got, off its FILES and nothing else. It used to
 *  be unioned with the queue's own record of what it ran, which is how an
 *  archive job that finished without moving anything counted as an
 *  archived spec, and how a phase could read "done" on a row whose files
 *  said otherwise. What a job reported is still shown, as a qualifier —
 *  in the row's own panel, not on the phase's line.
 *
 *  `fileSteps` is a claim, not the answer: a model has to reach its last
 *  instruction to write it and a copied folder brings a sibling's version
 *  along. `withFreshness` fills `done` in from the runner's own commits,
 *  and this is what it compares them against. The prose's own steps line
 *  and the state file's own claim are kept apart rather than collapsed
 *  into one array, so `resolveWorkflowState` can stop comparing the state
 *  file against git once one exists: a git-history comparison of a
 *  state-file spec compares two records that can legitimately disagree
 *  for reasons that mean nothing.
 *
 *  `reopenedAfter` is where this spec's history starts, when it has been
 *  reopened. `stateMissing` marks a spec whose files exist but that has
 *  no state file yet — not touched by a writer script since the state
 *  file existed, or an archived spec the backfill has not reached. Never
 *  for a brand-new spec with no 4-status.md at all, which is ordinary
 *  "not started yet", not a gap. */
function stateFields(state: SpecState | null, statusText: string, fileSteps: FileStepsAnswer, heldBack: string | null) {
  return {
    phase: (state ? currentPhase(state) : null) ?? undefined,
    fileSteps,
    reopenedAfter: state?.reopened?.boundaryCommit,
    archiveHeldBack: heldBack ? { reason: heldBack } : undefined,
    stateMissing: statusText ? state === null : undefined,
  };
}
