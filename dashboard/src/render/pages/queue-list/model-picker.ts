import { esc } from "../../ui/html.ts";
import { durationLabel } from "../../ui/job-state.ts";
import type { QueuePageOptions } from "../queue-list.ts";
import { groupKey, isArchivedRow, type SpecGroup } from "./data-model.ts";
import { busyReason, runFormId } from "./cells.ts";

// The picker a phase line carries, and the caption above the list that
// says what the two things on that line are. One `<select>` per phase
// since spec 123: the model is a choice about the PHASE, and a single
// dropdown for the row could only ever set one model for every phase a
// press ticked.
//
// Written outside the Run form's own tags, like the other fields on an
// open row — the `form` attribute is what carries it back, and an id
// that drifts from the form's own silently runs the job on the
// defaults instead.
//
// The figure each model is granted is in the option's TOOLTIP, not its
// label — read out on every option, it was three lines of money on a
// page about work.
//
// The select is PRE-FILLED, never a "default" entry (asked for
// 2026-08-19: "vi trenger jo bare å fylle inn den som er brukt"): a
// phase that has run shows the model it last ran on, one that has not
// shows what the configuration would give it. What is posted is always
// a real name — the queue skips names for steps a job does not run.
/** Which model a phase is actually ON, in one place (spec 179).
 *
 *  A phase that HAS run shows what it ran on; an admin's configured
 *  default outranks the fallback beneath it; and the last resort is the
 *  first entry `modelChoices` LISTS, in configuration order. That last
 *  branch was the first entry of the row's own AI until spec 169 — spec
 *  141 scoped it to a literal `"claude"` and spec 164 to the tool the
 *  row's lead job ran on — but both were there to keep the select
 *  agreeing with a row-wide AI picker, and there is no row-wide AI.
 *
 *  It is a function rather than three lines inside `modelPicker`
 *  because `aiPicker` needs the same answer: the AI a line shows is the
 *  tool of the model that line is on, and a second copy of this
 *  reasoning is a second copy that can drift from it.
 *
 *  `pending` is a fourth, trailing tier (spec 308): a model picked for
 *  this phase before it ever ran, recorded the instant the pick was
 *  made so it survives leaving the page. It sits BENEATH `used` — a
 *  phase that has actually run shows what it ran on, never an earlier
 *  choice about what was to come — and ABOVE `configured`, which is
 *  what a phase nobody has ever picked for still falls back to. */
export function resolveChosenModel(
  models: NonNullable<QueuePageOptions["modelChoices"]>,
  configured: string | undefined,
  used: string | undefined,
  pending?: string,
): string {
  const has = (name?: string) => name !== undefined && models.some((m) => m.name === name);
  return has(used) ? used! : has(pending) ? pending! : has(configured) ? configured! : models[0]!.name;
}

/** What an archived phase's own record wins with (spec 265). A locked
 *  row's select is a record, not a choice, so a genuine record always
 *  wins here — valid choice today or not — unlike `resolveChosenModel`'s
 *  `used`, which is dropped the moment it falls outside `models`. Absent
 *  a record (a step that never ran, `create` above all — no archived
 *  spec's `1-description.md` has ever recorded one), the phase reads
 *  exactly as a live, not-yet-run phase would: the configured default. */
export function resolveRecordedModel(
  models: NonNullable<QueuePageOptions["modelChoices"]>,
  configured: string | undefined,
  recorded: string | undefined,
): string {
  return recorded ?? resolveChosenModel(models, configured, undefined);
}

/** The model an AI choice fills in for one step (spec 179).
 *
 *  The step's configured default when that default belongs to the tool
 *  — "one the configuration names", and the same `defaultModels` table
 *  `modelPicker` already reads — else the first entry `modelChoices`
 *  lists for the tool, in configuration order, which is the fallback
 *  this file already uses one scope wider.
 *
 *  Both are facts about the CONFIGURATION, worked out here and carried
 *  into the markup on the option. The browser copies the value; it
 *  never decides between a tool's models itself. */
export function defaultModelForTool(
  models: NonNullable<QueuePageOptions["modelChoices"]>,
  tool: string,
  configured: string | undefined,
): string | undefined {
  if (configured && models.some((m) => m.name === configured && (m.tool ?? "claude") === tool)) {
    return configured;
  }
  return models.find((m) => (m.tool ?? "claude") === tool)?.name;
}

