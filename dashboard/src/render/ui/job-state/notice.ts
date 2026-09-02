// The one long message a row has to say (spec 143).

import type { MessageVariant } from "../components.ts";
import { inFlight } from "./format.ts";
import type { QueueRowView } from "./types.ts";

/** A sentence a row has to show, and how loudly. The row draws it in a
 *  panel of its own (`specNoticeRow`, queue-list.ts) rather than in a
 *  table cell: both producers write free text out of a file or a
 *  runner's refusal — 130 characters on spec 141 — and every cell on
 *  this row is sized for a word. */
export interface RowNotice {
  variant: MessageVariant;
  text: string;
  /** The class the panel's message is marked with, for the one
   *  producer that has always carried one: a refusal (spec 151). */
  hook?: string;
}

/** Which of the four applies, if any. The order is the row's own: the
 *  queue's refusal of the press just made comes first, then a job that
 *  failed saying why it failed, then the spec's standing note about an
 *  archive that declined, and last a phase whose own record disagrees
 *  with the files.
 *
 *  That fourth one is the newest (spec 195) and ranks lowest because it
 *  is the least specific: a refusal answers a button the reader just
 *  pressed, an error says why the row is not moving, and a held-back
 *  note names a decision — a disagreement is a standing condition that
 *  was true before any of them and will still be true after. It reaches
 *  this function already worded with its phase's name (`analyze: …`),
 *  because it used to be drawn beneath that phase's own badge and a
 *  sentence moved out of the line it belonged to must say which line
 *  that was. `phaseWordCell` drew it in a `<div>` of its own until spec
 *  195, which made a phase line with something to say taller than the
 *  ones beside it — the same symptom, and the same cause, spec 176
 *  fixed for the stale mark and the tries count.
 *
 *  `archiveHeldBack` and the disagreement are the one PAIR that can
 *  both be true of the same phase: archive is held back and its own
 *  last re-run failed. First-match-wins would drop one of two true
 *  things silently, so that pair is joined into one message instead.
 *
 *  The refusal is the third producer, added by spec 151 and the only
 *  one that belongs to no job: the queue returns it at enqueue time,
 *  before a job exists to carry it, so it reaches the page on the
 *  query string (`errorSpec`/`error`) instead. It was left drawing
 *  itself inside the name cell when spec 143 built this panel — where
 *  it pushed the branch marks and the title around, on the one row the
 *  reader had just pressed a button on. It outranks both of the
 *  others because it answers that press, and for the same reason it is
 *  said even while a job is running: a clash refusal is a refusal
 *  BECAUSE something is running, and gating it on "nothing in flight"
 *  would silence exactly the case it exists for.
 *
 *  Requirement 3 of 1-description.md — the panel cleared when a new
 *  action starts on the row — is already answered by each of them, in
 *  its own way, and neither needs a rule invented here:
 *
 *  `error` belongs to the job and is current by construction. The
 *  runner clears it the moment a step starts (`startOne`) and a freshly
 *  queued job is built without one, so a job that HAS one is parked,
 *  refused or stopped — and in every one of those the message is why
 *  the row is not moving. A job PARKED on an unmerged dependency is
 *  queued and holding its reason, which is why this is not gated on
 *  "nothing in flight": that gate would blank the one row whose whole
 *  point is to say why it is waiting.
 *
 *  The held-back note is the SPEC's and outlives any job, so it takes
 *  the gate `wordPhase` and `specStateChip` already keep: not while
 *  something is running, because a note from an earlier decline must
 *  not upstage the retry that may be clearing it. It needs no job at
 *  all, for the same reason `wordPhase` shows "held back" without an
 *  attempt — a spec archived by hand, or one whose archive job has
 *  aged out of the queue, still has its file saying why. */
export function specNotice(
  lead: QueueRowView | undefined,
  archiveHeldBack?: string,
  refusal?: string,
  /** A phase's own qualifier, worded with that phase's name by the
   *  caller — this file knows nothing about a spec's phase list. */
  disagreement?: string,
  /** The row's own error marks, ranked highest-first (REQ-2/REQ-4,
   *  `errorMarkNotices`/`archivedRowNotices`, cell-helpers.ts) — never
   *  "pull request", which stays a State-column badge (`pullRequestMark`,
   *  REQ-1). Folded in at the same priority `lead.error` already holds,
   *  and for the same reason: both say why the row is not moving, so
   *  neither waits for "nothing in flight" (spec 327's own row already
   *  shows `landingError` while a later step runs). */
  marks: { variant: MessageVariant; text: string }[] = [],
): RowNotice | undefined {
  if (refusal) return { variant: "err", text: refusal, hook: "refused" };
  const parts: { variant: MessageVariant; text: string }[] = [];
  if (lead?.error) parts.push({ variant: "err", text: lead.error });
  parts.push(...marks);
  if (parts.length) return { variant: parts[0]!.variant, text: parts.map((p) => p.text).join(" · ") };
  if (lead && inFlight(lead)) return undefined;
  // The same amber the badge takes, and for the same reason: a held-back
  // archive is a common, healthy outcome — notice, not alarm. A
  // disagreement takes the same amber for the same reason.
  if (archiveHeldBack && disagreement) {
    // Both true at once, and both said. The prefix below already names
    // archive, and a disagreement competing with a held-back note is
    // archive's own by construction — so the phase name it arrived with
    // comes off rather than being written twice in one sentence.
    const detail = disagreement.replace(/^archive: /, "");
    return { variant: "warn", text: `archive held back — ${archiveHeldBack} · ${detail}` };
  }
  if (archiveHeldBack) return { variant: "warn", text: `archive held back — ${archiveHeldBack}` };
  if (disagreement) return { variant: "warn", text: disagreement };
  return undefined;
}
