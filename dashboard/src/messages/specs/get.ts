// The one long message a row has to say.

import { stepLabel } from "../../format/step-label.ts";
import { stepButton } from "../../format/step-label.ts";
import { t, type Language } from "../../i18n/index.ts";
import { messageDetail, messageIdentity, formatMessage, formatSentence } from "../format.ts";
import { heldBackResolvesOnItsOwn } from "../jobs/holds.ts";
import type { Message, MessageVariant } from "../types.ts";
import type { OpenOverlap } from "../../project/overlapping-specs.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../project/parse-status/index.ts";
import { currentStep } from "../jobs/context.ts";
import { inFlight } from "../../queue/steps.ts";
import { getProviderLimitMessage, getUsageLimitMessage } from "../usage-limit/get.ts";
import type { QueueRowView } from "../../render/ui/job-state/types.ts";

/** A sentence a row has to show, and how loudly. The row draws it in a
 *  panel of its own (`specNoticeRow`, specs-list.ts) rather than in a
 *  table cell: both producers write free text out of a file or a
 *  runner's refusal — 130 characters in one case — and every cell on
 *  this row is sized for a word. */
export interface RowNotice extends Message {
  /** The class the panel's message is marked with, for the one
   *  producer that has always carried one: a refusal. */
  hook?: string;
  /** Raw git/tool output behind `text` — hover-only,
   *  set only when `text` is the ONE sentence in the panel: joining two
   *  or more parts leaves no single sentence the detail could belong
   *  to, so it is dropped rather than misattributed. */
  title?: string;
  /** Each mark's own sentence with its own link, when it has one — set
   *  only when this notice came from more than one ranked mark
   *  (`errorMarkNotices`/`archivedRowNotices`). Unlike `title`, a link
   *  lives INSIDE the text rather than as one attribute on the whole
   *  row, so it does not have `title`'s "only when parts.length===1"
   *  problem: each mark keeps its own link regardless of how many
   *  others are joined beside it with " · ". */
  parts?: NoticePart[];
}

/** One sentence of a notice, with what the row needs to draw it: its own
 *  colour, whether it stands on a line of its own, and which kind of mark
 *  it is when a control belongs beside it (`"acceptance-hold"`,
 *  `"branch-left-behind"` for Delete branch, or `"approach-choice"` for
 *  the approaches to choose between). */
export interface NoticePart {
  text: string;
  href?: string;
  variant?: MessageVariant;
  own?: boolean;
  kind?: "acceptance-hold" | "branch-left-behind" | "approach-choice";
  identity?: string;
  detail?: string;
}

/** What the details behind a row's sentence add to it, for its (?): every
 *  line of each, in order, once, less a line the sentence already carries
 *  word for word. Lines too short to tell apart from a word stay. Nothing
 *  left means no (?). */
export function detailBeyond(text: string, ...details: (string | undefined)[]): string | undefined {
  const seen = new Set<string>();
  const lines = details.flatMap((d) => (d ?? "").split("\n")).filter((line) => {
    const key = line.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return key.length < 12 || !text.includes(key);
  });
  return lines.length ? lines.join("\n").trim() : undefined;
}

const isArchiveTestsRed = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { key?: unknown }).key === "runner.testsRedArchive";

/** The sentence for a spec whose analyze stands stopped on files other open
 *  specs change: its lead job stopped so, or the analyze phase's own history
 *  (`analyzeStopped`) says so and the lead has nothing newer to say — none in
 *  flight, and none that ended with a sentence of its own, which `getSpecMessage`
 *  ranks first on the row as well. Said from the spec's own record, so it
 *  reads the same with the job and without it: the specs still open with
 *  their files, or that none is open any more. With no record to read, the
 *  lead's own sentence as before, and nothing when only the history says so.
 *  The record is read only once the stop is established. The spec page draws
 *  it as a waiting line, where the list row draws it through `specNoticeRow`. */
export function getSharedFilesMessage(
  lead: QueueRowView | undefined,
  analyzeStopped: string | undefined,
  overlaps: () => OpenOverlap[] | undefined,
  lang: Language = "en",
): string | undefined {
  const leadStopped = lead?.state === "stopped" && lead.stopReason === "shared-files";
  const historyStopped = analyzeStopped === "shared-files" && !(lead && (inFlight(lead) || lead.error));
  if (!leadStopped && !historyStopped) return undefined;
  if (leadStopped && lead?.error && typeof lead.error === "object" && !Array.isArray(lead.error) &&
      ["runner.dependencyCycle", "runner.autoDependenciesFailed", "runner.overlapDecisionMissing"].includes(lead.error.key)) return formatSentence(lang, lead.error);
  const open = overlaps();
  const button = stepButton("analyze");
  if (open?.length) {
    const inner = open.map((o) => ({
      key: "runner.sharedFilesSpec" as const,
      values: { spec: o.label, files: o.files.join(", ") },
    }));
    return formatMessage(lang, { key: "wordPhase.stopSharedFilesNamed", values: { button }, inner });
  }
  if (open) return formatMessage(lang, { key: "wordPhase.stopSharedFilesArchived", values: { button } });
  return leadStopped && lead!.error ? formatSentence(lang, lead!.error) : undefined;
}

