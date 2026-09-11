// Which model and AI a phase is actually ON — the pure resolution rules
// `modelPicker`/`aiPicker`/`phaseCaptionCells` render, split out by
// theme so the reasoning and the markup that reads it are not one file.

import type { QueuePageOptions } from "../queue-list.ts";
import { groupKey, isArchivedRow, type SpecGroup } from "./data-model.ts";

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
export type PickerOptions = Pick<
  QueuePageOptions,
  "modelChoices" | "defaultModels" | "pendingModels" | "pendingEffort"
>;

/** Why a phase that has already run will not take a pick. The same
 *  sentence its own Select box gives as its accessible name: a phase
 *  the row cannot run again is a record of what happened, and its AI
 *  and model selects say so the same way its box does. */
export const ALREADY_RUN_REASON = "already done, and not a step you can run";

/** What each CLI is called on the page. The config's own word is the
 *  short one the runner uses; this is the one a reader picks by.
 *
 *  `fake-claude` is the scripted stand-in a project points
 *  `AIDE_CLAUDE_BIN` at: it speaks Claude Code's own command line and
 *  event format, costs nothing, and answers every step the same way
 *  every time. It is named here so a row running it says so, rather than
 *  reading as a real Claude run. */
export const TOOL_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  "fake-claude": "Fake-Claude",
};

/** The same tools, in the one word a narrow screen has room for. The
 *  compact picker (`aiModelButton`) shows an AI and a model together in
 *  a box eight characters wide — "Claude Code/sonnet" does not fit, and
 *  the second word is not the one that tells the two tools apart. */
export const SHORT_TOOL_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  "fake-claude": "Fake-Claude",
};

/** What one phase line is actually ON: the model, and the tool that
 *  model belongs to. The same two answers `modelPicker` and `aiPicker`
 *  work out for themselves, from the same helpers — read here so the
 *  compact button can say them without a third copy of the reasoning. */
export function phaseAiModel(
  g: SpecGroup,
  opts: PickerOptions,
  step: string,
  used?: string,
  recordedModel?: string,
): { model: string; tool: string } | undefined {
  const models = opts.modelChoices ?? [];
  if (!models.length) return undefined;
  const archived = isArchivedRow(g);
  const configured = opts.defaultModels?.[step] ?? opts.defaultModels?.default;
  const pending = archived ? undefined : opts.pendingModels?.[groupKey(g.project, g.specFolder)]?.[step];
  const model = archived
    ? resolveRecordedModel(models, configured, recordedModel)
    : resolveChosenModel(models, configured, used, pending);
  return { model, tool: models.find((m) => m.name === model)?.tool ?? "claude" };
}
