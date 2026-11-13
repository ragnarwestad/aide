import type { SpecTarget } from "../../render/pages/specs-list/data-model/types.ts";
import type { ExecutionGroup } from "./types.ts";

interface GroupJob { project: string; specFolder: string; state: string }
interface EligibilityInput {
  project: string;
  targets: SpecTarget[];
  groups: ExecutionGroup[];
  jobs: GroupJob[];
}

const active = (state: string): boolean => state === "queued" || state === "running";

export function eligibleGroupMembers(input: EligibilityInput): SpecTarget[] {
  const owned = new Set(input.groups
    .filter((group) => group.state !== "completed")
    .flatMap((group) => group.members.map((folder) => `${group.project}/${folder}`)));
  const busy = new Set(input.jobs.filter((job) => active(job.state)).map((job) => `${job.project}/${job.specFolder}`));
  return input.targets.filter((target) => {
    const key = `${target.project}/${target.specFolder}`;
    return target.project === input.project && !target.group && !owned.has(key) && !busy.has(key) &&
      !(target.done ?? []).some((step) => step === "analyze" || step === "implement" || step === "archive") && !target.acceptancePhase;
  });
}

/** The specs a group may take at the end of its order: those New group would
 *  offer for its project, less any a member depends on, since the member
 *  would come before it. A spec that depends on a member is offered. */
export function groupAddCandidates(input: EligibilityInput & { members: readonly string[] }): SpecTarget[] {
  const required = new Set(input.targets
    .filter((target) => target.project === input.project && input.members.includes(target.specFolder))
    .flatMap((target) => target.dependsOn ?? []));
  return eligibleGroupMembers(input).filter((target) => !required.has(target.specFolder));
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
      const dependencyPosition = position.get(dependency);
      if (dependencyPosition !== undefined && dependencyPosition >= position.get(member)!) {
        return { ok: false, error: `${member} depends on ${dependency}, so ${dependency} must come before ${member} in the group's order` };
      }
    }
  }
  return { ok: true, members: ordered };
}
