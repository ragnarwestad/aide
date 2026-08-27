// The small cells a spec's header row and phase lines share: state,
// duration, cost, and the marks an archived row's date cell carries.
// Split out of cells.ts (split cells.ts by theme).

import { CHECKING, badge, pips, stepLabel } from "../../ui/components.ts";
import { esc, relTime, relTimeLabel, usdOrTokens } from "../../ui/html.ts";
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
import { phaseDuration, type ArchivedSpecView, type Phase, type SpecGroup } from "./data-model.ts";
import { NO_DATE, PR_OPEN } from "./row-shared.ts";

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

/** The spec header row's own time cell: when the spec was made, and
 *  what its phases came to once they are all behind it (spec 199).
 *
 *  The total rides BESIDE the date, in the cell that is already there.
 *  A column of its own would take its width from a heading, and this
 *  table has no width to give — the same constraint that put the
 *  attempt count beside a badge rather than under it. */
export function startedCell(g: SpecGroup, now: number): string {
  // A dash means git was asked and could not date the folder. Nobody
  // having asked yet is a different cell (spec 208).
  return g.createdAt ? relTime(g.createdAt, now) : g.freshnessUnknown ? CHECKING : "–";
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

/** The same column, a different question (spec 224): a locked row's date
 *  is when it was ARCHIVED, and the figure beside it is what the whole
 *  spec cost. `startedCell` reads `g.createdAt`, which comes off a
 *  target — and an archived spec is no target, so that cell would be a
 *  bare dash on every row here.
 *
 *  "checking…" is a spec nobody has ASKED git about; `date unknown` is
 *  one git was asked about and could not date. Two different answers,
 *  and a cell saying the wrong one is a cell that lies about whether
 *  there is anything still to find out. */
export function archiveDateCell(s: ArchivedSpecView): string {
  const date = esc(s.archivedAt ?? (s.dateChecking ? CHECKING : NO_DATE));
  // A spec archived before spec 207 recorded no duration at all, which
  // is the one case that draws the date alone — not the dash the
  // description uses or the words a missing date uses elsewhere.
  if (s.durationMs === undefined) return date;
  return (
    `<span class="archive-duration">${esc(durationLabel(s.durationMs))}</span>` +
    ` <span class="muted small">${date}</span>`
  );
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

/** The waiting-on-review mark, wrapped in a link to the request when
 *  there is one to link to — the mark is a reason to go somewhere, and
 *  the place is the pull request. Without a URL it is the bare badge,
 *  saying the branch is open and nothing describes it. */
export function prOpenMark(s: ArchivedSpecView): string {
  const mark = badge(
    "waiting",
    PR_OPEN,
    s.prUrl
      ? "its code is waiting on a pull request — open it to review"
      : "its code is on a branch and no pull request was opened for it",
  );
  return s.prUrl ? `<a href="${esc(s.prUrl)}">${mark}</a>` : mark;
}
