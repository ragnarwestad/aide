// The facts the board keeps about a live spec: built by the scan, given
// git's history by the freshness pass, drawn by the pages and decided from
// by the queue's rules. Two details are read from files only when called,
// so a copy of the facts never reads them.

import type { FileStepsAnswer } from "../git/workflow-history.ts";
import type { StatusCheck } from "./parse-status";
import type { SpecGroupMembership } from "./discover/group.ts";
import type { CreateChoices } from "./discover";
import type { Approach } from "./approach-choice.ts";

export interface SpecTarget {
  project: string;
  specFolder: string;
  title?: string;
  /** How many Acceptance rows are marked Not verified. */
  notVerified?: number;
  /** How many Acceptance rows are marked Failed. */
  failed?: number;
  /** The four settings the spec was created with; absent before the scan
   *  has read its 1-description.md. */
  createChoices?: CreateChoices;
  /** What the spec is about, from `## Description` in 1-description.md.
   *  Shown on the job page, so a reader stops leaving the dashboard to
   *  find out what a job called `02-job-detail-view` actually is. */
  description?: string;
  phase?: string;
  /** The `## Acceptance criteria` heading with an open row, from the
   *  SAME parse that produced `phase` — request-scoped, on
   *  `specPageView`'s own local `target`, never on the shared
   *  five-second scan `phase` itself comes from. */
  acceptancePhase?: string;
  /** What this spec builds on, from its own `Depends on:` line.
   *  Named by folder, the way `aide-run-spec`'s own dependency
   *  refusal names it. Empty or absent when it names none. */
  dependsOn?: string[];
  group?: SpecGroupMembership;
  /** Steps this spec has already had, from the runner's own commits
   *  Marked, never forbidden. */
  done?: string[];
  /** Steps whose latest commit STOPPED, by step, with the reason —
   *  `timeout`, `provider-limit`. Such a step has run and has not
   *  finished, and the row says so instead of "not run yet" even once
   *  the queue's own memory of that attempt is gone. */
  stopped?: Record<string, string>;
  /** What the spec's own files claim, kept apart by source:
   *  `4-status.md`'s prose line, and `4-status.json`'s own
   *  `completedPhases` when this spec has a state file. Not what
   *  anything is decided from — the history above is, unless a state
   *  file exists, in which case IT is (`resolveWorkflowState`) — but
   *  the row wears a qualifier when the sources disagree, which is how
   *  a copied folder, a killed run, or a stale hand-edited prose line
   *  becomes visible rather than silently wrong. */
  fileSteps?: FileStepsAnswer;
  /** The steps the file and the history do not agree about — said on
   *  the phase line it is about, never once per phase. */
  fileDisagrees?: string[];
  /** When the files and history above were last read; a run ended after this is not yet in them. */
  sourcesCheckedAt?: string;
  /** Which steps have a completion commit ANYWHERE in git —
   *  the raw answer, before a state file's own claim can override it.
   *  What tells "the work is on the branch, unlanded" apart from
   *  "nothing was written" for `wordPhase.lastRunDisagrees*`. */
  historyDone?: string[];
  /** Steps a completed analyze cancelled, as git proves it (`superseded`
   *  of the workflow history) — an earlier implement's queue attempts and
   *  stamped file are not a run of the phase while it is named here. */
  superseded?: string[];
  /** Where the spec's folder is on this machine. Server-side only — it
   *  is what the freshness check runs git in, and an absolute path has
   *  no business on a page. */
  dir?: string;
  /** The commit this spec's history starts AFTER, from its own
   *  `**Reopened:**` mark. Server-side only, like `dir`: it
   *  is what the two git readers exclude with `--not`, so that a spec
   *  reopened for another round shows no phase as run before anything
   *  has run in it. Absent for the overwhelming majority. */
  reopenedAfter?: string;
  /** The description was committed after the last finished analyze, so
   *  the plan on disk describes an older problem than the description
   *  states. Derived live at render time, never stored, exactly like
   *  the merge check: a re-run clears it by being newer. */
  analyzeStale?: boolean;
  /** When this spec was MADE — the first commit that touched its folder
   *  It is what the "Started" column holds and what the
   *  `started` sort orders by, and it comes from git rather than from
   *  any job: a job's own start moves every time a phase runs, and the
   *  queue forgets a job once two hundred newer ones exist. Absent when
   *  git could not answer, and then the cell shows a dash — never a
   *  job's time, which would put the movement straight back. */
  createdAt?: string;
  /** Why the last archive run did NOT move the folder, from the spec's
   *  own `## Archive held back` section. Archive is the one phase whose
   *  file-truth is always false for a row still on this page — a spec
   *  whose folder moved has left the list — so "held back, and why" is
   *  the only file-side answer archive has to give. */
  archiveHeldBack?: { reason: string };
  /** An acceptance criterion open NOW, as the Checks tab last wrote it. */
  acceptanceOpen?: boolean;
  /** Reopened with the files kept and its round still open:
   *  its `4-status.md` reads `reopenedRound()`. */
  reopenedRound?: boolean;
  /** The Acceptance rows the list unfolds, read from files when called,
   *  the branch copy before the checkout: present while one is open,
   *  waiting for a check or failed, undefined otherwise. */
  readAcceptance?: () => StatusCheck[] | undefined;
  /** The approaches waiting for a choice, in the plan's order, read from
   *  files when called, the branch's plan before the checkout's:
   *  undefined when no choice waits. */
  readApproachChoice?: () => Approach[] | undefined;
  /** No `4-status.json` exists for this spec yet — a
   *  spec no writer script (aide-run-spec, aide-archive-spec,
   *  aide-write-spec) has touched since this feature shipped. The row
   *  still shows; it is labeled as missing its state file rather than
   *  silently falling back to a fresh parse of the prose beside it. */
  stateMissing?: boolean;
}

/** What the execution-group rules decide from. */
export type GroupFacts = Pick<SpecTarget,
  "project" | "specFolder" | "group" | "done" | "historyDone" | "acceptancePhase" | "dependsOn">;

/** The facts with history or a round added. The details read from files
 *  are carried over as functions, still unread. */
export function withSpecFacts<T extends SpecTarget>(facts: T, added: Partial<SpecTarget>): T {
  return { ...facts, ...added };
}
