// The queue's jobs on disk: written to a temporary file and renamed, and
// read back on boot. A file that is missing starts the queue empty; one
// that is there but cannot be used is reported and never overwritten.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseStoredJob } from "../persist.ts";
import type { Job } from "../types.ts";
import {
  clearStorageFault,
  isMissing,
  keepRejected,
  removeTemp,
  setStorageFault,
  storageReason,
  type StorageFault,
} from "./storage-faults.ts";

const readFault = (file: string, reason: string): StorageFault => {
  const fault: StorageFault = { file, store: "queue", action: "read", reason };
  setStorageFault(fault);
  return fault;
};

/** Every job the mirror holds, into `jobs` in the order it was written.
 *  A missing file loads nothing and is no fault. A file that cannot be
 *  read, holds invalid JSON or is not a list loads nothing and answers
 *  with a read fault. An entry `parseStoredJob` rejects is left out and
 *  kept in `<file>.rejected.json`; when that copy fails, nothing is
 *  loaded either. */
export function loadJobs(
  path: string | undefined,
  jobs: Map<string, Job>,
  log: (line: string) => void = (line) => console.error(line),
): StorageFault | undefined {
  if (!path) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    return isMissing(error) ? undefined : readFault(path, storageReason(error));
  }
  if (!Array.isArray(raw)) return readFault(path, "not a JSON list");
  const loaded: Job[] = [];
  const rejected: unknown[] = [];
  for (const entry of raw) {
    const job = parseStoredJob(entry);
    if (job) loaded.push(job);
    else rejected.push(entry);
  }
  if (rejected.length > 0) {
    try {
      const kept = keepRejected(path, rejected);
      log(`queue: ${rejected.length} job(s) in ${path} could not be read and are kept in ${kept}`);
    } catch (error) {
      return readFault(path, `the entries it could not read were not kept: ${storageReason(error)}`);
    }
  }
  for (const job of loaded) jobs.set(job.id, job);
  return undefined;
}

/** Writes the jobs, and answers with a write fault when it could not. */
export function writeJobs(path: string | undefined, jobs: Iterable<Job>): StorageFault | undefined {
  if (!path) return undefined;
  const tmp = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify([...jobs], null, 2));
    renameSync(tmp, path);
  } catch (error) {
    removeTemp(tmp);
    const fault: StorageFault = { file: path, store: "queue", action: "write", reason: storageReason(error) };
    setStorageFault(fault);
    return fault;
  }
  clearStorageFault(path);
  return undefined;
}

/** The queue store's file: what it loaded, and whether the latest change
 *  is on disk. After a failed load it writes nothing for the life of the
 *  process, so the file stays as it was found. */
export class JobsMirror {
  private current?: StorageFault;
  private locked = false;

  constructor(
    private readonly path: string | undefined,
    private readonly log?: (line: string) => void,
  ) {}

  /** Undefined while the latest change is on disk; otherwise the file,
   *  whether reading or writing it failed, and the reason. */
  get fault(): StorageFault | undefined {
    return this.current ? { ...this.current } : undefined;
  }

  load(jobs: Map<string, Job>): void {
    this.current = loadJobs(this.path, jobs, this.log);
    this.locked = this.current !== undefined;
  }

  write(jobs: Iterable<Job>): StorageFault | undefined {
    if (!this.locked) this.current = writeJobs(this.path, jobs);
    return this.fault;
  }
}
