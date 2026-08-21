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

const DEFAULT_TTL_MS = 30_000;

/** The five stages a spec passes through, in workflow order — the same
 *  list `parse-status.ts` reads off the file, and deliberately NOT the
 *  eight the runner will execute: `explore`, `manifest` and `resolve`
 *  are things you can queue, not places a spec gets to. */
export const HISTORY_STEPS = ["create", "analyze", "review-plan", "implement", "archive"];

// --- the commit-subject grammar ---------------------------------------------
//
// THIS BLOCK IS COPIED VERBATIM into `core/scripts/aide-run-spec`, which
// derives the same answer in bash to write the file's own line. Two
// implementations of one rule, in two languages, the way
// `WORKFLOW_STEPS` and `DEPENDENCY_GATED_STEPS` already are — change
// one and the other has to change with it.
//
//     Run /aide-<step> for <spec-folder>[ (headless)][ (stopped: <reason>)]
//
// - `<step>` is the step's own name, `review-plan` hyphen included.
// - `<spec-folder>` is the folder, never the numeric id: a `create` run
//   names the folder it just made.
// - ` (headless)` is present for a run `aide-run-spec` made and absent
//   for one committed at somebody's keyboard. Both count.
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
      `(?: \\(headless\\))?(?: \\(stopped: (.+)\\))?$`,
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
export function workflowLogArgs(specFolder: string): string[] {
  return ["log", "--all", "--format=%s", "--fixed-strings", `--grep=Run /aide-`, `--grep= for ${specFolder}`, "--all-match"];
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
    if (!HISTORY_STEPS.includes(step) || seen.has(step)) continue;
    seen.set(step, m[2] ?? null);
  }
  const stopped: Record<string, string> = {};
  for (const [step, reason] of seen) if (reason !== null) stopped[step] = reason;
  return {
    done: HISTORY_STEPS.filter((step) => seen.get(step) === null),
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
  async read(dir: string, specFolder: string): Promise<WorkflowHistory> {
    // JSON rather than a separator character, for the reason
    // branch-status.ts gives: a NUL here makes git treat the source
    // file as binary, and every future diff of it pays for that.
    const key = JSON.stringify([dir, specFolder]);
    const hit = this.cache.get(key);
    const at = this.now();
    if (hit && at - hit.at < this.ttlMs) return hit.history;

    let history = EMPTY;
    try {
      const out = await this.run(dir, workflowLogArgs(specFolder));
      if (out.code === 0) history = readWorkflowSubjects(out.stdout.split("\n"), specFolder);
    } catch {
      history = EMPTY;
    }

    this.cache.set(key, { at, history });
    return history;
  }
}

/** The steps `4-status.md`'s own line and the history do not agree
 *  about.
 *
 *  Both directions count. A file naming a step with no commit behind it
 *  is spec 153's copied folder; a file missing a step git has is spec
 *  147's killed run. Neither decides anything — the row says so on the
 *  phase it is about, and goes on reading git.
 *
 *  Per step rather than per spec because the row has a line per phase
 *  and one sentence repeated down all five of them is the duplication
 *  spec 143 already took off this page once. */
export function stepsFileDisagreesOn(fileSteps: string[], history: WorkflowHistory): string[] {
  const claimed = new Set(fileSteps);
  return HISTORY_STEPS.filter((step) => claimed.has(step) !== history.done.includes(step));
}
