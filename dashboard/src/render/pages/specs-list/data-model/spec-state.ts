import { t, type Language } from "../../../../i18n";
import { gerund } from "../../../../format/gerund.ts";
import { currentStep } from "../../../ui/job-state";
import { writing } from "../../../../queue/job-rules/activity.ts";
import { ARCHIVED_STATE, CLOSED_STATE, type SpecGroup } from "./types.ts";
import { landingStepIndex } from "../../../../format/gerund.ts";

export type SpecState = {
  key: "created" | "reopened" | "analyzed" | "implemented" | "archived" | "closed" | "running";
  phase?: string;
};

type SpecStateFacts = Pick<SpecGroup, "state" | "lead"> & Partial<Pick<SpecGroup, "done" | "reopenedRound">>;

export function specState(g: SpecStateFacts): SpecState {
  const done = g.done ?? [];
  if (g.lead && writing(g.lead)) {
    const index = g.lead.landing ? landingStepIndex(g.lead.state, g.lead.stepIndex) : g.lead.stepIndex;
    return { key: "running", phase: g.lead.steps[index] ?? currentStep(g.lead) };
  }
  if (g.state === CLOSED_STATE) return { key: "closed" };
  if (g.state === ARCHIVED_STATE || g.state === "archived-unlanded") return { key: "archived" };
  if (g.reopenedRound && !done.includes("analyze") && !done.includes("implement")) return { key: "reopened" };
  if (done.includes("implement")) return { key: "implemented" };
  if (done.includes("analyze")) return { key: "analyzed" };
  return { key: "created" };
}

/** A spec's activity and a job's phase are different labels. */
export function specStateLabel(state: SpecState, lang: Language, onSpecs: boolean): string {
  if (state.key === "running") return onSpecs
    ? t(lang, "list.state.active")
    : state.phase ? gerund(lang, state.phase) : t(lang, "list.state.running");
  return t(lang, `list.state.${state.key}` as Parameters<typeof t>[1]);
}