/** The three fields any of `modelPicker`/`aiPicker`/`phaseCaptionCells`
 *  actually reads out of `QueuePageOptions` (spec 342). The New spec
 *  page's own options carry no `runnerAvailable`, no `targets` — a
 *  spec that does not exist yet has neither — so the three functions
 *  take this narrower shape rather than the whole options type. Every
 *  existing caller already passes a full `QueuePageOptions`, which
 *  satisfies this structurally, so none of them change. */
export type PickerOptions = Pick<QueuePageOptions, "modelChoices" | "defaultModels" | "pendingModels">;

export function modelPicker(
  g: SpecGroup,
  opts: PickerOptions,
  step: string,
  busy: boolean,
  live: boolean,
  used?: string,
  recordedModel?: string,
  /** Replaces `runFormId(g)` on the `form="..."` attribute (spec 342).
   *  The New spec page has no real `project`/`specFolder` to derive one
   *  from — the project is a live dropdown pick and the folder does not
   *  exist until `/aide-create` names it — so it draws one small,
   *  clearly-synthetic `SpecGroup` and gives its own form id here
   *  instead. Nothing else `g` feeds (`isArchivedRow`, the pending-model
   *  lookup, a live row's `data-post-to`) is touched by this. */
  formIdOverride?: string,
): string {
  const models = opts.modelChoices ?? [];
  if (!models.length) return "";
  // Spec 265: an archived row draws the SAME select, disabled, instead
  // of a second, hand-rolled rendering (`lockedModel`, removed). Its
  // value is the phase's own record when it has one, and — same as a
  // live phase that has not run yet — the configured default when it
  // does not, `create` above all: no archived spec's `1-description.md`
  // has ever recorded a model, and a blank cell there read as a bug
  // rather than as "nothing recorded yet".
  const archived = isArchivedRow(g);
  // Spec 225: the same rule the box beside it has followed since spec
  // 160. A phase the running job has not reached is a phase whose
  // model can still be chosen, so the row-level lock is narrowed by
  // the server's own per-phase answer rather than applied wholesale.
  const locked = archived || (busy && !live);
  const why = locked ? busyReason(g) : "";
  const configured = opts.defaultModels?.[step] ?? opts.defaultModels?.["default"];
  // Spec 308: never read for an archived row, whose select is a record
  // of what happened, not a choice about what is to come.
  const pending = archived ? undefined : opts.pendingModels?.[groupKey(g.project, g.specFolder)]?.[step];
  const chosen = archived
    ? resolveRecordedModel(models, configured, recordedModel)
    : resolveChosenModel(models, configured, used, pending);
  return (
    `<select name="model.${esc(step)}" form="${esc(formIdOverride ?? runFormId(g))}"` +
    // Where a live pick goes: the running job's own route, the same
    // convention the tail box's tick already uses. While a job runs the
    // run form asks for a SECOND job and the queue refuses it as a
    // clash, so the select posts itself rather than waiting for a
    // press this row does not offer.
    (live ? ` data-post-to="/api/queue/${esc(g.lead!.id)}/model"` : "") +
    // Whether this select is showing HISTORY or a suggestion, said to
    // the browser (spec 169). It scoped the removed "set all" control
    // to the phases still ahead; it stays because the server saying
    // which phases have run — derived from the same `used` the
    // pre-filled value is — is better than the browser re-deriving it.
    (used !== undefined ? ` data-ran="1"` : "") +
    (locked ? ` disabled title="${esc(why)}"` : "") +
    `>` +
    modelOptions(models, chosen) +
    `</select>`
  );
}

/** A locked phase's own record of what it spent in TIME (spec 247),
 *  beside `lockedModel` above and on the same terms: blank, not a dash,
 *  when the phase's own file names no `Time spent:` line — the same
 *  rule `archiveDateCell`'s duration mark already keeps. No class of its
 *  own: unlike Model, this column is plain, always-visible data, never
 *  hidden behind the `.foldphase` fold Model's own class exists to
 *  survive. */
export function lockedDuration(ms: number | undefined): string {
  return ms === undefined ? "" : `<span class="muted small">${esc(durationLabel(ms))}</span>`;
}

