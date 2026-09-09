// Spec 154: which steps a spec has HAD, read off the runner's own
// commits.
//
// It used to be read off one line of `4-status.md`, written by the
// model that ran the step — and on 2026-08-21 that line was wrong in
// both directions on the same day. Spec 147's implement finished RED
// and GREEN and was killed by the step's time limit before the model
// reached the part that writes the file, so the row said "implement not
// run" about a spec whose code was already committed on its branch.
// Spec 153's four files were copied from a sibling whose analyze had
// landed, so a folder minutes old claimed three steps it had never had.
//
// A commit cannot be copied into existence and does not depend on the
// model getting as far as the last instruction: `aide-run-spec` makes it
// in the section that runs whatever the step's outcome was. So the
// commits are the record, and the file is a warning when it disagrees.
//
// Asked of git the way `description-freshness.ts` already asks it, with
// two differences that matter: every step rather than just `analyze`,
// and every ref rather than just `HEAD` — `implement` deliberately
// lands nothing until `archive` runs, so its commit sits on
// `aide/<spec-folder>` for as long as the spec takes.

import type { GitRunner } from "./branch-status.ts";
import { readStatusFromBranch, type OpenBranchTarget } from "./branch-file.ts";
import { acceptanceCriteriaUnticked, parseStatus } from "../project/parse-status.ts";
import { parseSpecStateText } from "../project/parse-spec-state.ts";
import workflowStepsData from "../../../core/scripts/lib/workflow-steps.json" with { type: "json" };

const DEFAULT_TTL_MS = 30_000;

/** The four stages a spec passes through, in workflow order — the same
 *  list `parse-status.ts` reads off the file, and deliberately NOT the
 *  nine the runner will execute: `explore` and `manifest`
 *  are things you can queue, not places a spec gets to. Read from
 *  `core/scripts/lib/workflow-steps.json` (spec 349), the same file
 *  `core/scripts/aide-run-spec` reads with jq. */
export const HISTORY_STEPS: readonly string[] = workflowStepsData.workflowArc;

/** A step name retired FROM the arc, kept recognized when READING old
 *  commits (spec 181, description requirement 2: "every archived spec
 *  whose history contains a review-plan run still displays that
 *  history"). `review-plan` folded into `analyze` and is gone from
 *  `HISTORY_STEPS` and `WORKFLOW_STEPS` (queue.ts) both — a NEW run can
 *  neither be asked for it nor write it as its own step's name — but a
 *  commit made before this change is still on disk, and
 *  `readWorkflowSubjects` below has to keep recognizing it or an
 *  archived spec's history silently loses a step it actually had.
 *  Never grows for a step retired WITHOUT that requirement: spec 171's
 *  `resolve` was never part of this arc and needed no such entry.
 *
 *  `core/scripts/aide-run-spec` reads the same value from
 *  `workflow-steps.json`'s `workflowArcRetired`. */
export const HISTORY_STEPS_RETIRED: readonly string[] = workflowStepsData.workflowArcRetired;

// --- the commit-subject grammar ---------------------------------------------
//
// THIS BLOCK IS COPIED VERBATIM into `core/scripts/aide-run-spec`, which
// derives the same answer in bash to write the file's own line. Two
// implementations of one rule, in two languages, the way
// `WORKFLOW_STEPS` and `DEPENDENCY_GATED_STEPS` already are — change
// one and the other has to change with it.
//
//     Run /aide-<step> for <spec-folder>[ (headless)][ (model: <tool> [<model>])][ (stopped: <reason>)]
//
// - `<step>` is the step's own name, exactly as `--command` names it.
// - `<spec-folder>` is the folder, never the numeric id: a `create` run
//   names the folder it just made.
// - ` (headless)` is present for a run `aide-run-spec` made and absent
//   for one committed at somebody's keyboard. Both count.
// - ` (model: <tool> [<model>])` is spec 217: who ran the step. The
//   tool is always known, the model value only when the caller named
//   one. Nothing here reads the value — the field it feeds is written
//   into `4-status.md` by `aide-run-spec` — but the group has to be in
//   the pattern all the same, because the pattern anchors on `$` and a
//   subject carrying a suffix it does not know about does not degrade:
//   it stops matching, and the step vanishes from the history.
//   It comes BEFORE the stop reason, which is read greedily to the end
//   of the subject and would otherwise swallow it.
// - ` (stopped: <reason>)` is present only when the run did NOT
//   complete, and carries `terminal_reason` verbatim (`timeout`,
//   `budget_exhausted`, …). Such a step has RUN but is not DONE.
// - The newest commit for a step is the one that speaks for it: a
//   re-run supersedes whatever the attempt before it said.
// - Anything else with the same words in it — a revert, a merge, a
//   subject with more after it — is not a step. The match is the whole
//   subject or nothing.

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const subjectPattern = (specFolder: string): RegExp =>
  new RegExp(
    `^Run /aide-([a-z][a-z-]*) for ${escapeRegExp(specFolder)}` +
      `(?: \\(headless\\))?(?: \\(model: ([^)]+)\\))?(?: \\(stopped: (.+)\\))?$`,
  );

