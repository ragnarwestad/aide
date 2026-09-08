// The small cells a spec's header row and phase lines share: state,
// duration, cost, and the marks an archived row's date cell carries.

import { CHECKING, badge, pips, stepLabel, type BadgeVariant, type MessageVariant } from "../../ui/components.ts";
import { esc, relTimeLabel, usdOrTokens } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { renderSentence } from "../../../i18n/message.ts";
import {
  completedThirds,
  durationLabel,
  inFlight,
  specStateChip,
  wordPhase,
  type PhaseWord,
  type QueueRowView,
  type RestingState,
} from "../../ui/job-state.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../project/parse-status.ts";
import { specPagePath } from "../spec-page.ts";
import { phaseDuration, type ArchivedSpecView, type Phase, type SpecGroup } from "./data-model.ts";
import { LANDING_FAILED, NO_PULL_REQUEST, NOT_PUSHED, PULL_REQUEST, TEST_SERVER, TESTS_RED } from "./row-shared.ts";

// The two cells the header line and the phase lines fill the same way.
// A spec's state and a phase's state are the same question asked at two
// altitudes, and they must never be worded differently.
// Spec 143: the job's own error is NOT written here any more. It is a
// sentence a runner wrote — "the specs tree is dirty: /Users/…" — and
// this cell is sized for a badge, so it went off the right edge of the
// table. The row's panel says it instead (`specNoticeRow`).
export const stateCell = (r: QueueRowView, lang: Language, resting: RestingState = {}): string =>
  specStateChip(r, lang, resting);

// The same two-part shape, for a PHASE — whose state is the file's
// answer (`wordPhase`), not the last job's. No badge at all means the
// phase has neither happened nor been attempted. The attempt's own
// error text is NOT repeated here since spec 143: the row's panel says
// it once for the whole row, and the phase's own detail page — which
// this line links to — carries it in Activity, where that phase
// already reports what it did.
export const phaseWordCell = (
  w: PhaseWord,
  /** Marks that belong to the phase's STATE but used to be written on
   *  its name cell, beside the model picker: the stale-description
   *  badge and the attempt count. Out there they had no width of their
   *  own, so two lines of free text stretched the name column and took
   *  the whole table sideways with it (seen 2026-08-20). Whether the
   *  State cell is their long-term home is still open; not stretching
   *  the table is not.
   *
   *  BESIDE the badge, not under it (spec 176). A `<div>` of its own
   *  made a phase line carrying a note taller than one without, so
   *  everything down the row moved the moment a second attempt
   *  started — and the page's own rule is that nothing moves because
   *  something else changed. The mark brings its own `<span>`, so it
   *  needs no wrapper of ours. */
  aside = "",
  /** How many times this phase has been run, when it is more than once.
   *  Inside the badge — "done (2)" — rather than beside it: two marks
   *  for one fact read as two facts, and the pill is where the phase's
   *  own state is said. The word is in the badge's title, since "(2)"
   *  alone does not say what it counts. */
  attempts = 0,
): string =>
  // `w.qualifier` is NOT drawn here, and there is nowhere in this cell
  // it could be (spec 195). It is a sentence, and spec 176's "beside
  // the badge" trick is only open to marks a word wide: a badge is
  // `nowrap`, so a sentence beside one runs off the right edge of the
  // table. Under the badge it made this line taller than the phase
  // lines around it — the last place on the page where something moved
  // because something else changed, reported four times. The row's
  // panel says it instead (`phaseDisagreement`/`specNoticeRow`), once
  // for the whole spec and named for the phase it is about, so a phase
  // line is one line in every state a phase can be in.
  (w.badge
    ? badge(
        w.badge.variant,
        attempts > 1 ? `${w.badge.label} (${attempts})` : w.badge.label,
        attempts > 1 ? `${attempts} attempts` : undefined,
      )
    // A dash, the same one Created and Cost draw for "nothing here"
    // (2026-09-08): the sentence "not run yet" said in words what an
    // empty state cell says by being empty, in the column where every
    // other row carries one word.
    // A phase CAN have attempts behind it and still read as nothing:
    // the FILES decide the word, and two failed runs leave them saying
    // nothing happened. The count rides on the dash then, the same way
    // it rides in the badge above.
    : `<span class="muted small"${attempts > 1 ? ` title="${attempts} attempts"` : ""}>` +
      `–${attempts > 1 ? ` (${attempts})` : ""}</span>`) +
  (aside ? ` ${aside}` : "");

