// Which model and AI a phase is actually ON — the pure resolution rules
// `modelPicker`/`aiPicker`/`phaseCaptionCells` render, split out by
// theme so the reasoning and the markup that reads it are not one file.

import type { SpecsPageOptions } from "./";
import { shortNameFrom } from "../../../queue/providers/short-name.ts";
import { asProviderTool, type ProviderTool } from "../../../queue/providers/tools.ts";
import { providerToolOf, resolveChosenModel, resolveProvider, shortOf, type ModelChoice, type ProviderOption } from "../../ui/ai-model";
import { groupKey, lockedAsArchived, type SpecGroup } from "./data-model";
import { forProject, projectSets } from "../../../queue/providers/project-defaults.ts";

/** What an archived phase's own record wins with. A locked
 *  row's select is a record, not a choice, so a genuine record always
 *  wins here — valid choice today or not — unlike `resolveChosenModel`'s
 *  `used`, which is dropped the moment it falls outside `models`. Absent
 *  a record (a step that never ran, `create` above all — no archived
 *  spec's `1-description.md` has ever recorded one), the phase reads
 *  exactly as a live, not-yet-run phase would: the configured default. */
export function resolveRecordedModel(
  models: ModelChoice[],
  configured: string | undefined,
  recorded: string | undefined,
): string {
  if (recorded === undefined) return resolveChosenModel(models, configured, undefined);
  // A phase file records the model as its run named it (`opus`, or a full
  // id); the choice that runs it may be spelt `Opus`, or be named by that id.
  const word = recorded.toLowerCase();
  return models.find((m) => m.name.toLowerCase() === word || m.named?.id === recorded)?.name ?? recorded;
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
  "modelChoices" | "defaultModels" | "pendingModels" | "providerChoices" | "defaultProviders" | "pendingProviders" | "projectChoices"
>;

/** The options a line of `project`'s spec is drawn from: the board's
 *  defaults with the project's own choices laid over them, the same table
 *  the runner resolves that project's steps against (`forProject`). */
export function pickerFor<O extends PickerOptions>(opts: O, project: string): O {
  if (!opts.projectChoices?.[project]) return opts;
  const own = forProject({ model: opts.defaultModels ?? {}, provider: opts.defaultProviders, projectModels: opts.projectChoices }, project);
  return { ...opts, defaultModels: own.model, defaultProviders: own.provider };
}

/** Whether a line that rests on its configured model rests on the
 *  project's own choice for `step`, rather than on the board's. */
export function restsOnProject(opts: PickerOptions, project: string, step: string, model: string): boolean {
  return projectSets({ projectModels: opts.projectChoices }, project, step) && opts.projectChoices?.[project]?.model?.[step] === model;
}

/** The provider a phase line is on, as its compact button names it: by
 *  name, and by the short name its face shows. */
export interface LineProvider {
  name: string;
  short: string;
}

/** What a phase line's own job and results say about it, gathered once
 *  for the button and the two selects. */
export interface PhaseFacts {
  /** The running job has not reached this step: its pick is still open. */
  live: boolean;
  /** The model choice the phase's job ran on. */
  used?: string;
  /** The model the phase's own file recorded. */
  recordedModel?: string;
  /** The CLI the phase's own result names — what stands in for the
   *  tool when the model is no longer configured. */
  usedTool?: string;
  /** The provider the phase's job, or its result, names. */
  usedProvider?: string;
}

/** One phase line's answer: what it is on, and whether that is a record. */
export interface PhaseLine {
  /** The line is a record of an archived row, not a choice. */
  record: boolean;
  model: string;
  /** The model's tool when it is configured, else the recorded one. */
  tool: string;
  /** The provider it is on, when one in Settings runs its tool. */
  provider?: ProviderOption;
  /** The provider it ran on, since removed from Settings: named by its key. */
  removed?: { key: string; tool: ProviderTool | undefined; short: string };
  /** The line rests on the project's own choice for the step. */
  fromProject?: boolean;
}

/** The pick a phase that has not run yet pre-fills from. A phase the
 *  running job can still take has its pick on that job — where a pick
 *  made while it runs is written — ahead of the spec's own record. */
export function pendingPick(
  g: SpecGroup,
  opts: { pendingModels?: Record<string, Record<string, string>> },
  step: string,
  live: boolean,
): string | undefined {
  return (live ? g.lead?.stepModels?.[step] : undefined) ?? opts.pendingModels?.[groupKey(g.project, g.specFolder)]?.[step];
}

/** What one phase line is on — model, tool and provider — in one place,
 *  read by the closed button (`phaseAiModel`) and by the two selects inside
 *  it (`modelPicker`, `aiPicker`), so the three cannot disagree. */
export function phaseLine(g: SpecGroup, board: PickerOptions, step: string, facts: PhaseFacts): PhaseLine | undefined {
  const opts = pickerFor(board, g.project);
  const models = opts.modelChoices ?? [];
  if (!models.length) return undefined;
  const record = lockedAsArchived(g, step);
  const configured = opts.defaultModels?.[step] ?? opts.defaultModels?.default;
  // A record is what happened, never a choice about what is to come.
  const pending = pendingPick(g, opts, step, facts.live);
  const model = record
    ? resolveRecordedModel(models, configured, facts.recordedModel)
    : resolveChosenModel(models, configured, facts.used, pending, facts.recordedModel);
  const fromProject = !record && facts.used === undefined && !models.some((m) => m.name === pending) && restsOnProject(opts, g.project, step, model);
  const listed = models.find((m) => m.name === model);
  const tool = listed ? (listed.tool ?? "claude") : (facts.usedTool ?? "claude");
  const usedProvider = facts.usedProvider;
  // A provider the step ran on that has since been removed is still the
  // one it ran on: shown by its key, never replaced by another of its tool.
  if (usedProvider !== undefined && !(opts.providerChoices ?? []).some((p) => p.key === usedProvider)) {
    return { record, model, tool, removed: { key: usedProvider, tool: asProviderTool(providerToolOf(tool)), short: shortNameFrom(usedProvider) } };
  }
  const provider = resolveProvider(opts, step, model, [
    facts.live ? g.lead?.stepProviders?.[step] : undefined,
    usedProvider,
    record ? undefined : opts.pendingProviders?.[groupKey(g.project, g.specFolder)]?.[step],
  ], tool);
  return { record, model, tool, ...(provider ? { provider } : {}), ...(fromProject ? { fromProject } : {}) };
}

/** What the closed AI/model button of a phase line says: `phaseLine`'s
 *  answer, as the button names it. */
export function phaseAiModel(
  g: SpecGroup,
  opts: PickerOptions,
  step: string,
  facts: PhaseFacts,
): { model: string; tool: string; provider?: LineProvider; fromProject?: boolean } | undefined {
  const line = phaseLine(g, opts, step, facts);
  if (!line) return undefined;
  const provider = line.removed
    ? { name: line.removed.key, short: line.removed.short }
    : line.provider && { name: line.provider.name, short: shortOf(line.provider) };
  return { model: line.model, tool: line.tool, ...(provider ? { provider } : {}), ...(line.fromProject ? { fromProject: true } : {}) };
}