export interface WorkflowHistory {
  /** Steps whose newest commit COMPLETED, in workflow order. */
  done: string[];
  /** Steps whose newest commit stopped, by step, with the reason the
   *  run gave. A step here is not in `done`: it ran, and did not
   *  finish. */
  stopped: Record<string, string>;
}

const EMPTY: WorkflowHistory = { done: [], stopped: {} };

/** What to ask git. `--all` because an `implement` commit has not
 *  landed and will not until `archive` runs — a HEAD-only log is blind
 *  to exactly the step incident 147 was about. Narrowed server-side by
 *  a FIXED string naming this spec, the way `lastAnalyzeCommit` narrows
 *  its own: cheap on a long history, and the grammar above decides the
 *  rest. */
export function workflowLogArgs(specFolder: string, boundarySha?: string): string[] {
  return [
    "log",
    "--all",
    // Spec 198. `--not <sha>` excludes every commit REACHABLE from the
    // reopen mark — exactly the earlier round, since the mark is the
    // specs repo's default-branch tip at the moment of reopening and
    // that round's commits were landed onto that branch by its own
    // archive step. A commit made AFTER the mark is a descendant, never
    // an ancestor, so the new round is untouched.
    //
    // It has to FOLLOW `--all`: `--not` names no positive rev of its
    // own, and a revision argument stops git from defaulting to HEAD —
    // so `--not <sha>` alone walks nothing at all. Measured.
    //
    // Optional, and absent for the overwhelming majority: a spec that
    // has never been reopened takes the exact call it took before this
    // parameter existed.
    ...(boundarySha ? ["--not", boundarySha] : []),
    "--format=%s",
    "--fixed-strings",
    `--grep=Run /aide-`,
    `--grep= for ${specFolder}`,
    "--all-match",
  ];
}

/** The subjects, newest first, folded into one answer per step.
 *
 *  Separated from the git call so the rule can be tested without one:
 *  what is under test here is the grammar and which commit wins, never
 *  whether git works. */
export function readWorkflowSubjects(subjects: string[], specFolder: string): WorkflowHistory {
  const pattern = subjectPattern(specFolder);
  // `git log` prints newest first, and the first sighting of a step is
  // therefore the one that speaks for it — every later line for the
  // same step is an attempt it superseded.
  const seen = new Map<string, string | null>();
  for (const line of subjects) {
    const m = line.trim().match(pattern);
    if (!m) continue;
    const step = m[1]!;
    if ((!HISTORY_STEPS.includes(step) && !HISTORY_STEPS_RETIRED.includes(step)) || seen.has(step)) continue;
    // m[2] is the model, which nothing on this side reads; m[3] is the
    // stop reason.
    seen.set(step, m[3] ?? null);
  }
  const stopped: Record<string, string> = {};
  for (const [step, reason] of seen) if (reason !== null) stopped[step] = reason;
  // Current arc order first, then retired steps: a retired step is not
  // woven back into its old position in the arc, only kept from
  // vanishing — the same order `aide-run-spec`'s bash twin produces.
  return {
    done: [...HISTORY_STEPS, ...HISTORY_STEPS_RETIRED].filter((step) => seen.get(step) === null),
    stopped,
  };
}

export interface WorkflowHistoryOptions {
  run: GitRunner;
  /** How long one answer stands. Without it, the five-second refresh of
   *  the queue would spawn a git process per spec on every tick — the
   *  same reason `DescriptionFreshnessChecker` caches. */
  ttlMs?: number;
  now?: () => number;
}

