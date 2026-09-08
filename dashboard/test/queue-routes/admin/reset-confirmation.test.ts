import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

describe("spec 231: Reset confirmation routes", () => {
  const auth = { "x-aide-token": TOKEN };
  const folder = "81-queue-and-runner";

  test("the active spec has a confirmation page of its own", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs/aide/${folder}/reset`, { headers: auth });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`Are you sure you want to reset ${folder}?`);
    expect(html).toContain(`/api/queue/specs/aide/${folder}/reset`);
  });

  // Spec 408, REQ-1/REQ-4: this route reads and remembers the language
  // the same way `/` already does.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs/aide/${folder}/reset?lang=nb`, { headers: auth });
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
  });

  // The typed confirmation is gone (2026-09-08), so a press is the
  // whole answer — but a body that is not a body at all is still a
  // malformed request, and still refused as one.
  test("a malformed body creates no job", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/reset`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    const jobs = await (await fetch(`${base}/api/queue`, { headers: auth })).json() as { jobs: unknown[] };
    expect(jobs.jobs).toHaveLength(0);
  });

  // And a press with nothing typed — which is every press now — does
  // create the job.
  test("a press with no confirmation field queues the reset", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/reset`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const jobs = await (await fetch(`${base}/api/queue`, { headers: auth })).json() as { jobs: { steps: string[] }[] };
    expect(jobs.jobs.map((j) => j.steps)).toEqual([["reset"]]);
  });
});