/** Which applies, if any. The order is the row's own: a job that
 *  failed saying why it failed, then the spec's standing note about an
 *  archive that declined, and last a phase whose own record disagrees
 *  with the files. A refusal of the press just made is not one of them:
 *  the page script draws it in a row of its own under the spec
 *  (`specs-client/row-refusal/`).
 *
 *  The disagreement ranks lowest because it
 *  is the least specific: an error says why the row is not moving, and a held-back
 *  note names a decision — a disagreement is a standing condition that
 *  was true before any of them and will still be true after. It reaches
 *  this function already worded with its phase's name (`analyze: …`),
 *  because it used to be drawn beneath that phase's own badge and a
 *  sentence moved out of the line it belonged to must say which line
 *  that was. A `<div>` of its own in `phaseWordCell` would make a phase
 *  line with something to say taller than the ones beside it — the same
 *  symptom, and the same cause, as for the stale mark and the tries
 *  count.
 *
 *  `archiveHeldBack` and the disagreement are the one PAIR that can
 *  both be true of the same phase: archive is held back and its own
 *  last re-run failed. First-match-wins would drop one of two true
 *  things silently, so that pair is joined into one message instead.
 *
 *  The panel is cleared when a new
 *  action starts on the row, which is already answered by each of them, in
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
 *  aged out of the queue, still has its file saying why.
 *
 *  The fifth, `readyToArchive`, ranks lowest of all: it is
 *  reachable only once every case above has already declined to apply,
 *  mutually exclusive with `archiveHeldBack` by construction (the
 *  caller only ever sets it once the held-back reason has cleared) —
 *  but still ranked after it rather than assumed, so a future producer
 *  added above it always outranks it the same way the existing four
 *  already outrank each other. */
