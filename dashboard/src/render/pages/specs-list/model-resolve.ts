// Which model and AI a phase is actually ON — the pure resolution rules
// `modelPicker`/`aiPicker`/`phaseCaptionCells` render, split out by
// theme so the reasoning and the markup that reads it are not one file.

import type { SpecsPageOptions } from "./";
import { compactModelLabels } from "../../../page-contract.ts";
import { asRunnableTool } from "../../../queue/steps.ts";
import { RUNNABLE_TOOLS, SHORT_TOOL_NAMES, TOOL_NAMES, providerFamily, type ProviderTool } from "../../../queue/providers/tools.ts";
import { groupKey, isArchivedRow, type SpecGroup } from "./data-model";

// The select is PRE-FILLED, never a "default" entry (asked for
// 2026-08-19: "vi trenger jo bare å fylle inn den som er brukt"): a
// phase that has run shows the model it last ran on, one that has not
// shows what the configuration would give it. What is posted is always
// a real name — the queue skips names for steps a job does not run.
/** Which model a phase is actually ON, in one place.
 *
 *  A phase that HAS run shows what it ran on; an admin's configured
 *  default outranks the fallback beneath it; and the last resort is the
 *  first entry `modelChoices` LISTS, in configuration order. That last
 *  branch is not scoped to a literal `"claude"` or to the tool the
 *  row's lead job ran on: that would only keep the select agreeing
 *  with a row-wide AI picker, and there is no row-wide AI.
 *
 *  It is a function rather than three lines inside `modelPicker`
 *  because `aiPicker` needs the same answer: the AI a line shows is the
 *  tool of the model that line is on, and a second copy of this
 *  reasoning is a second copy that can drift from it.
 *
 *  `pending` is a fourth, trailing tier: a model picked for
 *  this phase before it ever ran, recorded the instant the pick was
 *  made so it survives leaving the page. It sits BENEATH `used` — a
 *  phase that has actually run shows what it ran on, never an earlier
 *  choice about what was to come — and ABOVE `configured`, which is
 *  what a phase nobody has ever picked for still falls back to. */
export function resolveChosenModel(
  models: NonNullable<SpecsPageOptions["modelChoices"]>,
  configured: string | undefined,
  used: string | undefined,
  pending?: string,
  recorded?: string,
): string {
  const has = (name?: string) => name !== undefined && models.some((m) => m.name === name);
  // A phase that has run shows what it ran on, whatever the choices are
  // called today: the job's own choice name first, the model the file
  // recorded when that name has been renamed away, and the bare name
  // when neither is offered any more — never the default in its place.
  if (has(used)) return used!;
  if (used !== undefined) return has(recorded) ? recorded! : used;
  return has(pending) ? pending! : has(configured) ? configured! : models[0]!.name;
}

/** What an archived phase's own record wins with. A locked
 *  row's select is a record, not a choice, so a genuine record always
 *  wins here — valid choice today or not — unlike `resolveChosenModel`'s
 *  `used`, which is dropped the moment it falls outside `models`. Absent
 *  a record (a step that never ran, `create` above all — no archived
 *  spec's `1-description.md` has ever recorded one), the phase reads
 *  exactly as a live, not-yet-run phase would: the configured default. */
export function resolveRecordedModel(
  models: NonNullable<SpecsPageOptions["modelChoices"]>,
  configured: string | undefined,
  recorded: string | undefined,
): string {
  if (recorded === undefined) return resolveChosenModel(models, configured, undefined);
  // A phase file records the model as its run named it (`opus`, or a full
  // id); the choice that runs it may be spelt `Opus`, or be named by that id.
  const word = recorded.toLowerCase();
  return models.find((m) => m.name.toLowerCase() === word || m.named?.id === recorded)?.name ?? recorded;
}

/** The model an AI choice fills in for one step.
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
  models: NonNullable<SpecsPageOptions["modelChoices"]>,
  tool: string,
  configured: string | undefined,
): string | undefined {
  if (configured && models.some((m) => m.name === configured && providerToolOf(m.tool) === tool)) {
    return configured;
  }
  return models.find((m) => providerToolOf(m.tool) === tool)?.name;
}

/** The tool a provider needs to run a model choice: its own, with a
 *  choice that names none or the scripted stand-in run by Claude Code. */
export const providerToolOf = (tool: string | undefined): string =>
  tool === undefined ? "claude" : (RUNNABLE_TOOLS as readonly string[]).includes(tool) ? providerFamily(tool as (typeof RUNNABLE_TOOLS)[number]) : tool;

/** A provider as a picker offers it: its key (the value posted), its name
 *  and the tool whose models it runs. */
export interface ProviderOption {
  key: string;
  name: string;
  tool: ProviderTool;
  /** Switched off in Settings → Providers. */
  off?: boolean;
}

/** The providers a picker shows: every one that is switched on, and a
 *  switched-off one only when it is `chosen`, so a choice already on it is
 *  shown as it is and posted back unchanged. */
