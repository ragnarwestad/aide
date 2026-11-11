import type { SpecTarget } from "../../render/pages/specs-list/data-model/types.ts";
import type { ExecutionGroup } from "./types.ts";

interface GroupJob { project: string; specFolder: string; state: string }
interface EligibilityInput {
  project: string;
  targets: SpecTarget[];
  groups: ExecutionGroup[];
  jobs: GroupJob[];
  editingGroupId?: string;
}

const active = (state: string): boolean => state === "queued" || state === "running";

export function eligibleGroupMembers(input: EligibilityInput): SpecTarget[] {
  const editingName = input.groups.find((group) => group.id === input.editingGroupId)?.name;
  const owned = new Set(input.groups
    .filter((group) => group.state !== "completed" && group.id !== input.editingGroupId)
    .flatMap((group) => group.members.map((folder) => `${group.project}/${folder}`)));
  const busy = new Set(input.jobs.filter((job) => active(job.state)).map((job) => `${job.project}/${job.specFolder}`));
  return input.targets.filter((target) => {
    const key = `${target.project}/${target.specFolder}`;
    return target.project === input.project && (!target.group || target.group.name === editingName) && !owned.has(key) && !busy.has(key) &&
      !(target.done ?? []).some((step) => step === "analyze" || step === "implement" || step === "archive") && !target.acceptancePhase;
  });
}

export function validateExecutionGroupRequest(input: EligibilityInput & { members: string[]; positions?: number[] }):
  { ok: true; members: string[] } | { ok: false; error: string } {
  if (input.members.length < 2) return { ok: false, error: "an execution group needs at least two specs" };
  if (new Set(input.members).size !== input.members.length) return { ok: false, error: "a spec can belong to the group only once" };
  const positions = input.positions ?? input.members.map((_, index) => index + 1);
  if (positions.length !== input.members.length || [...positions].sort((a, b) => a - b).some((value, index) => value !== index + 1)) {
    return { ok: false, error: "execution positions must be unique and consecutive" };
  }
  const ordered = input.members.map((member, index) => ({ member, position: positions[index]! })).sort((a, b) => a.position - b.position).map(({ member }) => member);
  const eligible = new Map(eligibleGroupMembers(input).map((target) => [target.specFolder, target]));
  for (const member of ordered) if (!eligible.has(member)) return { ok: false, error: `${member} is no longer eligible for this group` };
  const position = new Map(ordered.map((member, index) => [member, index]));
  for (const member of ordered) {
    for (const dependency of eligible.get(member)?.dependsOn ?? []) {
      if (position.has(dependency)) {
        return { ok: false, error: `${member} depends on ${dependency}, so they cannot be in the same execution group` };
      }
    }
  }
  return { ok: true, members: ordered };
}