/** The spec header row's own time cell: what its phases have come to so
 *  far, summed (spec 199, spec 281, spec 340).
 *
 *  Not "when the spec was made" any more — that read as a second,
 *  unrelated clock next to Cost, which already sums live — and not
 *  gated on the workflow being finished: a spec still missing a phase,
 *  or stopped by an error, has genuinely spent whatever its settled
 *  phases show, and this cell says so rather than a bare dash. While a
 *  phase is running, `data-elapsed` mirrors `phaseDurationCell` exactly
 *  so the page's own per-second tick (`queue-client.ts`) counts this
 *  cell up too, with no further server involvement. */
export function activeDurationCell(g: SpecGroup): string {
  const ms = g.totalDurationMs ?? 0;
  // `0s`, never a dash: the column answers "how long", and nothing
  // recorded is an answer to that question. A dash reads as "unknown",
  // which is a different thing and one this cell never means.
  const text = esc(durationLabel(Math.max(0, ms)));
  return g.totalDurationSince
    ? `<span class="archive-duration" data-elapsed="${esc(g.totalDurationSince)}">${text}</span>`
    : `<span class="archive-duration">${text}</span>`;
}

/** One phase line's time cell: how long that phase took, or how long it
 *  has been going (spec 199).
 *
 *  A running one carries `data-elapsed` — the instant to count up from
 *  — and the page's own clock rewrites the text once a second from
 *  there. The server still writes a figure into it, so the cell says
 *  something with script switched off; and the mark is a `<span>` of
 *  fixed content in a cell that is already there, so a phase starting
 *  or stopping moves nothing on the page around it. */
export function phaseDurationCell(latest: QueueRowView | undefined, step: string, now: number): string {
  const d = latest ? phaseDuration(latest, step, now) : null;
  // Empty when the QUEUE has nothing to say, so the caller can fall back
  // to the phase file's own `Time spent:` stamp (spec 284) — `create`'s
  // is the only record there is for a phase no job ever ran. The `0s`
  // every phase ends up showing is written once, after that fallback,
  // rather than here where it would swallow the stamp.
  if (!d) return "";
  const text = durationLabel(d.ms);
  return d.live
    ? `<span class="muted small" data-elapsed="${esc(d.since)}">${text}</span>`
    : `<span class="muted small">${text}</span>`;
}

// `blank` because a header with nothing spent still owes the reader a
// dash, while an empty phase line should simply be empty. That
// distinction is the whole reason this takes a parameter the shared
// formatter does not — everything else about the cell is `usdOrTokens`,
// which is where the dollar/token pair is decided for the whole site.
// `unmeasured` marks a figure that includes a stand-in: a stopped step
// is charged its whole budget because a SIGKILLed run prints no usage,
// and a total that says nothing about it reads as money spent (spec
// 152). The same "est." the job page's Steps table has shown per step
// since spec 118.
export const costCell = (
  spentUsd: number,
  spentTokens: number | undefined,
  blank: string,
  unmeasured?: boolean,
): string =>
  spentUsd > 0 || (spentTokens ?? 0) > 0
    ? usdOrTokens(spentUsd || undefined, spentTokens) + (unmeasured ? ' <span class="muted small">est.</span>' : "")
    : blank;

/** One pip per phase: green for a phase that has run, the accent for the
 *  one running now, grey for a phase still ahead. There is no failure
 *  colour in the strip: a pip says how far the workflow got, and what
 *  went wrong is the badge's and the row message's to say. The whole workflow in six
 *  millimetres, on the line you are already reading — shared by the
 *  list's own row and the spec page's Overview tab (spec 239), so the
 *  two can never show a different chain for the same spec.
 *
 *  `create` had no pip from spec 116 until spec 167: the glance was
 *  about the four phases a reader can still RUN. The hole made create
 *  read as a different kind of thing rather than as the phase already
 *  behind you — the same reason the phase line got a box of its own on
 *  2026-08-21 — so it is a pip like the other four now.
 *
 *  It does not go through `wordPhase` with them, though: create has
 *  only two states, past and running. A spec that exists was created,
 *  so the pip is past unless a create job is in flight right now.
 *  `done` used to be the reason — it comes from the git history, which
 *  counts only the runner's own `Run /aide-<step> for <folder>` commits,
 *  and a spec written by hand has no create commit, so every one of
 *  those showed a grey pip saying the spec had not been made yet. Spec
 *  176 closed that gap one layer down (`withFreshness` puts create into
 *  the set for any spec whose folder is on disk), so the phase LINE
 *  agrees now; the two states above are what is left. */
