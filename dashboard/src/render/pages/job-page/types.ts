// The job page's own view types. Split out of job-page.ts by theme.

import type { QueueRowView } from "../../ui/job-state.ts";

export interface JobStepResultView {
  step?: string;
  ok: boolean;
  costUsd: number;
  /** Which CLI ran this step (spec 125). Absent means claude — every
   *  result written before the second tool existed says nothing here,
   *  and claude is what ran it. `none` is a `create` step that skipped
   *  the AI session entirely (spec 433). */
  tool?: "claude" | "codex" | "fake-claude" | "none";
  /** This step's token total, absent when the run did not measure one
   *  (spec 118). A number, like the list's own view: the page shows a
   *  compact total, not the stored split. */
  tokens?: number;
  costMeasured: boolean;
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  /** Absent while this step's own work is still landing (spec 395) — see
   *  `StepResult.at`, the field this is built from. */
  at?: string;
  /** This step's OWN transcript, already-escaped (spec 240) — read from
   *  its own `streamFile` (`queue.ts:143`), never the job's live
   *  pointer. Absent when the step wrote no transcript of its own (a
   *  refused run, or one older than the field existing). */
  logs?: string[];
  /** Which attempt (job) ran this step, oldest = 1 (spec 242). Absent
   *  when the spec this row belongs to has only ever run once — nothing
   *  to disambiguate, so nothing is drawn. This page's own single-job
   *  table never sets this; only `spec-page.ts`'s flattened, multi-job
   *  Steps tab does. */
  attempt?: number;
}

/** A spec's own file, or one section of one, as it stands on disk
 *  (spec 150). Shown preformatted and escaped: rendering markdown to
 *  HTML is its own decision and was put out of scope, and seeing which
 *  version is up needs the text, not a rendering of it.
 *
 *  `text: null` is "not written yet" — three of the four files are
 *  legitimately absent halfway through the workflow, and the page says
 *  so rather than showing an empty box.
 *
 *  `sha`/`at` are the commit that last touched the file. Absent when
 *  nobody asked git: the SPEC page stamps all four, because "which
 *  version is on the screen" is the question its Update button exists
 *  for; a job page shows one file and asks git nothing. */
export interface SpecFileView {
  /** How the panel names it — a file, or a file and the one section of
   *  it being shown. */
  label: string;
  text: string | null;
  sha?: string;
  at?: string;
  /** Nobody has yet asked git which commit this file is at (spec 208).
   *  A different state from "git could not say": that one shows no
   *  stamp at all, exactly as it did before the answer was cached, and
   *  this one says so. Set only by the SPEC page, which is the one that
   *  asks. */
  checking?: boolean;
}

export interface JobDetailView extends QueueRowView {
  /** Which CLI is running (or last ran) this job's current step. Absent
   *  means claude. `none` is a finished `create` step that skipped the
   *  AI session entirely (spec 433) — never a step actually IN FLIGHT,
   *  since a running step's tool always names a real CLI (`runningStep`
   *  is resolved from the config's own model choice, which has no "none"
   *  entry). */
  tool?: "claude" | "codex" | "fake-claude" | "none";
  /** The spec's H1. */
  title?: string;
  finishedAt?: string;
  results: JobStepResultView[];
  /** What THIS job's step wrote (spec 150): analyze's 3-solution.md
   *  (plan and, once the reviewer routine has run, its "Plan review"
   *  section too — spec 181), implement's 4-status.md, archive's one
   *  outcome. Absent for a step that writes no file of its own — the
   *  page then shows its three facts and nothing else. */
  phase?: SpecFileView;
  /** Why the spec's archive run did not move the folder (spec 108).
   *  Read off the SPEC's `4-status.md`, exactly as the list's row reads
   *  it, so the two pages cannot word the same fact differently. */
  archiveHeldBack?: string;
  /** The step running RIGHT NOW, when one is (spec 240). It has no
   *  `JobStepResultView` yet — a step only gets one when it ends — so
   *  it cannot live in `results`, and its transcript is the job's own
   *  live pointer, not a finished step's file. */
  runningStep?: { step: string; sessionId?: string; logs: string[]; attempt?: number };
  /** Where "← Back" goes (spec 252) — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. */
  backHref?: string;
}
