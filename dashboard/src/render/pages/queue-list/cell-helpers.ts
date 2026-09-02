// The small cells a spec's header row and phase lines share: state,
// duration, cost, and the marks an archived row's date cell carries.

import { CHECKING, badge, pips, stepLabel, type BadgeVariant } from "../../ui/components.ts";
import { esc, relTimeLabel, usdOrTokens } from "../../ui/html.ts";
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
import { isArchivedRow, phaseDuration, type ArchivedSpecView, type Phase, type SpecGroup } from "./data-model.ts";
import { LANDING_FAILED, NO_DATE, NO_PULL_REQUEST, NOT_PUSHED, PULL_REQUEST } from "./row-shared.ts";

// The two cells the header line and the phase lines fill the same way.
// A spec's state and a phase's state are the same question asked at two
// altitudes, and they must never be worded differently.
// Spec 143: the job's own error is NOT written here any more. It is a
// sentence a runner wrote — "the specs tree is dirty: /Users/…" — and
// this cell is sized for a badge, so it went off the right edge of the
// table. The row's panel says it instead (`specNoticeRow`).
export const stateCell = (r: QueueRowView, resting: RestingState = {}): string =>
  specStateChip(r, resting);

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
  (w.badge ? badge(w.badge.variant, w.badge.label) : `<span class="muted small">not run yet</span>`) +
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
  // Nothing recorded across every phase draws a dash — the same
  // "nothing to show" rule `costCell()` already gives an all-zero spend.
  if (ms <= 0) return "–";
  const text = esc(durationLabel(ms));
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

/** One pip per phase: green for a phase that has run, blue for the one
 *  running now, grey for a phase still ahead. The whole workflow in six
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

/** The same column as `activeDurationCell`, with a fallback that cell has
 *  no use for (spec 224): a locked row with nothing summed falls back to
 *  its ARCHIVE date rather than a bare dash, because an archived spec's
 *  own duration comes from its phase files' `Time spent:` lines
 *  (`readerGroup`) and can genuinely be absent for an older archive.
 *
 *  "checking…" is a spec nobody has ASKED git about; `date unknown` is
 *  one git was asked about and could not date. Two different answers,
 *  and a cell saying the wrong one is a cell that lies about whether
 *  there is anything still to find out.
 *
 *  Once a duration exists, the cell shows ONLY the duration (never the
 *  date beside it) — the date was dropped after it read as noise next to
 *  the figure that actually answers "how long". */
export function archiveDateCell(s: ArchivedSpecView, durationMs: number): string {
  const date = esc(s.archivedAt ?? (s.dateChecking ? CHECKING : NO_DATE));
  // Nothing recorded across every phase draws the date alone — the same
  // "nothing to show" rule costCell() already gives an all-zero spentUsd.
  if (durationMs <= 0) return date;
  return `<span class="archive-duration">${esc(durationLabel(durationMs))}</span>`;
}

/** When the spec was MADE (spec 317, REQ-1/REQ-4) — the same
 *  plain-date, "checking…"-or-`NO_DATE` shape `archiveDateCell` draws
 *  for the Time column's archive date, over a different question and
 *  never a fallback for it: this cell shows nothing once a spec's own
 *  duration exists, unlike that one. One call for either kind of row
 *  (REQ-6) — `SpecGroup.createdAt`/`createdAtChecking` already carry
 *  the archived-row answer by the time this is called, copied up by
 *  `readerGroup()`. */
