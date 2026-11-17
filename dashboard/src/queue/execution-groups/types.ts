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
  /** Read-only queue facts added to a page projection, never an execution authorization. */
  queuePosition?: { id: string; n: number; total: number; reason: string; operation: string };
  /** Read-only: the members the queue holds a place for before their own job exists. */
  queuedMembers?: string[];
  id: string;
  project: string;
  name: string;
  /** The editable label; name remains the stable membership identifier. */
  displayName?: string;
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
  /** When Remove took the idle group off the Jobs tab. Everything else in the record stays. */
  removedAt?: string;
  error?: string;
  stoppedByUser?: boolean;
  /** Run-created groups reuse the first Run dialog's choices for every member. */
  sharedChoices?: boolean;
  /** The member phase choices consumed by the latest manual Start. */
  memberSteps?: Record<string, string[]>;
  /** The choice owned by the group's shared Archive line. */
  archiveModel?: string;
  archiveProvider?: string;
}

export type PrepareExecutionGroup = Pick<ExecutionGroup, "project" | "name" | "members" | "branch" | "sharedChoices">;
