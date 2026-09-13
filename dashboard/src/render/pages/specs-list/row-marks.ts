// The notice-line sentences a row's own fields can carry, beside its
// state: a pull request open for review, a push or landing that failed,
// an archive held back for unticked acceptance criteria. Split out of
// cell-helpers.ts by theme.

import { type BadgeVariant, type MessageVariant } from "../../ui/components.ts";
import { t, type Language } from "../../../i18n";
import { renderSentence } from "../../../i18n/message.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../project/parse-status.ts";
import { heldBackReasonText } from "../../ui/job-state/notice.ts";
import { specPagePath } from "../spec-page.ts";
import { type ArchivedSpecView, type SpecGroup } from "./data-model.ts";
import { LANDING_FAILED, NO_PULL_REQUEST, NOT_PUSHED, PULL_REQUEST, TEST_SERVER, TESTS_RED } from "./row-shared.ts";
import { notLandedTitle } from "./cell-helpers.ts";

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

/** Is the QUEUE holding this spec's archive for unticked acceptance
 *  criteria? The file's own note answers the same question a moment
 *  later — the archive run writes it — so the two are read apart:
 *  this one to avoid saying it twice, and to say the start link is
 *  coming while only this half is true. */
const queueHeldForChecks = (g: SpecGroup): boolean =>
  g.lead?.errorReason === "held-back" && !!g.lead.error && typeof g.lead.error === "object" &&
  !Array.isArray(g.lead.error) && g.lead.error.key === "runner.acceptanceCriteriaUnticked";

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
  // Not while the archive is running. The note lives in `4-status.md`
  // and is only rewritten when that run gets far enough to write it, so
  // a reader who ticks the last check — which starts the run at once —
  // was still being told to go and tick, beside a link offering a test
  // server for the judging they had just finished. The run in flight is
  // the newer fact.
  // RUNNING, never `inFlight`: a job held back for this very reason sits
  // QUEUED, and `inFlight` counts that as in flight — which would blank
  // the note in exactly the state it exists for. A landing counts, the
  // merge being the tail of the same run.
  const archiveRunning = !!g.phases
    .find((p) => p.step === "archive")
    ?.attempts.some((a) => a.state === "running" || !!a.landing);
  if (heldBackReason === ACCEPTANCE_CRITERIA_UNTICKED_NOTE && !archiveRunning) {
    // Unless the queue is already saying it. The runner holds a job for
    // this exact reason with a message of its own, which the notice
    // line draws above these marks — and that one is translated, where
    // the file's note is a fixed English constant. Two sentences saying
    // one thing, one of them in the wrong language, is what a reader
    // got until 2026-09-08.
    const queueSaysIt = queueHeldForChecks(g);
    if (!queueSaysIt) {
      marks.push({ variant: "waiting", label: t(lang, "list.archiveHeldBackWord"), sentence: heldBackReasonText(lang, heldBackReason) });
    }
    marks.push({
      variant: "waiting",
      label: TEST_SERVER(lang),
      sentence: boardStartLinkSentence(lang),
      href: `${specPagePath(g.project, g.specFolder)}?tab=steps&startBoard=1`,
    });
  } else if (queueHeldForChecks(g) && !archiveRunning) {
    // The queue holds the job the moment it refuses to archive; the
    // note the branch above reads — and with it the start link — needs
    // `implement` in the git-verified done-set as well
    // (`archiveHeldBackApplies`), and that set does not count a step
    // whose work is still on its branch. So the link can be there on
    // one render and gone on the next. A reader in that window was told
    // to go and tick, with no way to see the thing being ticked and
    // nothing saying one was coming. So it is said.
    marks.push({ variant: "waiting", label: TEST_SERVER(lang), sentence: t(lang, "list.boardStartComing") });
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
