// Spec 356 (REQ-9): the spec-342 bug — `analyze` (or `create`) requested
// on a spec that has already reached a later phase must be refused
// before the job ever reaches the queue, naming `reset` as the way
// back. `job-actions.ts` is the one HTTP-reachable path both the
// spec-page control and the specs-list row's forms post through.

import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";
import { statusSaying } from "../../helpers/queue-server.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const { harness } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

const queue = (base: string, steps: string[]) =>
  fetch(`${base}/api/queue`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps }),
  });

// --- spec 471: a held-back spec's own round-gate exception -----------------

const BOUNDARY_SHA = "abc1234";
const heldBackStatus = (acRow: string) =>
  statusSaying(
    ["create", "analyze", "implement"],
    `- **Round boundary:** 2026-09-01 (history before \`${BOUNDARY_SHA}\` does not count)\n\n` +
      "## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n" +
      `${acRow}\n`,
  );

describe("spec 471: a held-back spec's round-gate, for BOTH analyze and implement", () => {
  for (const step of ["analyze", "implement"]) {
    test(`${step}: no open AC-n row changed since the round boundary is refused, saying so`, async () => {
      const { run } = fakeGit({ "show abc1234:1-description.md": { code: 0, stdout: "- **AC-1:** first requirement\n" } });
      const { base } = harness.start({
        extra: { queueToken: TOKEN, gitRun: run },
        status: heldBackStatus("| AC-1: first requirement | ⬜ | |"),
        description: "# Queue - Description\n\n- **AC-1:** first requirement\n",
      });
      const res = await queue(base, [step]);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("none of its open acceptance criteria has changed");

      const listed = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as { jobs: unknown[] };
      expect(listed.jobs).toHaveLength(0);
    });

    test(`${step}: an open AC-n row reworded since the round boundary is accepted`, async () => {
      const { run } = fakeGit({ "show abc1234:1-description.md": { code: 0, stdout: "- **AC-1:** first requirement\n" } });
      const { base } = harness.start({
        extra: { queueToken: TOKEN, gitRun: run },
        status: heldBackStatus("| AC-1: first requirement, reworded | ⬜ | |"),
        description: "# Queue - Description\n\n- **AC-1:** first requirement, reworded\n",
      });
      const res = await queue(base, [step]);
      expect(res.status).toBe(200);

      const listed = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as { jobs: unknown[] };
      expect(listed.jobs).toHaveLength(1);
    });
  }
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
