import type { ModelChoice } from "../types.ts";

export const SIDE_PARTS = ["review", "verify"] as const;
export type SidePart = (typeof SIDE_PARTS)[number];

export function sideTools(implementTool: string): string[] {
  return implementTool === "codex" ? ["codex"] : [implementTool, "codex"];
}

export function sideToolRefusal(part: SidePart, sideTool: string, implementTool: string): string {
  const noun = part === "review" ? "review" : "verification";
  return `the ${noun} is set to run on ${sideTool}, which cannot run beside an implement on ${implementTool} — pick ${sideTools(implementTool).join(" or ")}`;
}

export function resolveSidePick(
  part: SidePart,
  record: Record<string, string> | undefined,
  config: Record<string, string>,
): string | undefined {
  return record?.[part] || config[part] || undefined;
}

export function allowedSideChoices<T extends ModelChoice>(
  choices: Record<string, T>,
  implementTool: string,
): Record<string, T> {
  const allowed = new Set(sideTools(implementTool));
  return Object.fromEntries(Object.entries(choices).filter(([, choice]) => allowed.has(choice.tool ?? "claude")));
}
