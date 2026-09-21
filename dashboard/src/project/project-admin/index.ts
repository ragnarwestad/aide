// Spec 112: what adding a project to this dashboard actually IS, as
// filesystem work — split by theme into project-admin/types.ts (the
// shapes every operation reports through), manifest-io.ts (naming a
// project, writing the manifest and .aide/config), readiness.ts
// (whether a run could start there), add-project.ts, update-settings.ts
// and remove-project.ts. Kept as a barrel at this path because thirteen
// files import from it.

export type {
  ProjectStepName,
  ProjectStep,
  ReadinessCheckName,
  ReadinessCheck,
  ProjectReadiness,
  ProjectAdminResult,
  AddProjectRequest,
} from "./types.ts";

export {
  projectNameError,
  minimalManifest,
  upsertManifestScalar,
  writeAideConfig,
  WORKTREE_LINK_DENYLIST,
  worktreeLinksError,
} from "./manifest-io.ts";

export {
  type ScheduleAdminResult,
  scheduleEntryError,
  createScheduleEntry,
  updateScheduleEntry,
  setScheduleEnabled,
  deleteScheduleEntry,
} from "./schedule-admin.ts";

export { manifestTracked, applySettingsEdits, seedSettingsFile, settingsHome, type SettingsHome } from "./settings-state.ts";
export { assessProjectReadiness } from "./readiness.ts";
export { addProject } from "./add-project.ts";
export { updateProjectSettings } from "./update-settings.ts";
export { removeProject } from "./remove-project.ts";
export { commitManifestEdits } from "./manifest-commit.ts";
