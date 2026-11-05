export const SIDE_PARTS = ["review", "verify"] as const;
export type SidePart = (typeof SIDE_PARTS)[number];

export function resolveSidePick(
  part: SidePart,
  record: Record<string, string> | undefined,
  config: Record<string, string>,
): string | undefined {
  return record?.[part] || config[part] || undefined;
}
