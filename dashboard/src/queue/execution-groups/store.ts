import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { EXECUTION_GROUP_STATES, type ExecutionGroup, type PrepareExecutionGroup } from "./types.ts";
import { clearStorageFault, isMissing, keepRejected, removeTemp, setStorageFault, storageReason, type StorageFault } from "../store/storage-faults.ts";

interface LegacyJob {
  id: string;
  specFolder: string;
  results: { step: string; sessionId?: string; streamFile?: string }[];
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function parse(value: unknown): ExecutionGroup | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.project !== "string" || typeof raw.name !== "string") return undefined;
  if (raw.displayName !== undefined && typeof raw.displayName !== "string") return undefined;
  if (!strings(raw.members) || typeof raw.branch !== "string" || !EXECUTION_GROUP_STATES.includes(raw.state as never)) return undefined;
  if (!strings(raw.completedMembers) || !Array.isArray(raw.jobs)) return undefined;
  if (raw.stoppedByUser !== undefined && typeof raw.stoppedByUser !== "boolean") return undefined;
  if (raw.memberSteps !== undefined && (!raw.memberSteps || typeof raw.memberSteps !== "object" || Array.isArray(raw.memberSteps) ||
    Object.values(raw.memberSteps).some((steps) => !strings(steps) || steps.some((step) => step !== "analyze" && step !== "implement")))) return undefined;
  if (raw.sharedChoices !== undefined && typeof raw.sharedChoices !== "boolean") return undefined;
  if (raw.archiveModel !== undefined && typeof raw.archiveModel !== "string") return undefined;
  if (raw.archiveProvider !== undefined && typeof raw.archiveProvider !== "string") return undefined;
  const dates = [raw.createdAt, raw.startedAt, raw.completedAt, raw.removedAt];
  if (dates.some((date) => date !== undefined && typeof date !== "string")) return undefined;
  return structuredClone(raw) as unknown as ExecutionGroup;
}

export class ExecutionGroupStore {
  private groups = new Map<string, ExecutionGroup>();
  private current?: StorageFault;
  /** Set when the file was there but could not be used: it is then never
   *  written for the life of the process, so it stays as it was found. */
  private locked = false;

