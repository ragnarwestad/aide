// The one rule for what a phase shows (spec 108).

import type { BadgeVariant, PipKind } from "../components.ts";
import { renderMessage } from "../../../i18n/message.ts";
import type { MessageKey } from "../../../i18n/messages.ts";
import type { Language } from "../../../i18n";
import { t } from "../../../i18n";
import { BADGE_VARIANT, currentStep, inFlight, stateLabel } from "./format.ts";
import { gerund } from "./resting.ts";
import type { QueueRowView } from "./types.ts";

/** The reasons a step declines, each as the sentence a reader can act
 *  on. The commit subject records the script's own token — `(stopped:
 *  not-implemented-yet)` — and a row that prints that token makes the
 *  reader translate machine words and names no move. A token not listed
 *  is passed through unchanged: said plainly, it beats a guess at what
 *  it means. */
const STOP_SENTENCES: Record<string, MessageKey> = {
  "not-implemented-yet": "wordPhase.stopNotImplementedYet",
  "acceptance-criteria-unticked": "wordPhase.stopAcceptanceCriteriaUnticked",
  "no-passing-test-record": "wordPhase.stopNoPassingTestRecord",
  "already-archived": "wordPhase.stopAlreadyArchived",
  "conflict-open": "wordPhase.stopConflictOpen",
};

export const stopSentence = (reason: string, lang: Language = "en"): string => {
  const key = STOP_SENTENCES[reason];
  return key ? renderMessage(lang, { key }) : reason;
};

/** What one phase reads as, in the three parts a row and a job page
 *  both need: the pip, the word in the badge, and — only when the last
 *  attempt disagrees with the file — a qualifier. */
export interface PhaseWord {
  pip: PipKind;
  /** Absent means "nothing has happened and nothing was attempted" —
   *  the row's "not run yet". */
  badge?: { variant: BadgeVariant; label: string };
  /** Said only when the last attempt disagrees with the truth above.
   *  Never repeats what the badge already says.
   *
   *  A sentence, not a word — so the phase LINE never draws it. The
   *  caller hands it to the row's panel instead, named for its phase
   *  (`specNotice`, spec 195); on the queue list a phase line is the
   *  badge and nothing else, whatever has happened to that phase. */
  qualifier?: string;
}

/** The sentence for "these two records do not agree about this spec"
 *  (spec 154). Deliberately the same words the job-history version
 *  below uses — a reader has one thing to learn, and the file is the
 *  half that is wrong in both cases. */
const filesDisagreeSentence = (lang: Language): string => renderMessage(lang, { key: "wordPhase.filesDisagree" });

/** The sentence for a last attempt that disagrees with the file (spec
 *  280): an `unlanded` failure is its own, specific story — the spec
 *  DID archive, but landing it failed and its branch is still open —
 *  not the generic "last re-run failed" every other failure kind
 *  shares. Attributing that generic sentence to whichever phase's badge
 *  happens to be drawing it is what let a genuinely successful
 *  `implement` phase's unrelated note hide `archive`'s real failure.
 *  Its resolution matches `notLandedTitle()`'s own "re-run archive"
 *  (cell-helpers.ts, REQ-1, spec 352) — the same fact worded two ways
 *  is what a plan review flagged as the clearest sign no shared
 *  convention existed yet. */
const attemptQualifier = (attempt: QueueRowView, lang: Language): string =>
  attempt.errorReason === "unlanded"
    ? renderMessage(lang, { key: "wordPhase.attemptQualifierUnlanded" })
    : t(lang, "list.lastRerun").replace("{state}", stateLabel(attempt, lang));

