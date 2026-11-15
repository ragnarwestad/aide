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
  /** Run-created groups reuse the first Run dialog's choices for every member. */
  sharedChoices?: boolean;
  /** The choice owned by the group's shared Archive line. */
  archiveModel?: string;
  archiveProvider?: string;
}

export type PrepareExecutionGroup = Pick<ExecutionGroup, "project" | "name" | "members" | "branch" | "sharedChoices">;