export function getSpecMessage(
  lead: QueueRowView | undefined,
  archiveHeldBack?: string,
  /** A phase's own qualifier, worded with that phase's name by the
   *  caller — this file knows nothing about a spec's phase list. */
  disagreement?: string,
  /** The row's own marks, ranked highest-first
   *  (`errorMarkNotices`/`archivedRowNotices`, row-marks.ts) — a pull
   *  request open for the branch is one of them, not a
   *  State-column badge. Folded in at the same priority
   *  `lead.error` already holds, and for the same reason: both say why
   *  the row is not moving, so neither waits for "nothing in flight"
   *  (the row already shows `landingError` while a later step
   *  runs). */
  marks: (NoticePart & { variant: MessageVariant })[] = [],
  lang: Language = "en",
  /** Nothing else applies, no job is in flight on this spec, and archive
   *  is the one phase left — see this function's own header
   *  comment for its rank. */
  readyToArchive?: boolean,
): RowNotice | undefined {
  const parts: (NoticePart & { variant: MessageVariant; title?: string })[] = [];
  if (lead?.dependencyNotice) parts.push({
    variant: "info",
    text: formatSentence(lang, lead.dependencyNotice)!,
    own: true,
    detail: messageDetail(lead.dependencyNotice),
  });
  // A failed landing writes the same sentence twice on the job: as its
  // `error` and, prefixed with the step, as its `landingError`. Said
  // once here — the mark carries it in full.
  const leadIdentity = messageIdentity(lead?.error);
  const said = (text: string) => marks.some((m) =>
    (leadIdentity !== undefined && m.identity === leadIdentity) || m.text.endsWith(text));
  // A queued job the scheduler is holding ("held back: depends on …",
  // "… not analyzed yet", "… another archive is running", "… the
  // Acceptance criteria are not all ticked yet") is
  // waiting, not broken — the same amber "archive held back" takes
  // below, never the red a refusal or a failed step gets. Read off
  // `errorReason`, which the scheduler sets alongside the
  // sentence — never guessed from the text, which left every OTHER
  // waiting-shaped message still picking "waiting" or "failed" for itself.
  if (lead?.error) {
    // `<phase> <what happened>: <the longer sentence>` — the shape the
    // landing's own messages already have ("archive merge failed: …"),
    // so a held-back job reads "archive held back: …" rather than
    // leaving the reader to work out which of the four is not moving.
    // The phase and the state word are ONE phrase, not two colons: the
    // row beside it already says both, and repeating them apart is the
    // panel saying the same thing twice. Only the held-back family —
    // every other sentence here belongs to the row or to a press, not
    // to one step.
    // A step a provider's usage limit stopped is said in full — which
    // AI, which window, when it starts over — from the tool's own
    // record, in place of the runner's one-line summary of the same.
    const limited =
      lead.state === "stopped" && lead.stopReason === "provider-limit"
        ? [...(lead.results ?? [])].reverse().find((r) => r.providerLimit)
        : undefined;
    // A usage-limit stop the board starts again by itself, and a job held
    // behind one, say so — with the time — in place of the run's own words.
    const usageText = getUsageLimitMessage(lead, lang, Date.now())?.text;
    const text = usageText !== undefined
      ? lead.errorReason === "held-back" ? `${stepLabel(currentStep(lead), lang)} ${usageText}` : usageText
      : limited?.providerLimit
      ? getProviderLimitMessage(
          limited.providerLimit,
          (limited.step && lead.stepModels?.[limited.step]) || lead.model,
          lang,
          Date.now(),
          undefined,
          limited.provider?.name ?? lead.provider,
        ).text
      : lead.errorReason === "held-back"
        ? formatSentence(lang, { key: "message.lead", values: { lead: stepLabel(currentStep(lead), lang) }, inner: lead.error })!
        : formatSentence(lang, lead.error)!;
    if (!said(text)) {
      // Three of the six held-back reasons resolve on their own —
      // nothing for the reader to act on — so they read as info, not
      // the waiting kind's warning triangle. Read off the message's own
      // KEY, never the rendered text: `lead.error` is always a
      // single BoardMessage while a job is held back (`Runner.hold()`).
      // A held-back key this set does not name falls through to
      // "waiting" — the safer default.
      const heldBackInfo = heldBackResolvesOnItsOwn(lead) || usageText !== undefined;
      // `tests-red` waits for the same reason: the landing ran the
      // project's own suite on the merged result, it went red, and
      // nothing was pushed. The step and the merge both did what they
      // should; the code is not green yet. An analyze stopped on its
      // acceptance criteria waits the same way, on the description, and
      // one stopped on files another open spec shares, on Depends on, and
      // a model the provider had no room for, on pressing it again or
      // choosing another model.
      const waiting =
        lead.errorReason === "held-back" || lead.errorReason === "tests-red" || usageText !== undefined ||
        (lead.state === "stopped" &&
          (lead.stopReason === "acceptance-criteria" || lead.stopReason === "shared-files" ||
            lead.stopReason === "model-at-capacity"));
      const variant: MessageVariant = heldBackInfo ? "info" : waiting ? "waiting" : "failed";
      const structured = messageDetail(lead.error);
      // An archive's own red run lists its failing lines on the row when
      // the result names no tests. Otherwise what the message lists and
      // the log's own lines, if the runner kept any, stay behind the (?).
      const archiveLines = isArchiveTestsRed(lead.error) ? structured ?? detailBeyond(text, lead.errorDetail) : undefined;
      if (archiveLines) {
        parts.push({ variant, text }, { variant, text: archiveLines.split("\n").join(" · ") });
      } else {
        const extra = detailBeyond(text, structured, lead.errorDetail);
        parts.push({ variant, text, title: structured ? undefined : extra, identity: leadIdentity, detail: structured ? extra : undefined });
      }
    }
  }
  parts.push(...marks);
  if (parts.length) {
    return {
      variant: parts[0]!.variant,
      text: parts.map((p) => p.text).join(" · "),
      title: parts.length === 1 ? parts[0]!.title : undefined,
      parts: parts.map((p) => ({ text: p.text, href: p.href, variant: p.variant, own: p.own, kind: p.kind, identity: p.identity, detail: p.detail })),
    };
  }
  if (lead && inFlight(lead)) return undefined;
  // The same amber the badge takes, and for the same reason: a held-back
  // archive is a common, healthy outcome — notice, not alarm. A
  // disagreement takes the same amber for the same reason.
  const heldBackReason = archiveHeldBack === undefined ? undefined : getHeldBackReasonMessage(lang, archiveHeldBack);
  if (heldBackReason && disagreement) {
    // Both true at once, and both said. The prefix below already names
    // archive, and a disagreement competing with a held-back note is
    // archive's own by construction — so the phase name it arrived with
    // comes off rather than being written twice in one sentence.
    const archiveWord = stepLabel("archive", lang);
    const detail = disagreement.replace(`${archiveWord} `, "");
    return { variant: "waiting", text: `${t(lang, "list.archiveHeldBack", { step: archiveWord, reason: heldBackReason })} · ${detail}` };
  }
  if (heldBackReason) {
    return { variant: "waiting", text: t(lang, "list.archiveHeldBack", { step: stepLabel("archive", lang), reason: heldBackReason }) };
  }
  if (disagreement) return { variant: "waiting", text: disagreement };
  if (readyToArchive) {
    return { variant: "waiting", text: t(lang, "list.readyToArchive", { button: stepButton("archive") }) };
  }
  return undefined;
}

/** A held-back reason in the reader's language. The acceptance-criteria
 *  reason is the one that is not a sentence an archive run wrote but a
 *  fixed marker (`ACCEPTANCE_CRITERIA_UNTICKED_NOTE`) the board derives
 *  from the file itself — so it is the one that has a catalogue entry to
 *  render from. Every other reason is shown as written. */
export function getHeldBackReasonMessage(lang: Language, reason: string): string {
  return reason === ACCEPTANCE_CRITERIA_UNTICKED_NOTE
    ? formatSentence(lang, { key: "wordPhase.stopAcceptanceCriteriaUnticked" })!
    : reason;
}
