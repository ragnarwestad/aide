export interface WaitingEntry {
  id: string;
  project: string;
  label: string;
  operation: string;
  reason: string;
  jobId?: string;
  groupId?: string;
}
export interface WaitingSnapshot {
  revision: number;
  entries: WaitingEntry[];
}
export interface Owner extends WaitingSnapshot {
  token: string;
  generation: string;
  expiresAt: number;
}
export interface Credential { token: string; generation: string; revision: number }
export interface WaitingOptions {
  path?: string;
  now?: () => number;
  persist?: (order: string[], revision: number) => void;
  changed?: () => void;
  refresh?: () => WaitingEntry[];
}
