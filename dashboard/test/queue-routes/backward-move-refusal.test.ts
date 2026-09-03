// Spec 356 (REQ-9): the spec-342 bug — `analyze` (or `create`) requested
// on a spec that has already reached a later phase must be refused
// before the job ever reaches the queue, naming `reset` as the way
// back. `job-actions.ts` is the one HTTP-reachable path both the
// spec-page control and the queue-list row's forms post through.

import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, setupQueueRoutesHarness } from "./fixtures.ts";
import { statusSaying } from "../helpers/queue-server.ts";

const { harness } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

const queue = (base: string, steps: string[]) =>
  fetch(`${base}/api/queue`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps }),
  });

describe("REQ-9: a backward move is refused before it reaches the queue", () => {
  test("analyze requested on an already-implemented spec is refused, naming reset", async () => {
    const { base } = harness.start({
      extra: { queueToken: TOKEN },
      status: statusSaying(["create", "analyze", "implement"]),
    });

    const res = await queue(base, ["analyze"]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("/aide-reset");

    const listed = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as { jobs: unknown[] };
    expect(listed.jobs).toHaveLength(0);
  });

  test("analyze requested again on a spec still analyzed (same phase) is accepted", async () => {
    const { base } = harness.start({
      extra: { queueToken: TOKEN },
      status: statusSaying(["create", "analyze"]),
    });

    const res = await queue(base, ["analyze"]);
    expect(res.status).toBe(200);

    const listed = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as { jobs: unknown[] };
    expect(listed.jobs).toHaveLength(1);
  });
});
