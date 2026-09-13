// The small cells a spec's header row and phase lines share: state,
// duration, cost, and the phase pips. Split by theme into row-marks.ts
// (the notice-line sentences an archived or live row's own fields can
// carry).

import { CHECKING, badge, pips, stepLabel } from "../../ui/components.ts";
import { esc, relTimeLabel, usdOrTokens } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
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
import { phaseDuration, type Phase, type SpecGroup } from "./data-model.ts";

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
    // `data-none` is what the stylesheet indents it by: a badge carries
    // its own padding, so a bare dash left at the cell's edge sat four
    // characters left of every word under it and read as stuck to the
    // column's left edge.
    : `<span class="muted small" data-none${attempts > 1 ? ` title="${attempts} attempts"` : ""}>` +
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
// 152).
//
// Said in the figure's own tooltip, not beside it (2026-09-08). The
// word "est." stood next to the number until then, and the Cost column
// is 4.5rem — "14.0M est." does not fit, so the mark wrapped onto a
// line of its own and read as belonging to the column beside it. The
// job page's Steps table has the width for it and keeps the word.
// `settled` (spec 433): this figure is a real answer, not merely
// unrecorded — a finished step whose own record genuinely says $0, which
// reads exactly like "nothing here yet" without it. Opt-in and
// default-false, so every existing caller that omits it keeps today's
// behaviour byte-for-byte.
export const costCell = (
  spentUsd: number,
  spentTokens: number | undefined,
  blank: string,
  unmeasured?: boolean,
  settled?: boolean,
): string => {
  if (!(spentUsd > 0 || (spentTokens ?? 0) > 0 || settled)) return blank;
  // `spentUsd || undefined` used to be enough: the guard above already
  // means spentUsd > 0 or spentTokens > 0, so a 0 here only ever meant
  // "nothing to say in dollars, read the tokens instead" (a Codex-only
  // spend, spec 260). `settled` adds a case that must print as $0.00
  // rather than fall through to that same undefined — but only when
  // there is no token figure either: a settled Codex step still owes
  // spec 260's guarantee, tokens over an invented $0.00.
  const figure = usdOrTokens(
    spentUsd > 0 ? spentUsd : settled && !((spentTokens ?? 0) > 0) ? 0 : undefined,
    spentTokens,
  );
  return unmeasured
    ? `<span title="an estimate: a step that was stopped is charged its whole budget, ` +
      `because a run that is killed reports nothing about what it used">${figure}</span>`
    : figure;
};

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

/** The Time column for a locked row: how long the work took, and never
 *  anything else. A date here is a different question wearing the
 *  column's clothes, and an empty cell asks whether anything ran — so a
 *  spec whose phases summed to nothing reads `0s`, the same as an active
 *  row's. */
export function archiveDateCell(durationMs: number): string {
  return `<span class="archive-duration">${esc(durationLabel(Math.max(0, durationMs)))}</span>`;
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
export function createdCell(
  createdAt: string | undefined,
  checking: boolean,
  /** An archived or closed spec git could not date was made before the
   *  board recorded creation dates — the oldest rows on the list, not
   *  the newest. The dash stays for a live spec, whose date is on its
   *  way (2026-09-09). */
  finished = false,
  lang: Language = "en",
): string {
  if (createdAt) return esc(createdAt.slice(0, 10));
  if (checking) return CHECKING;
  return finished ? t(lang, "list.createdNotRegistered") : "–";
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
