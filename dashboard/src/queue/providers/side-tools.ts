import { listedModelName } from "../model-name.ts";

export const SIDE_PARTS = ["review", "verify"] as const;
export type SidePart = (typeof SIDE_PARTS)[number];

export function resolveSidePick(
  part: SidePart,
  record: Record<string, string> | undefined,
  config: Record<string, string>,
  offered?: readonly string[],
): string | undefined {
  const chosen = record?.[part] || config[part] || config.default || undefined;
  if (!chosen || !offered?.length) return chosen;
  const listed = listedModelName(offered, chosen);
  return "name" in listed ? listed.name : offered[0];
}
