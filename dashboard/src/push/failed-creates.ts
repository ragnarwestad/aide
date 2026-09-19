// The record of a create that ended without a spec (spec 506): what was
// typed, and why it failed, so the Specs list can offer "Try again" long
// after the queue has forgotten the job. One JSON file, written to a temp
// name and renamed, read like every sibling file — a missing or corrupt
// one is empty, never an error, and a write that fails is dropped.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MESSAGES } from "../i18n/messages.ts";
import type { Sentence } from "../i18n/message.ts";
import { createFailureReason } from "../queue/create-failure.ts";
import type { Job } from "../queue/queue.ts";

export interface FailedCreate {
  /** The failed job's id. */
  id: string;
  project: string;
  title: string;
  description: string;
  /** Worded at render time, in the reader's language. */
  reason: Sentence | Sentence[];
  failedAt: string;
  /** Set once dismissed; the record stays retrievable by id. */
  dismissedAt?: string;
}

/** How many dismissed records are kept for a tap on an old notification. */
const KEEP_DISMISSED = 50;

export function failedCreateFrom(job: Job): FailedCreate {
  return {
    id: job.id,
    project: job.project,
    title: job.createTitle ?? "",
    description: job.createDescription ?? "",
    reason: createFailureReason(job),
    failedAt: job.finishedAt ?? new Date().toISOString(),
  };
}

const knownSentence = (s: unknown): boolean => {
  if (typeof s === "string") return true;
  if (!s || typeof s !== "object") return false;
  const m = s as { key?: unknown; inner?: unknown };
  if (typeof m.key !== "string" || !(m.key in MESSAGES)) return false;
  return m.inner === undefined || knownReason(m.inner);
};
const knownReason = (r: unknown): boolean => (Array.isArray(r) ? r.every(knownSentence) : knownSentence(r));

/** Only records this build can word: a removed message key would make every page throw. */
function read(path: string): FailedCreate[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<FailedCreate>[]).filter(
    (r): r is FailedCreate =>
      !!r && typeof r.id === "string" && typeof r.project === "string" && typeof r.title === "string" &&
      typeof r.description === "string" && typeof r.failedAt === "string" && knownReason(r.reason),
  );
}

export interface FailedCreates {
  add(record: FailedCreate): void;
  /** The undismissed records, newest first. */
  list(): FailedCreate[];
  /** Any record still kept, dismissed or not. */
  get(id: string): FailedCreate | undefined;
  /** False for an unknown id; dismissing twice is fine. */
  dismiss(id: string): boolean;
}

export function createFailedCreates(path: string | undefined): FailedCreates {
  let memory: FailedCreate[] = path ? read(path) : [];
  const save = (records: FailedCreate[]): void => {
    const dismissed = records.filter((r) => r.dismissedAt).sort((a, b) => b.dismissedAt!.localeCompare(a.dismissedAt!) || b.failedAt.localeCompare(a.failedAt));
    const drop = new Set(dismissed.slice(KEEP_DISMISSED).map((r) => r.id));
    memory = records.filter((r) => !drop.has(r.id));
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(memory, null, 2));
      renameSync(`${path}.tmp`, path);
    } catch {
      // Best effort: the messages live on in memory until the next restart.
    }
  };
  const current = (): FailedCreate[] => memory;
  return {
    add(record) {
      save([...current().filter((r) => r.id !== record.id), record]);
    },
    list: () =>
      current()
        .filter((r) => !r.dismissedAt)
        .sort((a, b) => b.failedAt.localeCompare(a.failedAt)),
    get: (id) => current().find((r) => r.id === id),
    dismiss(id) {
      const all = current();
      const one = all.find((r) => r.id === id);
      if (!one) return false;
      if (!one.dismissedAt) save(all.map((r) => (r.id === id ? { ...r, dismissedAt: new Date().toISOString() } : r)));
      return true;
    },
  };
}
