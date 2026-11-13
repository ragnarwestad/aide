export const EXECUTION_GROUP_STATES = [
  "prepared", "queued", "running", "stopped", "waiting-acceptance", "archiving", "completed",
] as const;

export type ExecutionGroupState = typeof EXECUTION_GROUP_STATES[number];

export interface ExecutionGroupLog {
  step: string;
  sessionId?: string;
  streamFile?: string;
}

export interface ExecutionGroupJob {
  id: string;
  specFolder: string;
  logs: ExecutionGroupLog[];
}

export interface ExecutionGroup {
  id: string;
  project: string;
  name: string;
  members: string[];
  branch: string;
  state: ExecutionGroupState;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  currentMember?: string;
  completedMembers: string[];
  jobs: ExecutionGroupJob[];
  prUrl?: string;
  /** When Remove took the completed group off the Jobs tab. Everything else in the record stays. */
  removedAt?: string;
  error?: string;
}

export type PrepareExecutionGroup = Pick<ExecutionGroup, "project" | "name" | "members" | "branch">;
