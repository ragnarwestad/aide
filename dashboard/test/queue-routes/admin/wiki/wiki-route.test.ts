import { afterEach, describe, expect, test } from "bun:test";
import { setupQueueRoutesHarness } from "../../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-wiki-route-");
afterEach(() => harness.cleanup());

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };
const post = (base: string, project: string, headers: Record<string, string> = JSON_HEADERS) =>
  fetch(`${base}/api/queue/projects/${project}/wiki`, { method: "POST", redirect: "manual", headers });
const jobs = async (base: string) =>
  ((await (await fetch(`${base}/api/queue`)).json()) as { jobs: { steps: string[]; specFolder: string }[] }).jobs;

describe("POST /api/queue/projects/<name>/wiki (AC-1)", () => {
  test("queues one wiki job on the project's own key and answers JSON to a script call", async () => {
    const { base } = start();
    const res = await post(base, "aide");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    const queued = await jobs(base);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ steps: ["wiki"], specFolder: "wiki-aide" });
  });

  test("a browser without script is sent to the Specs list", async () => {
    const { base } = start();
    const res = await post(base, "aide", { "content-type": "application/x-www-form-urlencoded" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(await jobs(base)).toHaveLength(1);
  });

  test("posted again while the build is unfinished is refused and no second job exists", async () => {
    const { base } = start();
    await post(base, "aide");
    const again = await post(base, "aide");
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(await jobs(base)).toHaveLength(1);
  });

  test("a refusal in a browser goes back to the Wiki tab with the sentence", async () => {
    const { base } = start();
    await post(base, "aide");
    const again = await post(base, "aide", { "content-type": "application/x-www-form-urlencoded" });
    expect(again.status).toBe(303);
    const location = again.headers.get("location") ?? "";
    expect(location.startsWith("/projects/aide?tab=wiki&wikiError=")).toBe(true);
  });

  test("a project that is not allowed is refused and nothing is queued", async () => {
    const { base } = start();
    const res = await post(base, "nosuch");
    expect(res.status).toBe(404);
    expect(await jobs(base)).toHaveLength(0);
  });

  test("only POST", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/projects/aide/wiki`, { headers: JSON_HEADERS });
    expect(res.status).toBe(405);
  });
});
