// Spec 112: what adding a project to this dashboard actually IS, as
// filesystem work — split by theme into project-admin/types.ts (the
// shapes every operation reports through), manifest-io.ts (naming a
// project, writing the manifest and .aide/config), readiness.ts
// (whether a run could start there), add-project.ts, update-settings.ts
// and remove-project.ts. Kept as a barrel at this path because thirteen
// files import from it.

export {
  type ProjectStepName,
  type ProjectStep,
  type ReadinessCheckName,
  type ReadinessCheck,
  type ProjectReadiness,
  type ProjectAdminResult,
  type AddProjectRequest,
} from "./project-admin/types.ts";

export {
  projectNameError,
  addProjectTarget,
  minimalManifest,
  upsertManifestScalar,
  writeScheduleList,
  writeAideConfig,
  WORKTREE_LINK_DENYLIST,
  worktreeLinksError,
  suggestWorktreeLinksFromLockfile,
  suggestSpecsPath,
} from "./project-admin/manifest-io.ts";

export {
  type ScheduleAdminResult,
  scheduleEntryError,
  createScheduleEntry,
  updateScheduleEntry,
  setScheduleEnabled,
} from "./project-admin/schedule-admin.ts";

export { assessProjectReadiness } from "./project-admin/readiness.ts";
export { addProject } from "./project-admin/add-project.ts";
export { updateProjectSettings } from "./project-admin/update-settings.ts";
export { removeProject } from "./project-admin/remove-project.ts";
