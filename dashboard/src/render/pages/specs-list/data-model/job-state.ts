import { inFlight, type QueueRowView } from "../../../ui/job-state";
import type { SpecGroup } from "./types.ts";
import { isArchivedRow, offersArchiveAgain } from "./filter-sort.ts";

export function jobState(g: SpecGroup): QueueRowView["state"] | "created" | "analyzed" | "implemented" | "held-back" | undefined {
  if (g.lead && inFlight(g.lead)) return g.lead.state;
  if (offersArchiveAgain(g)) return "failed";
  if (isArchivedRow(g)) return "done";
  if (g.lead && g.lead.state !== "done") return g.lead.state;
  if (g.phases.some((phase) => phase.step === "archive" && phase.heldBack)) return "held-back";
  if (g.done.includes("implement") || g.phases.some((phase) => phase.step === "implement" && phase.history.historyDone)) {
    return "implemented";
  }
  if (g.done.includes("analyze")) return "analyzed";
  return g.lead ? "created" : undefined;
}

export function offersReopen(g: SpecGroup, onSpecs: boolean): boolean {
  return onSpecs && !g.executionGroupActive && isArchivedRow(g) && !offersArchiveAgain(g) && !(g.lead && inFlight(g.lead));
}
