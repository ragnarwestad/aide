import type { QueueRowView } from "./types.ts";
export function waitingFor(row?: QueueRowView, step?: string): QueueRowView["queuePosition"] {
  const position = (step ? row?.waitingPhases?.[step] : undefined) ?? row?.queuePosition;
  if (!position) return undefined;
  return !step || (position.operation ?? row!.steps[row!.stepIndex]) === step ? position : undefined;
}
export function firstWaiting(rows: readonly (QueueRowView | undefined)[]): QueueRowView["queuePosition"] {
  return rows.flatMap(row => waitingFor(row) ? [waitingFor(row)!] : []).sort((a, b) => a.n - b.n)[0];
}
