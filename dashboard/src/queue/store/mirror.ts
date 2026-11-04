// The queue's jobs on disk: written to a temporary file and renamed, and
// read back on boot. Best effort both ways.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseStoredJob } from "../persist.ts";
import type { Job } from "../types.ts";

/** Every job the mirror holds, into `jobs` in the order it was written.
 *  A corrupt mirror is not worth crashing over: the queue starts empty. */
export function loadJobs(path: string | undefined, jobs: Map<string, Job>): void {
  if (!path || !existsSync(path)) return;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      const job = parseStoredJob(entry);
      if (job) jobs.set(job.id, job);
    }
  } catch {
    // start empty
  }
}

export function writeJobs(path: string | undefined, jobs: Iterable<Job>): void {
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...jobs], null, 2));
    renameSync(tmp, path);
  } catch {
    // mirroring is best effort
  }
}
