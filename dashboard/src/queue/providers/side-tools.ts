import { listedModelName } from "../model-name.ts";

/** Implement's own side parts: its review and the verification of what it found. */
export const SIDE_PARTS = ["review", "verify"] as const;
export type SidePart = (typeof SIDE_PARTS)[number];
/** Analyze's Review: the plan review, on an AI and model of its own. */
export const PLAN_REVIEW = "plan-review" as const;
/** Every part beside a step that a model is picked for. */
export const PICK_PARTS = [...SIDE_PARTS, PLAN_REVIEW] as const;
export type PickPart = (typeof PICK_PARTS)[number];
/** The parts drawn under a step's line, in order. */
export const SIDE_PARTS_OF: Partial<Record<string, readonly PickPart[]>> = {
  analyze: [PLAN_REVIEW],
  implement: SIDE_PARTS,
};

/** A part's pick: the spec's own, then its setting, then — for Implement's
 *  parts only — the default model. Analyze's Review without a choice of its
 *  own has none: the analyze session reviews on its own model. */
export function resolveSidePick(
  part: PickPart,
  record: Record<string, string> | undefined,
  config: Record<string, string>,
  offered?: readonly string[],
): string | undefined {
  const fallback = part === PLAN_REVIEW ? undefined : config.default;
  const chosen = record?.[part] || config[part] || fallback || undefined;
  if (!chosen || !offered?.length) return chosen;
  const listed = listedModelName(offered, chosen);
  return "name" in listed ? listed.name : offered[0];
}

/** A model with the provider it runs on; a missing provider matches any. */
export interface ModelPair {
  model: string;
  provider?: string;
}

const samePair = (a: ModelPair, b: ModelPair): boolean =>
  a.model === b.model && (!a.provider || !b.provider || a.provider === b.provider);

/** What a Settings save keeps of the Review-under-Analyze pair it posts:
 *  nothing when the pair only follows Analyze — it equals the Analyze pair
 *  posted beside it, or, with no choice saved before, the pair Analyze
 *  rested on before the save — else the pair itself. A Settings page posts
 *  every select, and the row rests on Analyze's pair, so without this any
 *  save would turn "follows Analyze" into a choice. */
export function planReviewToSave(
  posted: ModelPair,
  postedAnalyze: ModelPair,
  restedAnalyze: ModelPair,
  savedBefore: boolean,
): ModelPair | null {
  if (samePair(posted, postedAnalyze)) return null;
  if (!savedBefore && samePair(posted, restedAnalyze)) return null;
  return posted;
}
