import { afterEach, describe, expect, test } from "bun:test";
import { JOB, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

describe("spec 252: the spec page's own Back link, read off the Referer header", () => {
  const folder = "81-queue-and-runner";

  // A switch between the page's own tabs is not somewhere to go back to.
  test("a Referer that is another tab of the same page falls back to the specs list", async () => {
    const { base } = start();
    const html = await (
      await fetch(`${base}/specs/aide/${folder}?tab=status`, { headers: { referer: `${base}/specs/aide/${folder}?tab=overview` } })
    ).text();
    expect(html).toMatch(/<a class="backlink"[^>]*href="\/"/);
  });
});

describe("spec 252: the job page's own Back link, read off the Referer header", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json" };

  const jobId = async (base: string): Promise<string> => {
    const made = await fetch(`${base}/api/queue`, { method: "POST", headers: AUTH, body: JSON.stringify(JOB) });
    const { job } = (await made.json()) as { job: { id: string } };
    return job.id;
  };

  test("a Referer that is another tab of the same page falls back to the specs list", async () => {
    const { base } = start();
    const id = await jobId(base);
    const html = await (
      await fetch(`${base}/jobs/${id}?tab=steps`, { headers: { referer: `${base}/jobs/${id}` } })
    ).text();
    expect(html).toMatch(/<a class="backlink"[^>]*href="\/"/);
  });
});