/** Every configured model, grouped by the CLI it starts (spec 169).
 *
 *  The grouping is what carries the tool while the list is open, and
 *  the model's own name — `queue-config.json`'s own key — while it is
 *  closed. The `(codex)` suffix went in spec 167 and is not coming
 *  back.
 *
 *  `data-tool` is (spec 179). It went in spec 169 with the row-wide AI
 *  filter that was the only thing reading it, and it is read for the
 *  opposite reason now: the AI select beside this one has to say which
 *  tool the model this select is on belongs to, and after a hand-picked
 *  model survives the five-second swap this attribute is the only place
 *  that fact lives in the browser. It is read to DISPLAY a tool, never
 *  to hide an option — nothing here is hidden by it or by anything
 *  else, which is the next paragraph's whole point.
 *
 *  Nothing is HIDDEN here either, which is the whole point. Every
 *  phase's select offers every model, so a row can be run analyze on
 *  one CLI and implement on another — which the runner has always
 *  allowed and the filter is what stopped anyone discovering.
 *
 *  `TOOL_NAMES`'s own key order, not the configuration's: which group
 *  comes first is a fact about the page, not about whichever tool an
 *  admin happened to list first. A tool with nothing configured draws
 *  no group at all. */
export function modelOptions(models: NonNullable<QueuePageOptions["modelChoices"]>, chosen?: string): string {
  const groups = Object.keys(TOOL_NAMES)
    .map((tool) => {
      const group = models.filter((m) => (m.tool ?? "claude") === tool);
      if (!group.length) return "";
      return (
        `<optgroup label="${esc(TOOL_NAMES[tool]!)}">` +
        group
          .map(
            (m) =>
              `<option value="${esc(m.name)}" data-tool="${esc(tool)}" title="$${m.budgetUsd} per step"` +
              `${m.name === chosen ? " selected" : ""}>${esc(m.name)}</option>`,
          )
          .join("") +
        `</optgroup>`
      );
    })
    .join("");
  // Spec 265: an archived phase's own record wins unconditionally
  // (`resolveRecordedModel`), including a model retired or renamed since
  // the run — which no group above lists any more. Rather than let that
  // name silently vanish from the select, one bare option carries it,
  // selected, outside any tool's group.
  const known = chosen !== undefined && models.some((m) => m.name === chosen);
  const stale = chosen && !known ? `<option value="${esc(chosen)}" selected>${esc(chosen)}</option>` : "";
  return groups + stale;
}

// What the phase columns under this line are. TWO of them: the phase's
// name, hard left in a cell of its own, and the three choices a line
// offers — the AI, the model, the phase's box — together in the cell
// beside it.
//
// They were flex children of ONE cell until spec 165, pinned to fixed
// widths by hand so every select started at the same x, and spec 165
// made each a real table column to stop the hand-pinning. A column
// reserves a width of its own and carries its own cell padding, though,
// so three of them in a row put two lots of padding and two reserved
// widths between the name and the box — far enough apart that the three
// read as three separate things. Spec 192 puts the AI and the model
// back in one cell for that reason, and the pinned widths do NOT come
// back with them: the one width the cell reserves is stated on the
// model select itself, by name.
//
// The column the merge vacates is the head row's own Progress column.
// A phase line has nothing to put there — it is empty on these lines
// again, exactly as it was before spec 165 moved the model into it.
//
// The caption's cells, WITHOUT the row tag: `phaseSubRows` opens each
// sub-row itself, so the caption can lead whichever row comes first.
//
// The three captions sit in the merged cell together, in the order the
// controls under them are drawn. "AI" is drawn only when there are two
// tools to tell apart, exactly as the picker itself is: a word over
// nothing is worse than no word. "Model" is the single word again — it
// said "AI - Model" from spec 169, when one select held both.
//
// The no-JS floor for the AI picker is written HERE, once for the
// group, rather than five times beside five selects: it is a style
// rule, and one is as good as five. Filling a model in from an AI IS
// the script — a picker that looked pressable and silently did nothing
// would be worse than the removed AI filter's inert degradation ever
// was — and the caption goes with it, since a column headed "AI" with
// nothing under it reads as broken rather than as absent.
export function phaseCaptionCells(opts: PickerOptions): string {
  const tools = new Set((opts.modelChoices ?? []).map((m) => m.tool ?? "claude"));
  return (
    `<td class="phasecell"><span class="muted small">Phase</span></td>` +
    // Each caption over the control it heads, not three words bunched
    // at the left of the cell: `data-cap` pairs a caption with its
    // control, and the stylesheet gives the two the same width. Spec
    // 192 put the three controls in one cell and left the captions
    // sitting where the text ended (2026-08-22).
    `<td class="modelcell"><span class="row">` +
    (tools.size > 1
      ? `<span class="muted small" data-cap="ai" data-ai-cap>AI</span>` +
        `<noscript><style>[data-ai],[data-ai-cap]{display:none}</style></noscript>`
      : "") +
    `<span class="muted small" data-cap="model">Model</span>` +
    `<span class="muted small" data-cap="box">Select</span>` +
    `</span></td><td></td><td data-col="created"></td><td data-col="started"></td>` +
    `<td class="num" data-col="cost"></td>`
  );
}

