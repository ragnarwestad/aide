// Spec 406: the Close confirmation routes — GET the page, POST the
// reason. Follows the shape run-controls.ts's own Reset-route suite
// already tests against (dashboard/test/queue-routes/admin/
// auth-and-navigation.test.ts): a real createServer, real fixture
// files, real HTTP.
import { afterEach, describe, expect, test } from "bun:test";
import { JOB, TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-close-routes-");
afterEach(() => {
  harness.cleanup();
});

const auth = { "x-aide-token": TOKEN };
const folder = "81-queue-and-runner";

describe("spec 406: the Close confirmation page (GET)", () => {
  test("states the branch-deletion sentence and the Close-vs-Reset distinction", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs/aide/${folder}/close`, { headers: auth });
    expect(res.status).toBe(200);
    const html = await res.text();
    // REQ-9: the confirmation states what is about to happen, including
    // that the code branch goes, before it happens.
    expect(html).toMatch(/branch.*delet|delet.*branch/i);
    // REQ-2: the distinction is body text, not only a hover title.
    const withoutTitles = html.replace(/title="[^"]*"/g, "");
    expect(withoutTitles).toContain("Reset starts this spec over and keeps it active");
    expect(withoutTitles).toContain("Close says it will not work");
    expect(html).toContain(`/api/queue/specs/aide/${folder}/close`);
    // REQ-3/REQ-4: a reason field, in the standard specform shape.
    expect(html).toMatch(/class="[^"]*\bspecform\b[^"]*"/);
    expect(html).toContain('name="reason"');
    expect(html).toContain('id="specform-save"');
    expect(html).toContain('id="specform-cancel"');
  });

  test("404 for an unknown spec", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs/aide/never-existed/close`, { headers: auth });
    expect(res.status).toBe(404);
  });

  test("404 for an already-archived spec", async () => {
    const archivedFolder = "82-archived";
    const { base } = harness.start({
      extra: { queueToken: TOKEN },
      archivedSpecs: { [archivedFolder]: {} },
    });
    const res = await fetch(`${base}/specs/aide/${archivedFolder}/close`, { headers: auth });
    expect(res.status).toBe(404);
  });
});

describe("spec 406, REQ-3/REQ-13: Close POST refuses an empty reason", () => {
  test("an empty reason refuses and enqueues no job", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ reason: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("reason");
    const jobs = (await (await fetch(`${base}/api/queue`, { headers: auth })).json()) as { jobs: unknown[] };
    expect(jobs.jobs).toHaveLength(0);
  });

  test("a whitespace-only reason refuses the same way", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ reason: "   " }),
    });
    expect(res.status).toBe(400);
  });

  test("a missing reason field refuses the same way", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("spec 406, REQ-3: Close POST with a reason enqueues a close job", () => {
  test("a non-empty reason enqueues a close job carrying it", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ reason: "this idea does not hold" }),
    });
    expect(res.status).toBe(200);
    const jobs = (await (await fetch(`${base}/api/queue`, { headers: auth })).json()) as {
      jobs: { steps: string[]; closeReason?: string }[];
    };
    expect(jobs.jobs).toHaveLength(1);
    expect(jobs.jobs[0]!.steps).toEqual(["close"]);
    expect(jobs.jobs[0]!.closeReason).toBe("this idea does not hold");
  });
});

describe("spec 406, REQ-11: Close POST refuses while a job is in flight", () => {
  test("another job for the same spec still queued refuses close with the busy sentence", async () => {
    const { base } = start({ queueToken: TOKEN });
    const enqueue = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(JOB),
    });
    expect(enqueue.status).toBe(200);
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/close`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ reason: "this idea does not hold" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("still running");
  });
});
