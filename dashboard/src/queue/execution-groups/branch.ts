import { specFolders } from "../../project/discover";
import { groupBranch } from "../../project/spec-names.ts";
import type { ExecutionGroupStore } from "./store.ts";

/** The one shared branch a grouped spec's job runs on, resolved before bash
 *  starts; the isolated worktree is not asked to discover siblings. The
 *  group's own record names it when the job belongs to one, since its first
 *  member may already be archived; otherwise it is named for the first
 *  active member of the spec's group. */
export function groupBranchForJob(
  groups: Pick<ExecutionGroupStore, "get">,
  specsRoot: string | undefined,
  job: { project: string; specFolder: string; executionGroupId?: string },
): string | undefined {
  const recorded = job.executionGroupId ? groups.get(job.executionGroupId)?.branch : undefined;
  if (recorded) return recorded;
  if (!specsRoot) return undefined;
  const members = specFolders(specsRoot, false);
  const current = members.find((spec) => spec.folder === job.specFolder);
  if (!current?.group) return undefined;
  const first = members
    .filter((spec) => spec.group?.name === current.group!.name)
    .sort((a, b) => a.group!.position - b.group!.position || a.folder.localeCompare(b.folder))[0];
  return first ? groupBranch(first.folder, current.group.name) : undefined;
}
