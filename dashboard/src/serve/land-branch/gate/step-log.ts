// The landing's lines in the step's own run log.

import { appendFileSync } from "node:fs";
import { runLogPath } from "../../../queue/runner/run-log-path.ts";
import { formatRunLogLine } from "../../../queue/parse-stream/step-log.ts";
import type { GatedJob } from "../seen-green.ts";

/** A line in the landed step's own run log, stamped the way `aide-run-spec`
 *  stamps its own, so the step's Log shows the landing under "tests and
 *  commit". `error` marks a red one. Best effort: a log that cannot be
 *  written leaves the landing as it was.
 *
 *  The landing starts before the runner stores the step's result, so the
 *  job it is handed names the step's transcript as its own `streamFile`
 *  and its results end on the step BEFORE. The last result is the step's
 *  own only for a landing resumed at boot, when that pointer is gone. */
export function stepLogLine(job: GatedJob, text: string, error = false): void {
  const last = job.results?.at(-1);
  const streamFile = stepStreamFile(job);
  if (!streamFile) return;
  const now = new Date();
  const startedAt = job.streamFile ? job.stepStartedAt : last?.startedAt;
  const began = startedAt ? Date.parse(startedAt) : NaN;
  const seconds = Number.isNaN(began) ? 0 : Math.max(0, Math.round((now.getTime() - began) / 1000));
  const clock = now.toTimeString().slice(0, 8);
  try {
    appendFileSync(runLogPath(streamFile), `${formatRunLogLine(clock, seconds, text, error)}\n`);
  } catch {
    // Nothing to do: the gate log keeps the run either way.
  }
}

/** The transcript of the step this landing merges (see `stepLogLine`). */
export function stepStreamFile(job: GatedJob): string | undefined {
  return job.streamFile ?? job.results?.at(-1)?.streamFile;
}