export function phasePips(phases: Phase[], done: string[]): string {
  const createRunning = phases.find((p) => p.step === "create")?.attempts.some(inFlight);
  return pips(
    phases.map((p) => {
      // One rule, one function: what the FILES say, qualified by the
      // most relevant attempt (whatever is in flight, else the latest).
      // The pips used to read the job history alone, so a spec analysed
      // by hand showed four grey pips and a cancelled re-run turned a
      // finished phase grey again.
      const attempt = p.attempts.find(inFlight) ?? p.attempts[0];
      return {
        kind:
          p.step === "create"
            ? createRunning
              ? "now"
              : "past"
            : wordPhase(done.includes(p.step), p.heldBack, attempt, p.history).pip,
        title: stepLabel(p.step),
        // How much of a running implement is behind it (spec 210). The
        // fallback above is the latest attempt whatever became of it,
        // so the "only while it runs" half of the rule is what keeps a
        // stale phase from filling a pip for work that has stopped —
        // and that half lives in `completedThirds`, once.
        third: completedThirds(attempt),
      };
    }),
  );
}

/** What an archived row's duration cells share (spec 410, REQ-4): a
 *  mark for a total that leaned on a phase's own file stamp rather than
 *  a queue-measured span for it, since that stamp is the AI session's
 *  own duration alone — no worktree, commit or push around it — and is
 *  not the phase's whole time the rest of this column means.
 *
 *  Archived-only by construction: `activeDurationCell` never calls
 *  this, and `lockedDuration` only passes a true flag when `locked`
 *  (`phase-rows.ts`) — REQ-4's own wording names an archived spec
 *  specifically, so a live row's own rare version of the same fallback
 *  (a phase no queue job ever ran) stays unmarked, as it is today. */
const SESSION_ONLY_TITLE =
  "the AI session's own time only — the queue has no external measurement of this phase to prefer";

export const sessionOnlyMark = (show: boolean): string =>
  show ? ` <span class="muted small" title="${esc(SESSION_ONLY_TITLE)}">part.</span>` : "";

/** The Time column for a locked row: how long the work took, and never
 *  anything else. A date here is a different question wearing the
 *  column's clothes, and an empty cell asks whether anything ran — so a
 *  spec whose phases summed to nothing reads `0s`, the same as an active
 *  row's. */
export function archiveDateCell(durationMs: number, sessionOnly: boolean): string {
  return (
    `<span class="archive-duration">${esc(durationLabel(Math.max(0, durationMs)))}</span>` +
    sessionOnlyMark(sessionOnly)
  );
}

/** When the spec was MADE (spec 317, REQ-1/REQ-4). One call for either
 *  kind of row (REQ-6) — `SpecGroup.createdAt`/`createdAtChecking`
 *  already carry the archived-row answer by the time this is called,
 *  copied up by `readerGroup()`.
 *
 *  A dash where git has no answer, never the words "date unknown": the
 *  cache is cold for a moment on every restart, and a row that ANNOUNCES
 *  a failure it is about to recover from teaches the reader to distrust
 *  the column. "checking…" still stands while the question is out, since
 *  that one says an answer is coming. */
export function createdCell(createdAt: string | undefined, checking: boolean): string {
  if (createdAt) return esc(createdAt.slice(0, 10));
  return checking ? CHECKING : "–";
}

/** What the "not landed" mark says on hover, age included (spec 208).
 *  Spelled out here rather than at the call site so the fact and its
 *  freshness cannot drift apart — the same reason `driftNote` exists,
 *  and the same idea: an answer a schedule took is shown WITH how old
 *  it is rather than withheld.
 *
 *  `relTimeLabel`, not `relTime` — this goes in a `title` attribute,
 *  where markup would show as literal tags. `checkedAt` is epoch ms
 *  (the checker's cache stamp) and the label takes an ISO string. */
export function notLandedTitle(checkedAt: number | undefined, now: number): string {
  const why = "its branch is still on origin — re-run archive";
  if (checkedAt === undefined) return why;
  return `${why}, checked ${relTimeLabel(new Date(checkedAt).toISOString(), now)}`;
}

