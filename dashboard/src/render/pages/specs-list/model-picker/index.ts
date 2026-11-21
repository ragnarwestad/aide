import { esc } from "../../../ui/html.ts";
import { durationLabel } from "../../../ui/job-state";
import { aliasLabel, modelName } from "../../../ui/components/model-label.ts";
import { providerFace } from "../../../ui/components/icons.ts";
import { t, type Language } from "../../../../i18n";
import type { SpecsPageOptions } from "../";
import { groupKey, type SpecGroup } from "../data-model";
import { runFormId } from "../cells.ts";
import {
  TOOL_NAMES,
  phaseLine,
  providerToolOf,
  resolveChosenModel,
  resolveProvider,
  shortOf,
  type LineProvider,
  type PhaseFacts,
  type PickerOptions,
} from "../model-resolve.ts";
import { type PickPart } from "../../../../queue/providers/side-tools.ts";
import { RUNNABLE_TOOLS, asProviderTool } from "../../../../queue/providers/tools.ts";
import { modelSelect, providerSelect } from "./selects.ts";

export { modelSelect, providerSelect } from "./selects.ts";

export {
  SHORT_TOOL_NAMES,
  TOOL_NAMES,
  defaultModelForTool,
  offeredProviders,
  phaseAiModel,
  phaseLine,
  providerToolOf,
  resolveChosenModel,
  resolveProvider,
  resolveRecordedModel,
  type PhaseFacts,
  type PickerOptions,
  type ProviderOption,
} from "../model-resolve.ts";

// The picker a phase line carries, and the caption above the list that
// says what the two things on that line are. One `<select>` per phase,
// because the model is a choice about the PHASE, and a single
// dropdown for the row could only ever set one model for every phase a
// press ticked.
//
// Written outside the Run form's own tags, like the other fields on an
// open row — the `form` attribute is what carries it back, and an id
// that drifts from the form's own silently runs the job on the
// defaults instead.
//
// The figure each model is granted is in the option's own visible
// label — an `<option>` cannot host a "(?)", the one
// exception to this dashboard's own rule that an explanation is never
// a hover-only `title`.
export function modelPicker(
  g: SpecGroup,
  opts: PickerOptions,
  step: string,
  busy: boolean,
  facts: PhaseFacts,
  /** Replaces `runFormId(g)` on the `form="..."` attribute.
   *  The New spec page has no real `project`/`specFolder` to derive one
   *  from — the project is a live dropdown pick and the folder does not
   *  exist until `/aide-create` names it — so it draws one small,
   *  clearly-synthetic `SpecGroup` and gives its own form id here
   *  instead. Nothing else `g` feeds (`isArchivedRow`, the pending-model
   *  lookup, a live row's `data-post-to`) is touched by this. */
  formIdOverride?: string,
  /** This phase cannot be run from this row again — its box is drawn
   *  ticked and disabled, so this select is locked with it. */
  alreadyRun = false,
  /** The model id the phase's own run reported, when it has one. */
  ranModelId?: string,
): string {
  // An archived row draws the SAME select, disabled, instead
  // of a second, hand-rolled rendering (`lockedModel`, removed). Its
  // value is the phase's own record when it has one, and — same as a
  // live phase that has not run yet — the configured default when it
  // does not, `create` above all: no archived spec's `1-description.md`
  // has ever recorded a model, and a blank cell there read as a bug
  // rather than as "nothing recorded yet".
  const line = phaseLine(g, opts, step, facts);
  if (!line) return "";
  const live = facts.live;
  // The same rule the box beside it follows.
  // A phase the running job has not reached is a phase whose
  // model can still be chosen, so the row-level lock is narrowed by
  // the server's own per-phase answer rather than applied wholesale.
  const locked = line.record || (!g.named && !formIdOverride) || (busy && !live) || alreadyRun;
  return modelSelect({
    name: `model.${step}`,
    form: formIdOverride ?? runFormId(g),
    opts: { ...opts, modelChoices: pickerModels(opts.modelChoices ?? [], line.model, line.record || alreadyRun, ranModelId) },
    chosen: line.model,
    disabled: locked,
    ranModelId,
    postTo: live ? `/api/queue/${g.lead!.id}/model` : undefined,
    ran: facts.used !== undefined,
  });
}

/** The options as a picker names them, each with a version: what the
 *  alias gives today while the select is a choice — a phase that ran
 *  before and may run again included — and, once the select is a record,
 *  what the phase ran on for the chosen model, where its run reported it. */
