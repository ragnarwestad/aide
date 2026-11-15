import { inFlight, type QueueRowView } from "../../../ui/job-state";
import type { SpecGroup } from "./types.ts";
import { isArchivedRow, offersArchiveAgain } from "./filter-sort.ts";

export function jobState(g: SpecGroup): QueueRowView["state"] | undefined {
  if (g.lead && inFlight(g.lead)) return g.lead.state;
  if (offersArchiveAgain(g)) return "failed";
  if (isArchivedRow(g)) return "done";
  return g.lead?.state;
}

export function offersReopen(g: SpecGroup, onSpecs: boolean): boolean {
  return onSpecs && !g.executionGroupActive && isArchivedRow(g) && !offersArchiveAgain(g) && !(g.lead && inFlight(g.lead));
}