/** The waiting-on-review sentence (spec 220, spec 335): the branch is
 *  there, and a request describes it — worded for both a live row's
 *  `prUrl` and an archived row's `archive.prOpen`, which are the same
 *  fact from a reader's chair. */
const waitingOnReviewSentence = (lang: Language): string => t(lang, "list.waitingOnReview");

/** The sentence a LIVE row carries when its archive step is held back
 *  specifically for unticked acceptance criteria (spec 411) — the same
 *  shape `waitingOnReviewSentence` has, for a fact this dashboard
 *  already knows how to act on (the round the checks are waiting on). */
const boardStartLinkSentence = (lang: Language): string => t(lang, "list.boardStartLink");

/** The sentence a LIVE row carries when a push never reached origin
 *  (spec 328, spec 335, spec 352). Fixed prose, not `pushError`'s own
 *  text: that text is git's raw stderr with its `hint:` lines flattened
 *  onto one line before it ever reaches the dashboard (`aide-run-spec`'s
 *  own `tr '\n' ' '`), which is not a string a person should be asked to
 *  read as an instruction. Names the checkout (REQ-3, spec 352): "pull
 *  it locally" said nothing about WHOSE checkout, and the only one a
 *  reader can act on is the one on the serving host. */
const pushErrorSentence = (lang: Language): string => t(lang, "list.pushError");

/** The sentence a LIVE row carries when no pull request could be opened
 *  for its branch (spec 220, spec 335, spec 352). Fixed prose for the
 *  same reason as `pushErrorSentence` — one of `prError`'s four cases
 *  is raw `gh pr create` stderr, and the other three are already custom
 *  text this sentence now stands in for uniformly. Names the checkout
 *  (REQ-3, spec 352), the same location `pushErrorSentence` names. */
const prErrorSentence = (lang: Language): string => t(lang, "list.prError");

/** The sentence an ARCHIVED row carries when a landing merged its branch
 *  but left it on origin because the delete failed (spec 319, spec
 *  335, spec 352). Fixed prose, not `branchDeleteError`'s own text: that
 *  text is raw `git push --delete` stderr, tail 200 chars. Names the
 *  checkout (REQ-3, spec 352). */
const branchLeftBehindSentence = (lang: Language): string => t(lang, "list.branchLeftBehind");

/** One mark this row's own live-job fields carry, before it is chosen
 *  between (`pullRequestMark`/`errorMarkNotices`, below). */
interface LiveMark {
  variant: BadgeVariant;
  label: string;
  sentence: string;
  href?: string;
}

/** Every mark a LIVE row's own fields carry right now, highest priority
 *  first. More than one can be true at once — `pushError`, `landingError`,
 *  `prError`, the archive-held-for-Checks reason and `prUrl` are
 *  independent, set from different job records or the phase list — and
 *  the order is the row's own: a push that never reached origin means
 *  nothing downstream can be trusted yet, so it outranks a landing
 *  failure, which itself means a completed step's merge never finished
 *  and so outranks the three review-related marks, which are about
 *  process, not correctness, and least urgent of the group. */
function liveMarks(g: SpecGroup, lang: Language): LiveMark[] {
  const marks: LiveMark[] = [];
  if (g.pushError) marks.push({ variant: "refused", label: NOT_PUSHED(lang), sentence: pushErrorSentence(lang) });
  // A landing the project's own suite refused is the one that is not a
  // refusal: the merge was built, the tests on it went red, and nothing
  // was pushed. Amber and its own word, so the row does not read as a
  // broken machine when the answer is to run implement again.
  if (g.landingError) {
    const held = g.errorReason === "tests-red";
    marks.push({
      variant: held ? "waiting" : "refused",
      label: held ? TESTS_RED(lang) : LANDING_FAILED(lang),
      sentence: renderSentence(lang, g.landingError)!,
    });
  }
  if (g.prError) marks.push({ variant: "refused", label: NO_PULL_REQUEST(lang), sentence: prErrorSentence(lang) });
  // Spec 411: the same field `resting.ts` already reads to draw the
  // "ready" badge for this exact state — a spec waiting on the round,
  // not on a person deciding something. Two marks together, not one
  // replacing the other: spec 382's REQ-4 already requires the row to
  // name the Checks tab as where the hold clears, and spec 411's REQ-1
  // requires the new sentence verbatim — the pair joins with " · " the
  // same way any other two marks do (spec 339) rather than the newer
  // one silently dropping the older fact.
  const heldBackReason = g.phases.find((p) => p.step === "archive")?.heldBack?.reason;
  if (heldBackReason === ACCEPTANCE_CRITERIA_UNTICKED_NOTE) {
    marks.push({ variant: "waiting", label: t(lang, "list.archiveHeldBackWord"), sentence: heldBackReason });
    marks.push({
      variant: "waiting",
      label: TEST_SERVER(lang),
      sentence: boardStartLinkSentence(lang),
      href: `${specPagePath(g.project, g.specFolder)}?tab=steps&startBoard=1`,
    });
  }
  if (g.prUrl) {
    marks.push({ variant: "waiting", label: PULL_REQUEST(lang), sentence: waitingOnReviewSentence(lang), href: g.prUrl });
  }
  return marks;
}

