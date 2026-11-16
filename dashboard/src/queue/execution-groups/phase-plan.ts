import { groupMemberSteps } from "./actions.ts";

/** A fresh Start consumes the current choices; completed history is never a rerun request. */
export function groupStartPlan(
  members: readonly { specFolder: string; done?: readonly string[] }[],
  pending: Record<string, readonly string[]>,
  chosen: Record<string, string[]>,
): Record<string, string[]> {
  return Object.fromEntries(members.map(({ specFolder, done = [] }) => [specFolder,
    chosen[specFolder] !== undefined ? ["analyze", "implement"].filter((step) => chosen[specFolder]!.includes(step))
      : done.includes("implement") ? [] : groupMemberSteps(pending[specFolder]?.filter((step) => !done.includes(step)), done),
  ]));
}

export function readGroupPhaseChoices(value: unknown): Record<string, string[]> {
  const raw = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.values(raw).some((steps) =>
    !Array.isArray(steps) || steps.some((step) => step !== "analyze" && step !== "implement"))) throw new Error("invalid member steps");
  return raw as Record<string, string[]>;
}