  constructor(
    private readonly path?: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly id: () => string = randomUUID,
  ) {
    if (!path) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf-8"));
    } catch (error) {
      // A missing file is a first start; anything else is a file to keep.
      if (!isMissing(error)) this.readFault(storageReason(error));
      return;
    }
    if (!Array.isArray(raw)) { this.readFault("not a JSON list"); return; }
    const rejected = raw.filter((entry) => !parse(entry));
    if (rejected.length > 0) {
      try {
        const kept = keepRejected(path, rejected);
        console.error(`execution groups: ${rejected.length} group(s) in ${path} could not be read and are kept in ${kept}`);
      } catch (error) {
        this.readFault(`the entries it could not read were not kept: ${storageReason(error)}`);
        return;
      }
    }
    for (const entry of raw) {
      const group = parse(entry);
      if (group) this.groups.set(group.id, group);
    }
  }

  /** Undefined while the latest change is on disk; otherwise the file,
   *  whether reading or writing it failed, and the reason. */
  get fault(): StorageFault | undefined {
    return this.current ? { ...this.current } : undefined;
  }

  list(): ExecutionGroup[] { return [...this.groups.values()].map((group) => structuredClone(group)); }
  get(id: string): ExecutionGroup | undefined {
    const group = this.groups.get(id);
    return group ? structuredClone(group) : undefined;
  }
  findUnfinished(project: string, name: string): ExecutionGroup | undefined {
    return this.list().find((group) => !group.removedAt && group.project === project && (group.name === name || group.displayName === name) && group.state !== "completed");
  }
  create(input: PrepareExecutionGroup): ExecutionGroup {
    if (this.findUnfinished(input.project, input.name)) throw new Error(`execution group ${input.name} already exists`);
    const group: ExecutionGroup = { ...input, members: [...input.members], id: this.id(), createdAt: this.now(), state: "prepared", completedMembers: [], jobs: [] };
    this.commit(group);
    return structuredClone(group);
  }
  prepare(input: PrepareExecutionGroup): ExecutionGroup {
    const existing = this.findUnfinished(input.project, input.name);
    if (existing) {
      if (!existing.startedAt) return this.update(existing.id, { members: [...input.members], branch: input.branch });
      return existing;
    }
    return this.create(input);
  }
  reconcile(
    input: PrepareExecutionGroup & Pick<ExecutionGroup, "completedMembers">,
    jobs: LegacyJob[],
  ): ExecutionGroup {
    const existing = this.findUnfinished(input.project, input.name);
    if (existing) return existing;
    const group: ExecutionGroup = {
      ...input, state: "stopped",
      id: this.id(),
      jobs: jobs.filter((job) => input.members.includes(job.specFolder)).map((job) => ({
        id: job.id,
        specFolder: job.specFolder,
        logs: job.results.map(({ step, sessionId, streamFile }) => ({ step, sessionId, streamFile })),
      })),
    };
    this.commit(group);
    return structuredClone(group);
  }
  update(id: string, patch: Partial<Omit<ExecutionGroup, "id" | "project">>): ExecutionGroup {
    const current = this.groups.get(id);
    if (!current) throw new Error(`no such execution group: ${id}`);
    const next = { ...current, ...structuredClone(patch), ...(patch.state && patch.state !== "stopped" ? { stoppedByUser: undefined } : {}), id: current.id, project: current.project };
    this.commit(next);
    return structuredClone(next);
  }
  start(id: string, at = this.now()): ExecutionGroup {
    const current = this.get(id);
    if (!current) throw new Error(`no such execution group: ${id}`);
    return this.update(id, { state: "running", startedAt: current.startedAt ?? at, error: undefined });
  }
  /** The group's next member has a job queued for it. */
  queueMember(id: string, member: string): ExecutionGroup {
    return this.update(id, { state: "queued", currentMember: member, error: undefined });
  }
  stop(id: string, byUser = false): ExecutionGroup { return this.update(id, { state: "stopped", error: undefined, stoppedByUser: byUser || this.get(id)?.stoppedByUser || undefined }); }
  remove(id: string, at = this.now()): ExecutionGroup { return this.update(id, { removedAt: at }); }
  complete(id: string, result: { completedAt?: string; prUrl?: string }): ExecutionGroup {
    return this.update(id, { state: "completed", completedAt: result.completedAt ?? this.now(), prUrl: result.prUrl, error: undefined });
  }
  waitForAcceptance(id: string): ExecutionGroup { return this.update(id, { state: "waiting-acceptance" }); }
  archiveFailed(id: string, error: string): ExecutionGroup { return this.update(id, { state: "archiving", error }); }
  /** Where a group stands once its archive step has ended: landed, failed
   *  to land, or held back by the runner's own check, which lands nothing
   *  and leaves the group waiting for Archive again. */
  archiveSettled(id: string, outcome: "held-back" | "failed" | { prUrl?: string }): ExecutionGroup {
    if (outcome === "failed") return this.archiveFailed(id, "Archive did not land");
    if (outcome !== "held-back") return this.complete(id, outcome);
    const state = this.get(id)?.state;
    return state === "running" || state === "archiving" ? this.waitForAcceptance(id) : this.get(id)!;
  }
  private readFault(reason: string): void {
    this.current = { file: this.path!, store: "groups", action: "read", reason };
    this.locked = true;
    setStorageFault(this.current);
  }
  /** Writes the groups with `group` in them, and only then keeps the
   *  change in memory: a change that did not reach the file throws with
   *  the file and the reason, and leaves every group as it was. */
  private commit(group: ExecutionGroup): void {
    const next = new Map(this.groups).set(group.id, group);
    if (this.path) {
      if (this.locked) throw new Error(`${this.path} could not be read (${this.current!.reason}), so the change was not saved`);
      const temp = `${this.path}.tmp`;
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(temp, `${JSON.stringify([...next.values()], null, 2)}\n`);
        renameSync(temp, this.path);
      } catch (error) {
        removeTemp(temp);
        this.current = { file: this.path, store: "groups", action: "write", reason: storageReason(error) };
        setStorageFault(this.current);
        throw new Error(`${this.path} could not be saved (${this.current.reason}), so the change was not made`);
      }
      this.current = undefined;
      clearStorageFault(this.path);
    }
    this.groups = next;
  }
}
