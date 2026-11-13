import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { EXECUTION_GROUP_STATES, type ExecutionGroup, type PrepareExecutionGroup } from "./types.ts";

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
  if (!strings(raw.members) || typeof raw.branch !== "string" || !EXECUTION_GROUP_STATES.includes(raw.state as never)) return undefined;
  if (!strings(raw.completedMembers) || !Array.isArray(raw.jobs)) return undefined;
  const dates = [raw.createdAt, raw.startedAt, raw.completedAt, raw.removedAt];
  if (dates.some((date) => date !== undefined && typeof date !== "string")) return undefined;
  return structuredClone(raw) as unknown as ExecutionGroup;
}

export class ExecutionGroupStore {
  private readonly groups = new Map<string, ExecutionGroup>();

  constructor(
    private readonly path?: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly id: () => string = randomUUID,
  ) {
    if (!path) return;
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (Array.isArray(raw)) for (const entry of raw) {
        const group = parse(entry);
        if (group) this.groups.set(group.id, group);
      }
    } catch {
      // A missing or unreadable optional registry starts empty.
    }
  }

  list(): ExecutionGroup[] { return [...this.groups.values()].map((group) => structuredClone(group)); }
  get(id: string): ExecutionGroup | undefined {
    const group = this.groups.get(id);
    return group ? structuredClone(group) : undefined;
  }
  findUnfinished(project: string, name: string): ExecutionGroup | undefined {
    return this.list().find((group) => group.project === project && group.name === name && group.state !== "completed");
  }
  create(input: PrepareExecutionGroup): ExecutionGroup {
    if (this.findUnfinished(input.project, input.name)) throw new Error(`execution group ${input.name} already exists`);
    const group: ExecutionGroup = { ...input, members: [...input.members], id: this.id(), createdAt: this.now(), state: "prepared", completedMembers: [], jobs: [] };
    this.groups.set(group.id, group);
    this.write();
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
    this.groups.set(group.id, group);
    this.write();
    return structuredClone(group);
  }
  update(id: string, patch: Partial<Omit<ExecutionGroup, "id" | "project">>): ExecutionGroup {
    const current = this.groups.get(id);
    if (!current) throw new Error(`no such execution group: ${id}`);
    const next = { ...current, ...structuredClone(patch), id: current.id, project: current.project };
    this.groups.set(id, next);
    this.write();
    return structuredClone(next);
  }
  start(id: string, at = this.now()): ExecutionGroup {
    const current = this.get(id);
    if (!current) throw new Error(`no such execution group: ${id}`);
    return this.update(id, { state: "running", startedAt: current.startedAt ?? at, error: undefined });
  }
  stop(id: string): ExecutionGroup { return this.update(id, { state: "stopped", error: undefined }); }
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
  private write(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify([...this.groups.values()], null, 2)}\n`);
    renameSync(temp, this.path);
  }
}
