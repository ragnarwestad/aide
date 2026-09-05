import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

describe("spec 231: Reset confirmation routes", () => {
  const auth = { "x-aide-token": TOKEN };
  const folder = "81-queue-and-runner";

  test("the active spec has a dedicated typed-confirmation page", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs/aide/${folder}/reset`, { headers: auth });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`data-confirm="${folder}"`);
    expect(html).toContain(`/api/queue/specs/aide/${folder}/reset`);
  });

  test("missing or mismatched confirmation creates no job", async () => {
    const { base } = start({ queueToken: TOKEN });
    for (const confirm of ["", `${folder}-wrong`]) {
      const res = await fetch(`${base}/api/queue/specs/aide/${folder}/reset`, {
        method: "POST",
        headers: { ...auth, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      expect(res.status).toBe(400);
    }
    const jobs = await (await fetch(`${base}/api/queue`, { headers: auth })).json() as { jobs: unknown[] };
    expect(jobs.jobs).toHaveLength(0);
  });
});
