// Spec 406: the Close POST route. Follows the shape run-controls.ts's own
// Reset-route suite already tests against (dashboard/test/queue-routes/admin/
// auth-and-navigation.test.ts): a real createServer, real fixture
// files, real HTTP. Spec 527: Close has no confirmation page of its own
// any more — the GET route is gone, and the dialog it fell back to is
// close-ask.test.ts's own.
import { afterEach, describe, expect, test } from "bun:test";
import { JOB, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-close-routes-");
afterEach(() => {
  harness.cleanup();
});

const folder = "81-queue-and-runner";

describe("spec 406, REQ-3/REQ-13: Close POST refuses an empty reason", () => {
  test("an empty reason refuses and enqueues no job", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ reason: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("reason");
    const jobs = (await (await fetch(`${base}/api/queue`)).json()) as { jobs: unknown[] };
    expect(jobs.jobs).toHaveLength(0);
  });

  test("a whitespace-only reason refuses the same way", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ reason: "   " }),
    });
    expect(res.status).toBe(400);
  });

  test("a missing reason field refuses the same way", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // AC-3: with no fallback close page left to redirect to, a no-script
  // refusal has to land on the spec page itself, carrying the reason.
  test("a no-script POST with an empty reason redirects to the spec page with the reason (AC-3)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "reason=",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `/specs/aide/${folder}?error=${encodeURIComponent("type a reason to close this spec")}`,
    );
  });
});

describe("spec 406, REQ-3: Close POST with a reason enqueues a close job", () => {
  test("a non-empty reason enqueues a close job carrying it", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ reason: "this idea does not hold" }),
    });
    expect(res.status).toBe(200);
    const jobs = (await (await fetch(`${base}/api/queue`)).json()) as {
      jobs: { steps: string[]; closeReason?: string }[];
    };
    expect(jobs.jobs).toHaveLength(1);
    expect(jobs.jobs[0]!.steps).toEqual(["close"]);
    expect(jobs.jobs[0]!.closeReason).toBe("this idea does not hold");
  });
});

describe("spec 406, REQ-11: Close POST refuses while a job is in flight", () => {
  test("another job for the same spec still queued refuses close with the busy sentence", async () => {
    const { base } = start();
    const enqueue = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(JOB),
    });
    expect(enqueue.status).toBe(200);
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ reason: "this idea does not hold" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("still running");
  });
});
