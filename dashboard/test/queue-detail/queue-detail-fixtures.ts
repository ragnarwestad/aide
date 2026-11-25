// What the job and spec detail suites share: the spec's description, a
// harness serving it, and a job queued for the example spec.
import { afterEach } from "bun:test";
import type { ServerOptions } from "../../src/serve/serve.ts";
import { queueHarness } from "../helpers/queue-server.ts";

export const DESCRIPTION =
  "# A running job is a black box - Description\n\n" +
  "## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
  "## Description\n\nThe queue shows state, step and cost. It shows nothing about " +
  "what the job IS, and nothing about what it is doing.\n\n---\n\n" +
  "## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n";

/** A harness whose spec carries `DESCRIPTION`, cleaned up after every
 *  test of the calling file. `status` is the spec's own 4-status.md. */
export function detailHarness(status?: string) {
  const harness = queueHarness("aide-queue-detail-", status);
  afterEach(() => harness.cleanup());
  const start = (extra: Partial<ServerOptions> = {}) =>
    harness.start({ description: DESCRIPTION, extra: { ...extra } });
  return { harness, start };
}

/** Queues `steps` for the example spec and returns the new job's id. */
export async function enqueue(base: string, steps: string[] = ["analyze"]): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps }),
  });
  const body = (await res.json()) as { job: { id: string } };
  return body.job.id;
}
