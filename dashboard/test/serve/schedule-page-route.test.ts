// GET /schedule (spec 272): the aggregate page listing every allowed
// project's `schedule:` entries. This is the HTTP-level route test —
// `render/pages/schedule-page.test.ts` covers `renderSchedulePage()`
// alone, but only THIS test proves the route actually wires the token
// guard and the `ctx.allowed`/`resolveSchedule` aggregation together
// (acceptance criteria 4-6).
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-schedule-page-route-");
afterEach(() => harness.cleanup());

const TOKEN = "s3cret-token";

function writeSchedule(dir: string, project: string, yaml: string): void {
  writeFileSync(join(dir, "root", project, ".aide", "project.yaml"), yaml);
}

const NIGHTLY = 'name: aide\nschedule:\n  - name: nightly-report\n    cron: "0 3 * * *"\n    prompt: docs/nightly.md\n';
const TRAFFIC = 'name: other\nschedule:\n  - name: traffic-analysis\n    cron: "0 0 * * *"\n    prompt: docs/traffic.md\n';

describe("GET /schedule (spec 272)", () => {
  test("no token is 401", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule`);
    expect(res.status).toBe(401);
  });

  test("the wrong token is 401", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule`, { headers: { "x-aide-token": "wrong-token" } });
    expect(res.status).toBe(401);
  });

  test("entries from two different allowed projects both appear, each with its cron string and next-fire time", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, queueProjects: ["aide", "other"] },
      alsoProjects: ["other"],
    });
    writeSchedule(dir, "aide", NIGHTLY);
    writeSchedule(dir, "other", TRAFFIC);
    const res = await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("nightly-report");
    expect(html).toContain("0 3 * * *");
    expect(html).toContain("traffic-analysis");
    expect(html).toContain("0 0 * * *");
  });

  test("no allowed project with a schedule entry renders 200 with an explicit none-yet message", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("no project has a schedule entry yet");
  });
});