export function pickerModels<M extends { name: string; ranAs?: string }>(
  models: M[],
  chosen: string | undefined,
  record: boolean,
  ranModelId: string | undefined,
): M[] {
  if (!record || !ranModelId) return models;
  return models.map((m) => (m.name === chosen ? { ...m, ranAs: ranModelId } : m));
}

/** A locked phase's own record of what it spent in TIME, on
 *  the same terms as its model: blank, not a dash, when the phase's own
 *  file names no `Time spent:` line — the same rule `archiveDateCell`'s
 *  duration mark already keeps. */
export function lockedDuration(ms: number | undefined): string {
  // A dash where nothing was recorded, never `0s` and never an empty
  // cell: the column answers "how long did this phase take", a blank
  // leaves the reader asking whether it ran at all, and `0s` claims a
  // measurement nobody made. The same dash the Cost column beside it
  // already draws for a figure it does not have.
  const label = ms === undefined ? "–" : durationLabel(Math.max(0, ms));
  return `<span class="muted small">${esc(label)}</span>`;
}

/** Every configured model, grouped by the CLI it starts.
 *
 *  The grouping is what carries the tool while the list is open, and
 *  the model's own name — `queue-config.json`'s own key — while it is
 *  closed. There is no `(codex)` suffix.
 *
 *  `data-tool` is read to say which tool a model belongs to: the AI select beside this one has to say which
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
 *  `RUNNABLE_TOOLS`'s own order, not the configuration's: which group
 *  comes first is a fact about the page, not about whichever tool an
 *  admin happened to list first. A tool with nothing configured draws
 *  no group at all. */
/** A recorded model no choice names any more: by the version it ran on
 *  where its run reported one, else by the word it was recorded as. */
export function recordLabel(recorded: string, ranModelId: string | undefined): string {
  return modelName(ranModelId) ?? recorded;
}

export function modelOptions(
  models: NonNullable<SpecsPageOptions["modelChoices"]>,
  chosen?: string,
  ranModelId?: string,
): string {
  const groups = RUNNABLE_TOOLS
    .map((tool) => {
      const group = models.filter((m) => (m.tool ?? "claude") === tool);
      if (!group.length) return "";
      return (
        `<optgroup label="${esc(TOOL_NAMES[tool])}">` +
        group
          .map(
            (m) =>
              `<option value="${esc(m.name)}" data-tool="${esc(providerToolOf(tool))}"` +
              // The option's own label is the model's name
              // alone — a per-step dollar figure would read as a price,
              // so the config does not carry one.
              // What the alias gives today, when it has run: `Opus 5.5`.
              `${m.name === chosen ? " selected" : ""}>${esc(aliasLabel(m.name, m.ranAs, m.named))}</option>`,
          )
          .join("") +
        `</optgroup>`
      );
    })
    .join("");
  // An archived phase's own record wins unconditionally
  // (`resolveRecordedModel`), including a model retired or renamed since
  // the run — which no group above lists any more. Rather than let that
  // name silently vanish from the select, one bare option carries it,
  // selected, outside any tool's group.
  const known = chosen !== undefined && models.some((m) => m.name === chosen);
  const stale = chosen && !known ? `<option value="${esc(chosen)}" selected>${esc(recordLabel(chosen, ranModelId))}</option>` : "";
  return groups + stale;
}