export function createdCell(createdAt: string | undefined, checking: boolean): string {
  return esc(createdAt ? createdAt.slice(0, 10) : checking ? CHECKING : NO_DATE);
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
const WAITING_ON_REVIEW_SENTENCE = "its code is waiting on a pull request — open it to review";

/** The sentence a LIVE row carries when a push never reached origin
 *  (spec 328, spec 335). Fixed prose, not `pushError`'s own text: that
 *  text is git's raw stderr with its `hint:` lines flattened onto one
 *  line before it ever reaches the dashboard (`aide-run-spec`'s own `tr
 *  '\n' ' '`), which is not a string a person should be asked to read as
 *  an instruction. */
const PUSH_ERROR_SENTENCE = "A step's push did not reach origin. Pull the branch locally, then push it again.";

/** The sentence a LIVE row carries when no pull request could be opened
 *  for its branch (spec 220, spec 335). Fixed prose for the same reason
 *  as `PUSH_ERROR_SENTENCE` — one of `prError`'s four cases is raw `gh
 *  pr create` stderr, and the other three are already custom text this
 *  sentence now stands in for uniformly. */
const PR_ERROR_SENTENCE = "No pull request could be opened for this branch. Open one by hand.";

/** The sentence an ARCHIVED row carries when a landing merged its branch
 *  but left it on origin because the delete failed (spec 319, spec
 *  335). Fixed prose, not `branchDeleteError`'s own text: that text is
 *  raw `git push --delete` stderr, tail 200 chars. */
const BRANCH_LEFT_BEHIND_SENTENCE =
  "This spec merged, but its branch could not be deleted on origin. Delete it by hand.";

/** One mark this row's own live-job fields carry, before it is chosen
 *  between (`rowActionMark`, below). */
interface LiveMark {
  variant: BadgeVariant;
  label: string;
  sentence: string;
  href?: string;
}

/** Every mark a LIVE row's own fields carry right now, highest priority
 *  first. More than one can be true at once — `pushError`, `landingError`,
 *  `prError` and `prUrl` are independent booleans, set from different job
 *  records — and the order is the row's own: a push that never reached
 *  origin means nothing downstream can be trusted yet, so it outranks a
 *  landing failure, which itself means a completed step's merge never
 *  finished and so outranks the two review-related marks, which are
 *  about process, not correctness, and least urgent of the four. */
function liveMarks(g: SpecGroup): LiveMark[] {
  const marks: LiveMark[] = [];
  if (g.pushError) marks.push({ variant: "refused", label: NOT_PUSHED, sentence: PUSH_ERROR_SENTENCE });
  if (g.landingError) marks.push({ variant: "refused", label: LANDING_FAILED, sentence: g.landingError });
  if (g.prError) marks.push({ variant: "refused", label: NO_PULL_REQUEST, sentence: PR_ERROR_SENTENCE });
  if (g.prUrl) {
    marks.push({ variant: "waiting", label: PULL_REQUEST, sentence: WAITING_ON_REVIEW_SENTENCE, href: g.prUrl });
  }
  return marks;
}

/** The one small badge the State column draws beside its own running/
 *  resting word, when the row has an action of its own to report — REQ-2:
 *  every status this list reports comes from the State column now, never
 *  from beside the spec's name. `undefined` where there is nothing to
 *  add, which is most rows. */
export interface RowMark {
  variant: BadgeVariant;
  label: string;
  title: string;
  href?: string;
}

/** `isArchivedRow(g)` is enough to pick the right group: `readerGroup`
 *  never sets `pushError`/`landingError`/`prError`/`prUrl`, and
 *  `jobGroup` never sets `archive` — so the two groups never both apply
 *  to the same row and there is no ordering between them to invent.
 *
 *  An archived row's `notLanded`/`branchDeleteError` are mutually
 *  exclusive with `prOpen` at the SOURCE (`spec-views.ts`), and already
 *  folded into `stateBadge`'s own text (`lockedStateTitle`, below) —
 *  `prOpen` is the one Archive fact that text never covered, so it is
 *  the only one this function draws as a second badge.
 *
 *  A live row's four fields are NOT mutually exclusive (`liveMarks`,
 *  above): the top one is this badge's label, and the REST are not
 *  dropped — every applicable mark's own sentence is folded into this
 *  SAME badge's title, so a reader reaches all of them by hovering the
 *  one badge the row draws, with no second page to follow. */
export function rowActionMark(g: SpecGroup): RowMark | undefined {
  if (isArchivedRow(g)) {
    if (!g.archive?.prOpen) return undefined;
    return {
      variant: "waiting",
      label: PULL_REQUEST,
      title: g.archive.prUrl
        ? WAITING_ON_REVIEW_SENTENCE
        : "its code is on a branch and no pull request was opened for it",
      href: g.archive.prUrl,
    };
  }
  const [top, ...rest] = liveMarks(g);
  if (!top) return undefined;
  const title = rest.length ? [top, ...rest].map((m) => `${m.label}: ${m.sentence}`).join(" · ") : top.sentence;
  return { variant: top.variant, label: top.label, title, href: top.href };
}

/** The sentence a locked row's own `stateBadge` carries as its `title` —
 *  the explanation the removed Spec-column badge used to hold (spec 335),
 *  now on the one badge the State column draws instead of a second one.
 *  `branchDeleteError`/`notLanded` stay folded into `stateBadge`'s own
 *  visible text, unchanged (`head-row.ts`); this is only their title. */
export function lockedStateTitle(a: ArchivedSpecView | undefined, now: number): string | undefined {
  if (a?.branchDeleteError) return BRANCH_LEFT_BEHIND_SENTENCE;
  if (a?.notLanded) return notLandedTitle(a.notLandedCheckedAt, now);
  return undefined;
}