export class WorkflowHistoryChecker {
  private readonly run: GitRunner;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; history: WorkflowHistory }>();

  constructor(opts: WorkflowHistoryOptions) {
    this.run = opts.run;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** What git can PROVE this spec has had. A checkout git cannot read,
   *  a spec outside git, a timeout — all of them answer "nothing known
   *  to have run", which reads on the page as a spec still ahead of its
   *  workflow. That is visible and is fixed by running the step; a
   *  guess in the other direction is neither. */
  async read(dir: string, specFolder: string, boundarySha?: string): Promise<WorkflowHistory> {
    // JSON rather than a separator character, for the reason
    // branch-status.ts gives: a NUL here makes git treat the source
    // file as binary, and every future diff of it pays for that.
    //
    // The boundary is part of the QUESTION and so part of the key (spec
    // 198): a spec reopened while the dashboard is running would
    // otherwise answer from the pre-reopen entry for the whole TTL —
    // which is exactly the "everything shows done" the reopen exists to
    // end.
    const key = JSON.stringify([dir, specFolder, boundarySha ?? null]);
    const hit = this.cache.get(key);
    const at = this.now();
    if (hit && at - hit.at < this.ttlMs) return hit.history;

    let history = EMPTY;
    try {
      const out = await this.run(dir, workflowLogArgs(specFolder, boundarySha));
      if (out.code === 0) history = readWorkflowSubjects(out.stdout.split("\n"), specFolder);
    } catch {
      history = EMPTY;
    }

    this.cache.set(key, { at, history });
    return history;
  }

  /** The LAST history this checker holds, without asking git at all
   *  (spec 208) — the same read `peekDrift` gives the drift count, and
   *  what the spec list calls now instead of `read`.
   *
   *  `history: null` is the whole point of the shape. A real, empty
   *  history is an ANSWER — "git can prove nothing has run" — and a
   *  null one is the absence of one, which the row draws as "checking…"
   *  rather than as a spec still ahead of its workflow. A peek that
   *  handed back `EMPTY` for both would put back exactly the false
   *  negative this spec exists to stop.
   *
   *  Keyed the same way `read` keys, boundary included: the boundary is
   *  part of the QUESTION (spec 198). */
  peekHistory(dir: string, specFolder: string, boundarySha?: string): {
    history: WorkflowHistory | null;
    checkedAt: number | null;
  } {
    const hit = this.cache.get(JSON.stringify([dir, specFolder, boundarySha ?? null]));
    return hit ? { history: hit.history, checkedAt: hit.at } : { history: null, checkedAt: null };
  }
}

/** What a spec's own files claim, kept apart by source (spec 362) — the
 *  prose's own line, and the state file's `completedPhases` when this
 *  copy of the spec (disk or branch) has one. */
export interface FileStepsAnswer {
  /** What `4-status.md`'s own `Workflow steps completed` line claims. */
  proseSteps: string[];
  /** `4-status.json`'s own `completedPhases` — `undefined` when this
   *  copy of the spec's files has no state file yet (spec 355 REQ-10),
   *  the cue to keep comparing `proseSteps` against git (REQ-2). */
  stateSteps: string[] | undefined;
  /** Whether the file has an acceptance row nobody has ticked — read
   *  off the same branch copy as the steps, since a tick on a spec
   *  with an open branch is written THERE (spec-edit.ts, REQ-4) and the
   *  default branch's copy stays unticked until archive lands. The
   *  row's "archive held back" and the queue's archive hold-back read
   *  this before the disk copy; absent when the answer came off disk. */
  acceptanceOpen?: boolean;
}