export function offeredProviders(providers: readonly ProviderOption[], chosen?: string): ProviderOption[] {
  return providers.filter((p) => !p.off || p.key === chosen);
}

/** The provider a phase line is on. The first of `picks` (a job's own
 *  provider for the step, then a pending pick) that is listed and runs the
 *  model's tool; else the configured one for the step when it does; else the
 *  first listed provider that is switched on and does — the runner's own
 *  order (`resolveStepProvider`). */
export function resolveProvider(
  opts: Pick<SpecsPageOptions, "modelChoices" | "providerChoices" | "defaultProviders">,
  step: string,
  model: string | undefined,
  picks: readonly (string | undefined)[],
): ProviderOption | undefined {
  const providers = opts.providerChoices ?? [];
  const tool = providerToolOf(opts.modelChoices?.find((m) => m.name === model)?.tool);
  const runs = (p: ProviderOption | undefined): p is ProviderOption => p !== undefined && p.tool === tool;
  for (const key of picks) {
    const found = providers.find((p) => p.key === key);
    if (runs(found)) return found;
  }
  const wanted = providers.find((p) => p.key === opts.defaultProviders?.[step]);
  return runs(wanted) ? wanted : providers.find((p) => !p.off && runs(p));
}

/** The three fields any of `modelPicker`/`aiPicker`/`phaseCaptionCells`
 *  actually reads out of `SpecsPageOptions`. The New spec
 *  page's own options carry no `runnerAvailable`, no `targets` — a
 *  spec that does not exist yet has neither — so the three functions
 *  take this narrower shape rather than the whole options type. Every
 *  existing caller already passes a full `SpecsPageOptions`, which
 *  satisfies this structurally, so none of them change. */
export type PickerOptions = Pick<
  SpecsPageOptions,
  "modelChoices" | "defaultModels" | "pendingModels" | "providerChoices" | "defaultProviders" | "pendingProviders"
>;

export { SHORT_TOOL_NAMES, TOOL_NAMES };

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
  /** The CLI the phase's own result names — what stands in for the
   *  tool when the model's choice name is no longer configured. */
  usedTool?: string,
  /** The provider the phase's job, or its result, names. */
  usedProvider?: string,
): { model: string; tool: string; provider?: string } | undefined {
  const models = opts.modelChoices ?? [];
  if (!models.length) return undefined;
  const archived = isArchivedRow(g);
  const configured = opts.defaultModels?.[step] ?? opts.defaultModels?.default;
  const pending = archived ? undefined : opts.pendingModels?.[groupKey(g.project, g.specFolder)]?.[step];
  const model = archived
    ? resolveRecordedModel(models, configured, recordedModel)
    : resolveChosenModel(models, configured, used, pending, recordedModel);
  const tool = models.find((m) => m.name === model)?.tool ?? usedTool ?? "claude";
  const gone = usedProvider !== undefined && !(opts.providerChoices ?? []).some((p) => p.key === usedProvider);
  const provider = gone
    ? undefined
    : resolveProvider(
        opts, step, model,
        [usedProvider, archived ? undefined : opts.pendingProviders?.[groupKey(g.project, g.specFolder)]?.[step]],
      );
  return { model, tool, ...(gone ? { provider: usedProvider } : provider ? { provider: provider.name } : {}) };
}

/** A tool's one-word name, or the word as it was written when the dashboard names no such tool. */
const shortToolName = (tool: string): string => {
  const known = asRunnableTool(tool);
  return known ? SHORT_TOOL_NAMES[known] : tool;
};

/** The compact button's own text: the model's
 *  bare name, unless another entry in the SAME array carries that
 *  exact name — a tool prefix then goes in front, "Codex · gpt-6"
 *  (the description's own example). Written over the array
 *  `SpecsPageOptions.modelChoices` already is, not the config's
 *  `Record`, so a fixture built with two same-named entries exercises
 *  the tie-break directly; a real `queue-config.json` cannot produce
 *  one today, since the Record's own key IS the name
 *  (`ModelChoice`'s own comment) and a JS object cannot hold two
 *  identical keys. The shared contract applies the label rule after
 *  this server adapter supplies its plain values. */
export function compactModelLabel(
  models: NonNullable<SpecsPageOptions["modelChoices"]>,
  on: { model: string; tool: string; provider?: string } | undefined,
): string {
  return compactModelLabels(
    models.map((model) => model.name),
    on ? { model: on.model, short: on.provider ?? shortToolName(on.tool) } : undefined,
  ).short;
}

/** The FULL text the growing button shows once there is room for it
 *  always tool-prefixed, unlike `compactModelLabel()`'s
 *  own collision-only rule. Identical to `compactModelLabel()`'s own
 *  output whenever a collision already forces the prefix there. */
export function compactModelLabelFull(
  _models: NonNullable<SpecsPageOptions["modelChoices"]>,
  on: { model: string; tool: string; provider?: string } | undefined,
): string {
  return compactModelLabels(
    _models.map((model) => model.name),
    on ? { model: on.model, short: on.provider ?? shortToolName(on.tool) } : undefined,
  ).full;
}
