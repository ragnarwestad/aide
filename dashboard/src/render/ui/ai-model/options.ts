// The general AI/model and provider choices: their option types and the
// pure rules that say which model and provider a choice rests on. They read
// only the configured choices and defaults, never a spec or its steps.

import { shortNameFrom } from "../../../queue/providers/short-name.ts";
import { RUNNABLE_TOOLS, providerFamily, type ProviderTool, type RunnableTool } from "../../../queue/providers/tools.ts";

/** One model as a picker offers it, from the config. */
export interface ModelChoice {
  name: string;
  tool?: RunnableTool;
  ranAs?: string;
  named?: { id: string; name: string };
}

/** The fields the general controls read. */
export interface AiModelOptions {
  /** The models a job may be asked to run on. */
  modelChoices?: ModelChoice[];
  /** The configured model per step (plus a "default" key). */
  defaultModels?: Record<string, string>;
  /** The providers an AI choice lists, in config order. */
  providerChoices?: ProviderOption[];
  /** The configured provider per step, by key. */
  defaultProviders?: Record<string, string>;
}

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
  models: ModelChoice[],
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
  models: ModelChoice[],
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

/** A provider as a picker offers it: its key (the value posted), its name,
 *  its short name and the tool whose models it runs. */
export interface ProviderOption {
  key: string;
  name: string;
  /** The two characters a closed picker shows; made from the name when a
   *  table has none (`shortOf`). */
  short?: string;
  tool: ProviderTool;
  /** Switched off in Settings → Providers. */
  off?: boolean;
}

/** The two characters a picker shows for a provider. */
export const shortOf = (p: Pick<ProviderOption, "name" | "short">): string => p.short ?? shortNameFrom(p.name);

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
  opts: Pick<AiModelOptions, "modelChoices" | "providerChoices" | "defaultProviders">,
  step: string,
  model: string | undefined,
  picks: readonly (string | undefined)[],
  /** The tool the line is on, where the model alone cannot say it: a
   *  recorded model no longer configured runs the tool its run recorded. */
  lineTool?: string,
): ProviderOption | undefined {
  const providers = opts.providerChoices ?? [];
  const tool = providerToolOf(lineTool ?? opts.modelChoices?.find((m) => m.name === model)?.tool);
  const runs = (p: ProviderOption | undefined): p is ProviderOption => p !== undefined && p.tool === tool;
  for (const key of picks) {
    const found = providers.find((p) => p.key === key);
    if (runs(found)) return found;
  }
  const wanted = providers.find((p) => p.key === opts.defaultProviders?.[step]);
  return runs(wanted) ? wanted : providers.find((p) => !p.off && runs(p));
}