/** What each CLI is called on the page. The config's own word is the
 *  short one the runner uses; this is the one a reader picks by. */
export const TOOL_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

// The AI a phase will run on, beside the model it will run (spec 179).
// One per phase line, in the column between the phase's name and its
// model — where spec 169's set-all control stood, and spec 127's
// row-wide AI select before that.
//
// Both of those were one control for the whole row, and that is what
// was wrong with them. Spec 127's hid the other tool's models from the
// five phase selects, which is exactly what stopped anyone discovering
// that a row can run analyze on one CLI and implement on another.
// Spec 169's set every phase at once, which is a bulk action and not a
// statement about any line. A phase is where the choice actually lives:
// the runner reads `job.model[step]` per step and derives `--tool` from
// it, so every line gets its own picker and every line is set the same
// way as every other.
//
// It POSTS NOTHING — no `name` — so a press still sends the same five
// `model.<step>` fields it always did. What a phase runs on stays ONE
// value on the job, and the tool is derived from it; this select is
// that derivation shown, never a second fact the job could disagree
// with. It is READ on change, to fill the model select in, and WRITTEN
// on redraw, to reflect whatever that select ended up on. Never the
// reverse.
//
// Drawn only when there are two TOOLS to choose between. The control it
// replaced counted MODELS instead — two Claude entries and no Codex one
// was still a row worth setting in one action — and that is the other
// question: an AI picker offering one AI has nothing to offer. A
// single-tool deployment with several models therefore loses the
// one-action bulk set it had, which is what "'Set all' shall be removed"
// asks for.
//
// Each option carries the model that AI fills in, worked out by
// `defaultModelForTool` HERE rather than in the browser: which model an
// AI stands for is a configuration fact, and the page is where
// configuration is read, not where it is decided.
//
// `data-ai` names the model select this one writes — the same `name`
// that select posts under. That plus the shared `form` id is the whole
// of the pairing, because both are written outside the run form's own
// tags and tied to it by that attribute alone.
export function aiPicker(
  g: SpecGroup,
  opts: PickerOptions,
  step: string,
  busy: boolean,
  live: boolean,
  used?: string,
  recordedModel?: string,
  /** Same override, same reason, as `modelPicker`'s own (spec 342). */
  formIdOverride?: string,
): string {
  const models = opts.modelChoices ?? [];
  // `TOOL_NAMES`'s own key order, like the option groups in
  // `modelOptions`: which AI comes first is a fact about the page, not
  // about whichever tool an admin happened to list first.
  const tools = Object.keys(TOOL_NAMES).filter((t) => models.some((m) => (m.tool ?? "claude") === t));
  if (tools.length < 2) return "";
  // Spec 265: drawn, disabled, on an archived row too — same reasoning
  // as `modelPicker`'s own archived branch, since this select says which
  // AI the model BESIDE it belongs to, and that model is drawn now
  // whether or not the row is locked.
  const archived = isArchivedRow(g);
  // Spec 225, and the same `live` the model select beside it takes.
  // This one carries no `data-post-to`: it posts nothing itself, and a
  // pick made on it reaches the server through the model select it
  // writes into.
  const locked = archived || (busy && !live);
  const why = locked ? busyReason(g) : "";
  const configured = opts.defaultModels?.[step] ?? opts.defaultModels?.["default"];
  // Spec 308: the same pending pick `modelPicker` reads, so the two
  // controls cannot disagree about it either.
  const pending = archived ? undefined : opts.pendingModels?.[groupKey(g.project, g.specFolder)]?.[step];
  // The same answer `modelPicker` pre-fills its select with, from the
  // same helper: the AI shown is the tool of the model this line is on,
  // so the two controls cannot disagree about it.
  const on = archived
    ? resolveRecordedModel(models, configured, recordedModel)
    : resolveChosenModel(models, configured, used, pending);
  const restingTool = models.find((m) => m.name === on)?.tool ?? "claude";
  return (
    `<select data-ai="model.${esc(step)}" form="${esc(formIdOverride ?? runFormId(g))}"` +
    (locked ? ` disabled title="${esc(why)}"` : "") +
    `>` +
    tools
      .map(
        (t) =>
          `<option value="${esc(t)}"` +
          ` data-default="${esc(defaultModelForTool(models, t, configured) ?? "")}"` +
          `${t === restingTool ? " selected" : ""}>${esc(TOOL_NAMES[t]!)}</option>`,
      )
      .join("") +
    `</select>`
  );
}
