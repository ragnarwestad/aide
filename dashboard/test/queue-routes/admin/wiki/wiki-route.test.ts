import { afterEach, describe, expect, test } from "bun:test";
import { setupQueueRoutesHarness } from "../../fixtures.ts";
import { latestWikiBuild } from "../../../../src/serve/routes/page-routes/project-pages.ts";
import type { Job } from "../../../../src/queue/types.ts";

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

  test("a browser without script is sent back to the Wiki tab, where the build is followed", async () => {
    const { base } = start();
    const res = await post(base, "aide", { "content-type": "application/x-www-form-urlencoded" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=wiki");
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

// A wiki build is a job of the project's, not a spec: the first one showed on
// the Specs list as a spec called "aide:wiki".
describe("a wiki build is followed on the Wiki tab, never on the Specs list", () => {
  test("the Specs list draws no row for it, the full page or the rows alone", async () => {
    const { base } = start();
    await post(base, "aide");
    for (const path of ["/", "/?rows=1"]) {
      const html = await (await fetch(`${base}${path}`)).text();
      expect(html).not.toContain("wiki-aide");
    }
  });

  test("the Wiki tab shows it running, with its log and a Cancel that comes back to the tab", async () => {
    const { base } = start();
    await post(base, "aide");
    const [job] = (await jobs(base)) as unknown as { id: string }[];
    const html = await (await fetch(`${base}/projects/aide?tab=wiki`)).text();
    expect(html).toContain(`/jobs/${job!.id}?tab=steps`);
    expect(html).toContain(`action="/api/queue/${job!.id}/cancel"`);
    const cancel = await fetch(`${base}/api/queue/${job!.id}/cancel`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(cancel.status).toBe(303);
    expect(cancel.headers.get("location")).toBe("/projects/aide?tab=wiki");
  });
});

// The queue lists its jobs newest first, and the tab once took the last in
// that list: a build running now read as the finished one from before it.
describe("the Wiki tab's build is the newest one", () => {
  const build = (id: string, state: string, createdAt: string) =>
    ({ id, project: "aide", specFolder: "wiki-aide", steps: ["wiki"], state, createdAt }) as unknown as Job;

  test("a build queued after a finished one is the one shown, whatever the list's order", () => {
    const old = build("old", "done", "2026-09-26T10:00:00Z");
    const now = build("now", "running", "2026-09-26T12:34:42Z");
    expect(latestWikiBuild([now, old], "aide", "en")?.id).toBe("now");
    expect(latestWikiBuild([old, now], "aide", "en")?.id).toBe("now");
  });
});

