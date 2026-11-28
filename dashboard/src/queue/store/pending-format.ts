// The layout of `pending-models.json`: the model and provider picked per
// step for a spec that has no job yet, in one file so a pair is written
// in one rename. The older layout, models only with the providers in
// `pending-providers.json` beside it, is still read.

import { parsePendingModels } from "../persist.ts";
import { WORKFLOW_STEPS } from "../steps.ts";
import { PICK_PARTS } from "../providers/side-tools.ts";

type Table = Record<string, Record<string, string>>;

export interface PendingChoices {
  models: Table;
  providers: Table;
  /** The file has the older layout, so its providers are in the file beside it. */
  legacy: boolean;
}

export interface StoredPendingChoices {
  version: 2;
  choices: Record<string, Record<string, { model: string; provider?: string }>>;
}

const isTable = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isPickStep = (step: string): boolean => ([...WORKFLOW_STEPS, ...PICK_PARTS] as readonly string[]).includes(step);

/** Reads `{ "version": 2, "choices": { "<project>/<specFolder>": { "<step>":
 *  { "model", "provider"? } } } }`, or the older `{ key: { step: model } }`,
 *  which answers `legacy`. An entry that does not parse is dropped; any
 *  other version, or a file that is not an object, is `null`, so the file
 *  is reported and left alone rather than read as empty. */
export function parsePendingChoices(raw: unknown): PendingChoices | null {
  if (!isTable(raw)) return null;
  if (!("version" in raw)) {
    const models = parsePendingModels(raw);
    return models && { models, providers: {}, legacy: true };
  }
  if (raw.version !== 2 || !isTable(raw.choices)) return null;
  const models: Table = {};
  const providers: Table = {};
  for (const [key, steps] of Object.entries(raw.choices)) {
    if (!isTable(steps)) continue;
    for (const [step, choice] of Object.entries(steps)) {
      const { model, provider } = isTable(choice) ? choice : {};
      if (typeof model !== "string" || !model || !isPickStep(step)) continue;
      models[key] = { ...models[key], [step]: model };
      if (typeof provider === "string" && provider) providers[key] = { ...providers[key], [step]: provider };
    }
  }
  return { models, providers, legacy: false };
}

/** The providers of the older layout that belong to a model: one whose
 *  step has no model is dropped. */
export function legacyProviders(models: Table, providers: Table): Table {
  const kept: Table = {};
  for (const [key, steps] of Object.entries(providers)) {
    for (const [step, provider] of Object.entries(steps)) {
      if (models[key]?.[step]) kept[key] = { ...kept[key], [step]: provider };
    }
  }
  return kept;
}

/** The two tables in the layout `parsePendingChoices` reads. */
export function serializePendingChoices(models: Table, providers: Table): StoredPendingChoices {
  const choices: StoredPendingChoices["choices"] = {};
  for (const [key, steps] of Object.entries(models)) {
    for (const [step, model] of Object.entries(steps)) {
      const provider = providers[key]?.[step];
      choices[key] = { ...choices[key], [step]: provider ? { model, provider } : { model } };
    }
  }
  return { version: 2, choices };
}
