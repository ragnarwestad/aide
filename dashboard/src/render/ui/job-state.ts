// What a queued job looks like to a page, and how its state is put into
// words. Both the list and the single-job page need this, and neither
// owns it. Split by theme into job-state/ (split job-state.ts by
// theme): types.ts (BranchView, QueueRowView, StepResultView),
// format.ts (labels, durations, the state chip, in-flight), resting.ts
// (the resting-state chip), notice.ts (the row's one long message),
// tdd.ts (completedThirds) and word-phase.ts (wordPhase, spec 108).
// Kept as a barrel at this path because most of the render layer
// imports from it.

export type { BranchView, QueueRowView, StepResultView } from "./job-state/types.ts";
export { anyCostUnmeasured } from "./job-state/types.ts";

export { stateLabel, durationLabel, BADGE_VARIANT, stateChip, notStartedChip, IN_FLIGHT, inFlight, currentStep } from "./job-state/format.ts";

export type { RestingState } from "./job-state/resting.ts";
export { restingChip, specStateChip } from "./job-state/resting.ts";

export type { RowNotice } from "./job-state/notice.ts";
export { specNotice } from "./job-state/notice.ts";

export { completedThirds } from "./job-state/tdd.ts";

export type { PhaseWord } from "./job-state/word-phase.ts";
export { wordPhase } from "./job-state/word-phase.ts";
