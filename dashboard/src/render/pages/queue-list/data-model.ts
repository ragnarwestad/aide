// The spec list's data model — split by theme into data-model/types.ts
// (SpecGroup and everything it is built from), phases.ts (a spec's
// phase lines and their durations), filter-sort.ts (which chip, which
// column, which search term) and group-builders.ts (turning jobs,
// targets and archived records into rows). Kept as a barrel at this
// path because ten files import from it.

export {
  type QueueTarget,
  type ArchivedSpecView,
  ARCHIVED_STATE,
  ARCHIVED_OPEN_STATE,
  type QueueFilter,
  FILTER_KEYS,
  FILTER_FIELD_PREFIX,
  FROM_LIST_FIELD,
  QUEUE_STEPS,
  PHASE_LINES,
  type Phase,
  type SpecGroup,
  groupKey,
} from "./data-model/types.ts";

export { phaseDuration, computeSpecTotalDurationMs, phasesFor } from "./data-model/phases.ts";

export {
  STATE_FILTERS,
  DEFAULT_STATE_FILTER,
  SORTS,
  DEFAULT_SORT,
  SORT_DEFAULT_DIR,
  stateFilter,
  matchesState,
  filterShowsArchived,
  isArchivedRow,
  matchesSearch,
  applyFilter,
  sortGroups,
} from "./data-model/filter-sort.ts";

export { groupBySpec } from "./data-model/group-builders.ts";
