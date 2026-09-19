// The spec list's data model — split by theme into data-model/types.ts
// (SpecGroup and everything it is built from), phases.ts (a spec's
// phase lines and their durations), filter-sort.ts (which chip, which
// column, which search term) and group-builders.ts (turning jobs,
// targets and archived records into rows). Kept as a barrel at this
// path because ten files import from it.

export {
  type SpecTarget,
  type ArchivedSpecView,
  ARCHIVED_STATE,
  ARCHIVED_OPEN_STATE,
  CLOSED_STATE,
  isFinishedGroup,
  type SpecsFilter,
  FILTER_KEYS,
  FILTER_FIELD_PREFIX,
  FROM_LIST_FIELD,
  RUN_STEPS,
  PHASE_LINES,
  type Phase,
  type SpecGroup,
  groupKey,
} from "./types.ts";

export { phaseDuration, computeSpecTotalDurationMs, phasesFor } from "./phases.ts";

export {
  STATE_FILTERS,
  DEFAULT_STATE_FILTER,
  SORTS,
  DEFAULT_SORT,
  SORT_DEFAULT_DIR,
  stateFilter,
  stateFilterLabel,
  matchesState,
  matchesStateFilter,
  filterShowsArchived,
  NOT_VERIFIED_KEY,
  isArchivedRow,
  matchesSearch,
  applyFilter,
  sortGroups,
} from "./filter-sort.ts";

export { groupBySpec } from "./group-builders.ts";