/** The one rule, applied by everything that words a phase.
 *
 *  A row for spec 81 once said three things at once: pips and phase
 *  lines read the JOB HISTORY (a cancelled July re-run spoke for an
 *  analysis long since done and merged), the checkbox read the files
 *  unioned with that history, and archive read "done" off a job that
 *  had finished without moving anything.
 *
 *  So: `happened` — from the spec's own FILES — is what the phase IS.
 *  `heldBack` is archive's own answer to a question no exit status can
 *  give (see `archiveHeldBackReason`). The `attempt` is a qualifier
 *  layered on top, never the phase's state.
 *
 *  The last branch is worded exactly as the row always worded an
 *  attempt, with one exception: a job whose own state is `"done"` while
 *  the files say the phase has NOT happened would otherwise render the
 *  same badge as the first branch's real thing — the precise ambiguity
 *  this exists to remove. That one state goes in the qualifier instead;
 *  no other state's label collides with a file-truth badge. */
export function wordPhase(
  happened: boolean,
  heldBack: { reason: string } | undefined,
  attempt: QueueRowView | undefined,
  /** What the spec's own git history says about this phase, beyond
   *  whether it happened (spec 154). `stopped` is the reason the last
   *  run for this phase gave for not finishing; `fileDisagrees` is
   *  `4-status.md` claiming something the history does not show, or the
   *  reverse. */
  history: {
    stopped?: string;
    fileDisagrees?: boolean;
    fileResult?: "completed" | "stopped";
    /** Whether a completion commit for this phase exists anywhere in
     *  git (spec 418) — what tells the two situations behind "last run
     *  reported done, but the files disagree" apart: the work is on an
     *  unlanded branch, or nothing was written at all. */
    historyDone?: boolean;
  } = {},
  lang: Language = "en",
): PhaseWord {
  const running = !!attempt && inFlight(attempt);
  const disagrees = !!attempt && !running && attempt.state !== "done";
  // Said when the file and the history part company, and never over a
  // qualifier that has something sharper to say: an attempt that ended
  // badly is the more useful sentence, and two sentences about one
  // phase is the row saying two things at once.
  const filesDisagree = history.fileDisagrees ? filesDisagreeSentence(lang) : undefined;
  // A phase that is running says so, whatever happened the last time it
  // ran. The history's "done" is about a previous attempt; this one is
  // in flight, and a line reading "done · 2 attempts" over a spec the
  // State column says is archiving is the row saying two things at once
  // (reported 2026-08-23). Only the pip moved before, and a pip is not
  // a word.
  if (running) {
    // A step whose own process already ended is still "running" from a
    // reader's chair while its work is being merged (spec 395, REQ-2):
    // `attempt.state` reads "done" the instant the process exits, well
    // before `attempt.landing` clears, and a badge built from `state`
    // alone would say so. The word is the SAME gerund `specStateChip`
    // already draws for the row above this line (`resting.ts`), so a
    // reader never sees the row and the phase name the wait two ways.
    if (attempt!.landing) {
      return {
        pip: "now",
        badge: { variant: "running", label: gerund(lang, currentStep(attempt!)) },
        qualifier: filesDisagree,
      };
    }
    return {
      pip: "now",
      badge: {
        variant: BADGE_VARIANT[attempt!.state],
        // Which third of an implement is running, in the word as well as
        // on the pip (spec 210): "running" for an hour says nothing, and
        // the State column reserves its width already, so the longer
        // word moves nothing outside it. Only implement reports phases,
        // so only implement's rows are given one (`jobRow`, serve.ts).
        //
        // The state, not `running` above: that flag is `inFlight`, which
        // is queued OR running, and a job WAITING to start is in no TDD
        // phase at all. "queued (refactor)" would be the row reading a
        // leftover report as if it were live.
        label:
          attempt!.tddPhase && attempt!.state === "running"
            ? `${stateLabel(attempt!, lang)} (${attempt!.tddPhase})`
            : stateLabel(attempt!, lang),
      },
      qualifier: filesDisagree,
    };
  }
  if (happened) {
    return {
      pip: running ? "now" : "past",
      badge: { variant: "done", label: "done" },
      qualifier: disagrees ? attemptQualifier(attempt!, lang) : filesDisagree,
    };
  }
  // Not while something is running: a note from an earlier decline must
  // not upstage the retry that may be clearing it, and a pip reading
  // "now" beside a badge reading "held back" is the row saying two
  // things at once — the whole reason this function exists.
  if (heldBack && !running) {
    return {
      pip: "todo",
      // The sixth variant, not a seventh: "held back" is a common,
      // healthy outcome — notice, not alarm — which is the same reason
      // `stopped` takes this amber.
      badge: { variant: "waiting", label: "held back" },
      // Not the reason: it is a sentence, and the row's panel says it
      // once for the whole row (spec 143). Said here as well, it was
      // the same 130 characters twice on an open row — the duplication
      // 1-description.md reports.
      qualifier: disagrees ? attemptQualifier(attempt!, lang) : filesDisagree,
    };
  }
  // A step that RAN and did not finish, with nothing live left to say
  // so (spec 154). Spec 147's implement was killed by its own time
  // limit with RED and GREEN committed on the branch, and by the time
  // anyone read the row the queue's memory of that attempt was gone —
  // so the row said "not run yet" about work that was on disk. The
  // commit is what still knows, and it says why.
  //
  // Checked whether or not a live attempt exists (spec 299): a
  // graceful decline — `not-implemented-yet`, `acceptance-criteria-
  // unticked` — leaves the queue's own attempt reading `"done"`
  // (nothing failed; the script simply declined), while the commit
  // still carries the real reason. Without this check that combination
  // fell through to the branch below and read as an unexplained
  // "last run reported done, but the files disagree" — alarming, and
  // wrong, about a run that said exactly what happened.
  if (history.stopped) {
    return {
      // Amber, the same variant a stopped JOB takes (BADGE_VARIANT) —
      // notice, not alarm: the work is committed and the step can be
      // run again.
      pip: running ? "now" : "todo",
      // The word alone in the badge; the reason is the row's error line
      // (spec 339: the State column says where a spec stands, errors go
      // in the error line).
      badge: { variant: "waiting", label: "stopped" },
      qualifier: `${t(lang, "state.stopped")}: ${stopSentence(history.stopped, lang)}`,
    };
  }
  // The queue has no job for this phase, and the git-verified history
  // names none: the LAST place that knows anything is the phase's own
  // file, which records what its run came to (`Result:`). Read here and
  // nowhere else — it is the run's own claim about itself, never proof
  // the work landed, so it can only speak where the two that are proof
  // have nothing to say. Without it the cell drew a dash for a phase
  // its own file says ran.
  if (!attempt) {
    if (history.fileResult === "completed") {
      return { pip: "past", badge: { variant: "done", label: "done" }, qualifier: filesDisagree };
    }
    if (history.fileResult === "stopped") {
      return { pip: "todo", badge: { variant: "waiting", label: "stopped" }, qualifier: filesDisagree };
    }
    return { pip: "todo", qualifier: filesDisagree };
  }
  if (attempt.state === "done") {
    return {
      pip: running ? "now" : "todo",
      // The step RAN — its own attempt says so, and the Time column
      // beside this one draws that run's duration. A badge-less cell is
      // a dash, and a dash means one thing on this page: no value,
      // because nothing ran. So the word is the attempt's own.
      //
      // Amber, never the green a landed phase takes: the files do not
      // agree with this run yet, whether its work is sitting on the
      // branch or was never written at all, and the row's own message
      // says which. Green here would read as "landed, nothing to do".
      badge: { variant: "waiting", label: stateLabel(attempt, lang) },
      qualifier: renderMessage(lang, {
        key: history.historyDone ? "wordPhase.lastRunDisagreesUnlanded" : "wordPhase.lastRunDisagreesUnwritten",
      }),
    };
  }
  return {
    pip: running ? "now" : "todo",
    badge: { variant: BADGE_VARIANT[attempt.state], label: stateLabel(attempt, lang) },
  };
}