/** The steps `4-status.md`'s own line and the history do not agree
 *  about.
 *
 *  Both directions count. A file naming a step with no commit behind it
 *  is spec 153's copied folder; a file missing a step git has is spec
 *  147's killed run. Neither decides anything — the row says so on the
 *  phase it is about, and goes on reading git.
 *
 *  `implement` looked like a structural exception for one release (spec
 *  299): it lands nothing of its own, so `4-status.md`'s write to this
 *  line — made on the spec's still-open branch — never reached the
 *  DEFAULT branch this used to read, and "git has implement, the file
 *  doesn't" was the guaranteed state of every such spec, not a killed
 *  run. Spec 298 fixed that at its actual source instead: `fileSteps`
 *  now follows the open branch when one exists
 *  (`withFreshness`/`branchFileSteps`), so it sees implement's own
 *  write the moment implement makes it. With the right copy of the
 *  file read, both directions are meaningful for `implement` again
 *  exactly as they are for every other step, and a real disagreement —
 *  the branch's own file still missing a step its own commit proves —
 *  is once more something this function is supposed to catch.
 *
 *  Per step rather than per spec because the row has a line per phase
 *  and one sentence repeated down all five of them is the duplication
 *  spec 143 already took off this page once.
 *
 *  Spec 355 changed what the truth is: once a spec has its own
 *  `4-status.json`, that file — not git — is what the runner's own
 *  gates read, and a git-history comparison can disagree with it for
 *  reasons that mean nothing (spec 349: an amended, unpushed commit
 *  whose content landed anyway, inside a later step's commit). So git
 *  is asked only when there is NO state file for this copy of the
 *  spec (REQ-2, unchanged); once one exists, the one thing still worth
 *  a qualifier is the prose claiming a phase the state file does not
 *  have (REQ-1, REQ-3). */
export function stepsFileDisagreesOn(fileSteps: FileStepsAnswer, history: WorkflowHistory): string[] {
  // `create` is left out of the comparison since spec 176: the queue
  // takes it as done for every spec whose folder exists, whatever git
  // holds, so comparing it against a status file would report a
  // disagreement about a step nothing disagrees on.
  const relevant = HISTORY_STEPS.filter((step) => step !== "create");
  const claimed = new Set(fileSteps.proseSteps);
  if (fileSteps.stateSteps !== undefined) {
    const known = new Set(fileSteps.stateSteps);
    return relevant.filter((step) => claimed.has(step) && !known.has(step));
  }
  return relevant.filter((step) => claimed.has(step) !== history.done.includes(step));
}

export interface BranchFileStepsOptions {
  run: GitRunner;
  ttlMs?: number;
  now?: () => number;
}

/** A spec's own claims as committed on its own open `aide/<folder>`
 *  branch (spec 298) — the file half of `stepsFileDisagreesOn`'s
 *  comparison, read from the same point in the graph the history half
 *  (`WorkflowHistoryChecker`, `git log --all`) already answers from,
 *  rather than from the default branch's stale copy. Both
 *  `4-status.md`'s prose and, alongside it, `4-status.json`'s own
 *  `completedPhases` when the branch has one (spec 362) — the state
 *  file is what a gate reads there too, and a branch mid-`implement`
 *  must not keep comparing it against git once it exists. Shaped
 *  exactly like `WorkflowHistoryChecker`: async `read`, TTL-cached, and
 *  a `peekFileSteps` a render may call without ever spawning git.
 *
 *  `null` means "no open branch, or the branch's copy could not be
 *  read" — the caller's own cue to fall back to the disk read, which is
 *  what every spec without an open branch keeps doing unchanged
 *  (REQ-3). */
