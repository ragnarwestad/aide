import { groupBranch } from "../../../project/spec-names.ts";
import { ExecutionGroupStore, type ExecutionGroup } from "../../../queue/execution-groups";
import type { SpecTarget } from "../../../render";

export function executionGroupForAction(
  store: ExecutionGroupStore,
  id: string,
  targets: Pick<SpecTarget, "project" | "specFolder" | "group">[],
): ExecutionGroup | undefined {
  const registered = store.get(id);
  if (registered) return registered;
  if (!id.startsWith("membership:")) return undefined;
  const rest = id.slice("membership:".length);
  const split = rest.indexOf(":");
  if (split < 1) return undefined;
  const project = rest.slice(0, split);
  const name = rest.slice(split + 1);
  const members = targets
    .filter((target) => target.project === project && target.group?.name === name)
    .sort((a, b) => a.group!.position - b.group!.position || a.specFolder.localeCompare(b.specFolder));
  if (members.length < 2) return undefined;
  return store.prepare({
    project, name, members: members.map((member) => member.specFolder),
    branch: groupBranch(members[0]!.specFolder, name),
  });
}