/** One sentence in the row's notice line (REQ-2/REQ-3), ranked among
 *  whichever others apply (REQ-4). `href` carries a mark's own link
 *  (a pull request's URL) so it survives being joined with another
 *  mark's sentence on the same line (REQ-2, spec 403). */
export interface RowMarkNotice {
  variant: MessageVariant;
  text: string;
  href?: string;
}

/** The four things a LIVE row's own fields can say, ranked exactly as
 *  `liveMarks()` ranks them (REQ-4) — a pull request open for the
 *  branch is one of them now (REQ-1/REQ-2, spec 403, reversing spec
 *  339's REQ-1, which drew it as a State-column badge instead: a badge
 *  true for the whole open-PR window says nothing about which state the
 *  spec is passing through underneath it). The label prefixes a
 *  sentence only when more than one applies at once — the same nuance
 *  the old badge's hover title used to carry, so a reader can still tell
 *  which mark is which without it costing every ordinary row (at most
 *  one, most of the time) an unnecessary label. */
export function errorMarkNotices(g: SpecGroup, lang: Language): RowMarkNotice[] {
  const marks = liveMarks(g, lang);
  // The mark's own variant decides the colour: every one of these is a
  // refusal except a landing the project's suite went red on, or a pull
  // request waiting on review, neither of which is broken.
  return marks.map((m) => ({
    variant: m.variant === "waiting" ? ("waiting" as MessageVariant) : ("failed" as MessageVariant),
    text: marks.length > 1 ? `${m.label}: ${m.sentence}` : m.sentence,
    href: m.href,
  }));
}

/** An archived row's own facts: `notLanded`/`branchDeleteError` are
 *  mutually exclusive with `prOpen` at the source (`spec-views.ts`), so
 *  this is ever at most one sentence. A branch still open for review
 *  (REQ-4, spec 403, reversing spec 339's REQ-1 the same way
 *  `errorMarkNotices()` above does) reads the same sentence a live row's
 *  `prUrl` gets, linked when `gh` opened one and `list.noPullRequestOpened`
 *  when it did not. `failed`, not `waiting` (spec 372), for the other
 *  two facts: this is the same "a step's push did not reach origin"
 *  story `errorMarkNotices()` already tells in red for a live row — an
 *  archived row telling it in amber was the description's own bug
 *  pattern, live in the one place it had not yet been reported. */
export function archivedRowNotices(a: ArchivedSpecView | undefined, now: number, lang: Language): RowMarkNotice[] {
  if (!a) return [];
  if (a.prOpen) {
    return [{
      variant: "waiting",
      text: a.prUrl ? waitingOnReviewSentence(lang) : t(lang, "list.noPullRequestOpened"),
      href: a.prUrl,
    }];
  }
  const title = lockedStateTitle(a, now, lang);
  return title ? [{ variant: "failed", text: title }] : [];
}

/** The sentence an archived row's branch mark carries (REQ-2/REQ-3) —
 *  `branchDeleteError`/`notLanded` used to be folded into the removed
 *  Spec-column badge (spec 335), then into `stateBadge`'s own `title`;
 *  it is a notice-line sentence now (`archivedRowNotices`, above). */
export function lockedStateTitle(a: ArchivedSpecView | undefined, now: number, lang: Language): string | undefined {
  if (a?.branchDeleteError) return branchLeftBehindSentence(lang);
  // Out of REQ-6's own enumeration (`2-analysis.md`'s Findings): stays
  // English regardless of `lang`, same as the workflow step names.
  if (a?.notLanded) return notLandedTitle(a.notLandedCheckedAt, now);
  return undefined;
}