export class BranchFileStepsChecker {
  private readonly run: GitRunner;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; steps: FileStepsAnswer | null; stale?: boolean }>();

  constructor(opts: BranchFileStepsOptions) {
    this.run = opts.run;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** `target` is `null` for a spec with no open branch — the caller
   *  (`warmSpec`) has already asked `resolveOpenBranchTarget`, so this
   *  class never resolves a branch itself. */
  async read(dir: string, specFolder: string, target: OpenBranchTarget | null): Promise<FileStepsAnswer | null> {
    const key = JSON.stringify([dir, specFolder]);
    const hit = this.cache.get(key);
    const at = this.now();
    if (hit && !hit.stale && at - hit.at < this.ttlMs) return hit.steps;

    let steps: FileStepsAnswer | null = null;
    if (target) {
      try {
        // Wherever the folder is ON the branch: `archive` moves it to
        // `archive/<folder>` and commits that there, so a branch whose
        // archive has run but not landed answers nothing for the active
        // path while the default branch still holds the folder in it.
        for (const relPath of [target.relPath, target.archivedRelPath]) {
          const file = await readStatusFromBranch(this.run, target.root, target.branch, relPath);
          if (!file) continue;
          // spec 362: the branch's own sibling `4-status.json`, at the
          // same place `4-status.md` sits — read alongside the prose,
          // never in its place, so `stateSteps` can stay `undefined` for
          // a branch that has none yet (REQ-2).
          const jsonPath = relPath.replace(/4-status\.md$/, "4-status.json");
          const jsonFile = await readStatusFromBranch(this.run, target.root, target.branch, jsonPath);
          const state = jsonFile ? parseSpecStateText(jsonFile.text) : null;
          steps = {
            proseSteps: parseStatus(file.text).workflowSteps,
            stateSteps: state?.completedPhases,
            acceptanceOpen: state
              ? state.acceptanceCriteria.some((row) => !row.done)
              : acceptanceCriteriaUnticked(file.text),
          };
          break;
        }
      } catch {
        steps = null;
      }
    }
    this.cache.set(key, { at, steps });
    return steps;
  }

  /** Drop one spec's cached answer, so the next `read` goes to git.
   *  The Checks tab's tick writes the very file this caches, onto the
   *  same branch it reads: without this the row went on saying "held
   *  back: the Acceptance criteria are not all ticked yet" for the rest
   *  of the TTL after a Save that ticked the last row (337,
   *  2026-09-04). */
  forget(dir: string, specFolder: string): void {
    // Marked due for a fresh read, NOT dropped: the row keeps answering
    // from it until `read` has replaced it. Dropped, the row fell back
    // to the default branch's copy of the file for as long as the
    // re-read took, and that copy still says what it said before
    // implement ran — so a tick on the Checks tab made the row announce
    // that the files disagree (425, 2026-09-09).
    const key = JSON.stringify([dir, specFolder]);
    const hit = this.cache.get(key);
    if (hit) this.cache.set(key, { ...hit, stale: true });
  }

  /** No git spawn, ever — what `withFreshness` calls. `steps: null`
   *  covers two different truths the caller does not need to tell
   *  apart: no open branch, and "not warmed yet" — both mean "fall back
   *  to the disk read" (REQ-3's own behavior, unchanged). */
  peekFileSteps(dir: string, specFolder: string): { steps: FileStepsAnswer | null; checkedAt: number | null } {
    const hit = this.cache.get(JSON.stringify([dir, specFolder]));
    return hit ? { steps: hit.steps, checkedAt: hit.at } : { steps: null, checkedAt: null };
  }
}

export interface ResolvedWorkflowState {
  done: string[];
  stopped: Record<string, string>;
  fileDisagrees: string[];
  fileSteps: string[];
  /** The raw, unmerged git answer (`h.done`): which steps have a
   *  completion commit ANYWHERE in the repo's refs, landed or not
   *  (`git log --all`). Separate from `done` (which prefers the state
   *  file when one exists) because it is exactly the signal that tells
   *  "the work is on the branch" apart from "nothing was written"
   *  (spec 418). */
  historyDone: string[];
}

/** Spec 302: the one canonical `{ done, stopped, fileDisagrees, fileSteps }`
 *  a spec's steps resolve to — the `create` special case included — built
 *  from the same two peeks `withFreshness` used to assemble by hand.
 *  `null` when nothing has asked git about this spec yet (the caller's
 *  own cue to draw "checking…" rather than a false negative). */
export function resolveWorkflowState(
  history: WorkflowHistoryChecker,
  branchFileSteps: BranchFileStepsChecker,
  dir: string,
  specFolder: string,
  reopenedAfter: string | undefined,
  diskFileSteps: FileStepsAnswer | undefined,
): ResolvedWorkflowState | null {
  const { history: h, checkedAt } = history.peekHistory(dir, specFolder, reopenedAfter);
  if (h === null || checkedAt === null) return null;
  const branchSteps = branchFileSteps.peekFileSteps(dir, specFolder).steps;
  const answer = branchSteps ?? diskFileSteps ?? { proseSteps: [], stateSteps: undefined };
  // REQ-4: the state file is what a gate reads, so it is what the pips
  // and the done list read too, once one exists — git's own
  // `history.done` only when there is no state file for this spec yet.
  const doneSource = answer.stateSteps ?? h.done;
  const done = doneSource.includes("create") ? doneSource : ["create", ...doneSource];
  return {
    done,
    stopped: h.stopped,
    fileDisagrees: stepsFileDisagreesOn(answer, h),
    fileSteps: answer.proseSteps,
    historyDone: h.done,
  };
}
