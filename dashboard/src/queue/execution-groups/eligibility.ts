import type { SpecTarget } from "../../render/pages/specs-list/data-model/types.ts";
import type { ExecutionGroup } from "./types.ts";

interface GroupJob { project: string; specFolder: string; state: string }
interface EligibilityInput {
  project: string;
  targets: SpecTarget[];
  groups: ExecutionGroup[];
  jobs: GroupJob[];
}

interface LockInput {
  group: ExecutionGroup;
  targets: SpecTarget[];
  jobs: GroupJob[];
}

const active = (state: string): boolean => state === "queued" || state === "running";

export function eligibleGroupMembers(input: EligibilityInput): SpecTarget[] {
  const owned = new Set(input.groups
    .filter((group) => !group.removedAt && group.state !== "completed")
    .flatMap((group) => group.members.map((folder) => `${group.project}/${folder}`)));
  const busy = new Set(input.jobs.filter((job) => active(job.state)).map((job) => `${job.project}/${job.specFolder}`));
  return input.targets.filter((target) => {
    const key = `${target.project}/${target.specFolder}`;
    return target.project === input.project && !target.group && !owned.has(key) && !busy.has(key) &&
      !(target.done ?? []).some((step) => step === "analyze" || step === "implement" || step === "archive") && !target.acceptancePhase;
  });
}

export function lockedGroupMembers(input: LockInput): Set<string> {
  const targetByFolder = new Map(input.targets.filter((target) => target.project === input.group.project).map((target) => [target.specFolder, target]));
  const inFlight = new Set(input.jobs.filter((job) => job.project === input.group.project && active(job.state)).map((job) => job.specFolder));
  return new Set(input.group.members.filter((folder) => {
    const target = targetByFolder.get(folder);
    if (!target) return true;
    const done = [...(target.done ?? []), ...(target.historyDone ?? [])];
    return input.group.completedMembers.includes(folder) || inFlight.has(folder) ||
      done.some((step) => step === "implement" || step === "archive");
  }));
}

type ValidationResult = { ok: true; members: string[] } | { ok: false; error: string };

function orderedMembers(members: string[], positions?: number[]): ValidationResult {
  if (members.length < 2) return { ok: false, error: "an execution group needs at least two specs" };
  if (new Set(members).size !== members.length) return { ok: false, error: "a spec can belong to the group only once" };
  const actual = positions ?? members.map((_, index) => index + 1);
  if (actual.length !== members.length || [...actual].sort((a, b) => a - b).some((value, index) => value !== index + 1)) {
    return { ok: false, error: "execution positions must be unique and consecutive" };
  }
  return { ok: true, members: members.map((member, index) => ({ member, position: actual[index]! })).sort((a, b) => a.position - b.position).map(({ member }) => member) };
}

function creationOrder(members: string[], positions: number[] | undefined, targets: SpecTarget[]): ValidationResult {
  if (members.length < 2) return { ok: false, error: "an execution group needs at least two specs" };
  if (new Set(members).size !== members.length) return { ok: false, error: "a spec can belong to the group only once" };
  const validPositions = positions?.length === members.length &&
    [...positions].sort((a, b) => a - b).every((value, index) => value === index + 1);
  const base = validPositions
    ? members.map((member, index) => ({ member, position: positions![index]! })).sort((a, b) => a.position - b.position).map(({ member }) => member)
    : [...members];
  return orderGroupMembers(base, targets);
}

export function orderGroupMembers(ordered: string[], targets: SpecTarget[]): ValidationResult {
  const byFolder = new Map(targets.map((target) => [target.specFolder, target]));
  const memberSet = new Set(ordered);
  const path: string[] = [];
  const added = new Set<string>();
  const result: string[] = [];
  let cycle: string[] = [];
  const add = (member: string): boolean => {
    if (added.has(member)) return true;
    if (path.includes(member)) {
      cycle = [...path.slice(path.indexOf(member)), member];
      return false;
    }
    path.push(member);
    for (const dependency of byFolder.get(member)?.dependsOn ?? []) {
      if (memberSet.has(dependency) && !add(dependency)) return false;
    }
    path.pop();
    added.add(member);
    result.push(member);
    return true;
  };
  for (const member of ordered) {
    if (!add(member)) return { ok: false, error: `circular dependencies in the group: ${cycle.join(" → ")} — remove the circular dependencies before starting` };
  }
  return { ok: true, members: result };
}

export function validateExecutionGroupRequest(input: EligibilityInput & { members: string[]; positions?: number[]; lead?: string }):
  ValidationResult {
  const checked = creationOrder(input.members, input.positions, input.targets.filter((target) => target.project === input.project));
  if (!checked.ok) return checked;
  const ordered = checked.members;
  const eligible = new Map(eligibleGroupMembers(input).map((target) => [target.specFolder, target]));
  for (const member of ordered) {
    if (member === input.lead && input.targets.some((target) => target.project === input.project && target.specFolder === member)) continue;
    if (!eligible.has(member)) return { ok: false, error: `${member} is no longer eligible for this group` };
  }
  return { ok: true, members: ordered };
}

export function validateExecutionGroupEdit(input: EligibilityInput & {
  group: ExecutionGroup; members: string[]; positions?: number[]; locked: ReadonlySet<string>;
}): ValidationResult {
  const checked = orderedMembers(input.members, input.positions);
  if (!checked.ok) return checked;
  const ordered = checked.members;
  for (const member of input.locked) {
    if (!ordered.includes(member)) return { ok: false, error: `${member} is locked and cannot be removed from this group` };
    const oldIndex = input.group.members.indexOf(member);
    const removedBefore = input.group.members.slice(0, oldIndex).filter((folder) => !ordered.includes(folder)).length;
    if (ordered.indexOf(member) !== oldIndex - removedBefore) {
      return { ok: false, error: `${member} is locked and cannot be moved in this group` };
    }
  }
  const own = new Set(input.group.members);
  const offered = new Set(eligibleGroupMembers(input).map((target) => target.specFolder));
  for (const member of ordered) if (!own.has(member) && !offered.has(member)) return { ok: false, error: `${member} is no longer eligible for this group` };
  const result = orderGroupMembers(ordered, input.targets.filter((target) => target.project === input.project));
  if (!result.ok) return result;
  for (const member of input.locked) {
    if (result.members.indexOf(member) !== ordered.indexOf(member)) {
      return { ok: false, error: `${member} is locked; its dependencies cannot move it after work has started` };
    }
  }
  return result;
}