// What the phase columns under this line are. TWO of them: the phase's
// name, hard left in a cell of its own, and the three choices a line
// offers — the AI, the model, the phase's box — together in the cell
// beside it.
//
// They are not flex children pinned to fixed widths by hand, and not
// three real table columns either. A column reserves a width of its own
// and carries its own cell padding, so three of them in a row would put
// two lots of padding and two reserved widths between the name and the
// box — far enough apart that the three read as three separate things.
// The AI and the model share one cell for that reason, and no pinned
// widths come with them: the one width the cell reserves is stated on
// the model select itself, by name.
//
// The column the merge vacates is the head row's own Progress column.
// A phase line has nothing to put there — it is empty on these lines.
//
// The caption's cells, WITHOUT the row tag: `phaseSubRows` opens each
// sub-row itself, so the caption can lead whichever row comes first.
//
// The three captions sit in the merged cell together, in the order the
// controls under them are drawn. "AI" is drawn only when there are two
// tools to tell apart, exactly as the picker itself is: a word over
// nothing is worse than no word. "Model" is the single word, since no
// one select holds both.
//
// The no-JS floor for the AI picker is written HERE, once for the
// group, rather than five times beside five selects: it is a style
// rule, and one is as good as five. Filling a model in from an AI IS
// the script — a picker that looked pressable and silently did nothing
// would be worse than the removed AI filter's inert degradation ever
// was — and the caption goes with it, since a column headed "AI" with
// nothing under it reads as broken rather than as absent.
// `includeListColumns`: the Specs list's own 6-column table
// needs these 4 blank cells to keep every row's cell count matching its
// <colgroup> (row-shared.ts's LIST_COLUMNS). The New spec page's table
// has no Progress/Created/Started/Cost concept at all — a spec that
// does not exist yet has none of those facts — and no <colgroup>
// either, so the same 4 cells there had nothing under them and nothing
// sizing them, which is what read as a stray blank field beside the
// picker.
export function phaseCaptionCells(
  opts: PickerOptions,
  includeListColumns = true,
  /** The row's one action, drawn in the State column of this line
   *  (2026-09-08): the head line above says what the spec IS, and this
   *  line heads what it is set to do — so the press that acts on all of
   *  it sits at the end of the same line, under the State column it used
   *  to stand in on the row above. */
  action = "",
  // A genuinely new parameter, not `opts.lang`: `PickerOptions`
  // is narrower than `SpecsPageOptions` and carries no `lang` of its own
  // — both call sites already resolve one for other purposes.
  lang: Language = "en",
  /** The spec's own Time and Cost, for the caption line under an open
   *  row. */
  totals: { started: string; cost: string } = { started: "", cost: "" },
  /** A table that shows what each phase runs on, and selects nothing,
   *  has no "Select" column to head. */
  withBox = true,
  state = "",
): string {
  const tools = new Set((opts.modelChoices ?? []).map((m) => m.tool ?? "claude"));
  return (
    // The chevron's column is the head row's alone: a phase line spans
    // it with its own first cell, so the lines under a head row start
    // at the row's left edge rather than a column in.
    `<td class="phasecell"${includeListColumns ? ` colspan="2"` : ""}><span class="muted small">${t(lang, "list.captionPhase")}</span></td>` +
    // Each caption over the control it heads, not three words bunched
    // at the left of the cell: `data-cap` pairs a caption with its
    // control, and the stylesheet gives the two the same width.
    // With the three controls in one cell, the captions would be left
    // sitting where the text ended.
    `<td class="modelcell"><span class="row">` +
    // The caption follows `aiPicker`: drawn whenever any tool is
    // configured, so the heading and the control under it can never
    // disagree about which column is which.
    (tools.size > 0
      ? `<span class="muted small" data-cap="ai" data-ai-cap>${t(lang, "list.captionAi")}</span>`
      : "") +
    `<span class="muted small" data-cap="model">${t(lang, "list.captionModel")}</span>` +
    (withBox ? `<span class="muted small" data-cap="box">${t(lang, "list.captionSelect")}</span>` : "") +
    `</span></td>` +
    (includeListColumns
      ? `<td data-col="state"><span class="row"><span class="badgeslot">${state}</span>${action ? `<span class="actionslot">${action}</span>` : ""}</span></td>` +
        `<td data-col="started">${totals.started}</td>` +
        `<td class="num" data-col="cost">${totals.cost}</td>`
      : "")
  );
}

// The provider a phase will run on, beside the model it will run.
// One per phase line, in the column between the phase's name and its
// model — not a row-wide select or a set-all control. A phase is where
// the choice lives: the runner reads the job's provider and model per
// step and derives `--tool` from the model, so every line gets its own
// picker and is set the same way as every other.
//
// It POSTS `provider.<step>` beside the `model.<step>` it is paired with,
// and a pick made on it reaches the server through the browser, which also
// narrows the model select to the models the provider's tool runs and
// fills in the model the option carries.
//
// Each option carries the tool whose models it runs (`data-tool`, `claude`
// for a stand-in), the model it fills in (`data-default`, worked out by
// `defaultModelForTool` HERE rather than in the browser: which model a
// provider stands for is a configuration fact) and the short name the
// face shows (`data-short`).
//
// A closed select shows only its chosen option's text, and an option holds
// text only, so the select is wrapped with a face — the tool's mark and the
// short name — laid over its own text (`providerPick`). The open list keeps
// the full names, and the select's `title` and `aria-label` say the chosen
// one's.
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
  facts: PhaseFacts,
  /** Same override, same reason, as `modelPicker`'s own. */
  formIdOverride?: string,
  /** Same flag, same reason, as `modelPicker`'s own. */
  alreadyRun = false,
): string {
  // Drawn for a single provider too: one entry is a statement rather than
  // a choice, which is what the column is for.
  if ((opts.providerChoices ?? []).length === 0) return "";
  // The same answer the model select beside it and the closed button read,
  // so the three cannot disagree. Drawn, disabled, on an archived row too,
  // since this select says which provider the model BESIDE it belongs to.
  const line = phaseLine(g, opts, step, facts);
  if (!line) return "";
  const locked = line.record || (!g.named && !formIdOverride) || (busy && !facts.live) || alreadyRun;
  const configured = opts.defaultModels?.[step] ?? opts.defaultModels?.default;
  const common = { name: `provider.${step}`, modelName: `model.${step}`, form: formIdOverride ?? runFormId(g), opts, configured, disabled: locked };
  // A removed provider is named by its key, on the tool the line is on.
  return line.removed
    ? providerSelect({ ...common, removed: line.removed })
    : providerSelect({ ...common, chosenProvider: line.provider?.key });
}

export function sidePickers(
  g: SpecGroup,
  opts: PickerOptions & { lang?: Language },
  part: PickPart,
  locked: boolean,
  /** The model id the session's own run reported, when it ran. */
  ranModelId?: string,
  /** The provider recorded when this side run was launched. */
  ranProviderKey?: string,
  /** What the line follows with no choice of its own, in place of the default. */
  rests?: { model: string; provider?: string },
  formId = runFormId(g),
  /** The model the phase's job was given for this line. A line that can no
   *  longer be changed shows it, not today's settings. */
  jobModel?: string,
): string {
  const models = opts.modelChoices ?? [];
  const choices = models;
  const providers = opts.providerChoices ?? [];
  const key = groupKey(g.project, g.specFolder);
  const saved = opts.pendingModels?.[key]?.[part] ?? "";
  const follows = rests && !saved && opts.defaultModels?.[part] === undefined ? rests : undefined;
  const configured = opts.defaultModels?.[part] ?? follows?.model ?? opts.defaultModels?.default;
  const chosen = resolveChosenModel(choices, configured, locked || !g.named ? jobModel : undefined, saved);
  const provider = opts.pendingProviders?.[key]?.[part] ?? "";
  const resting = resolveProvider({ ...opts, modelChoices: choices, providerChoices: providers }, part, chosen, [ranProviderKey, provider, follows?.provider]);
  const disabled = locked || !g.named ? " disabled" : "";
  const ai = providerSelect({ name: `provider.${part}`, modelName: `model.${part}`, form: formId, opts, configured: chosen, chosenProvider: resting?.key, disabled: !!disabled });
  const model = modelSelect({ name: `model.${part}`, form: formId, opts: { ...opts, modelChoices: pickerModels(models, chosen, ranModelId !== undefined, ranModelId) }, chosen, disabled: !!disabled, ranModelId });
  const tool = models.find((m) => m.name === chosen)?.tool ?? "claude";
  return compactAiModel({
    id: `aim-${key}-${part}`,
    lang: opts.lang ?? "en",
    ai,
    model,
    locked: !!disabled,
    on: { model: chosen, tool, ...(resting ? { provider: { name: resting.name, short: shortOf(resting) } } : {}) },
  });
}

/** A line's AI and model as one control: on a phone a button naming the
 *  choice that opens a panel holding the two selects, elsewhere the two
 *  selects side by side (`narrow.css` decides). The button leads with the
 *  provider's face — its tool's mark and its short name — then the model,
 *  and says the provider's full name in its `title`. A locked line draws
 *  the button unpressable, since its selects are a record, not a choice. */
export function compactAiModel(o: {
  id: string;
  lang: Language;
  ai: string;
  model: string;
  locked: boolean;
  on: { model: string; tool: string; provider?: LineProvider } | undefined;
}): string {
  const now = (o.on ? providerFace(asProviderTool(providerToolOf(o.on.tool)), o.on.provider?.short) : "") +
    `<span class="aimodelshort">${esc(o.on?.model ?? "")}</span>`;
  const title = o.on ? ` title="${esc(o.on.provider ? `${o.on.provider.name} · ${o.on.model}` : o.on.model)}"` : "";
  const button = o.locked
    ? `<span class="aimodelnow" aria-disabled="true"${title}>${now}</span>`
    : `<input type="checkbox" class="aimodelopen" id="${esc(o.id)}">` +
      `<label class="aimodelnow" for="${esc(o.id)}"${title}>${now}</label>`;
  return (
    `<span class="aimodel">${button}<span class="aimodelpanel">` +
    (o.ai ? `<label class="aimodelfield"><span>${t(o.lang, "list.captionAi")}</span>${o.ai}</label>` : "") +
    `<label class="aimodelfield"><span>${t(o.lang, "list.captionModel")}</span>${o.model}</label>` +
    `</span></span>`
  );
}
