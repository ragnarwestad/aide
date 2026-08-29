// GET /schedule (spec 272, extended spec 276): the project-scoped page
// listing one allowed project's `schedule:` entries at a time, plus the
// entry detail page and the New-job page this spec adds. This is the
// HTTP-level route test — `render/pages/schedule-page.test.ts` covers
// `renderSchedulePage()` alone, but only THIS test proves the route
// actually wires the token guard and `ctx.allowed`/`resolveSchedule`
// together (acceptance criterion 12).
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

  test("?project=A shows only project A's entries, not project B's (acceptance criterion 12)", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, queueProjects: ["aide", "other"] },
      alsoProjects: ["other"],
    });
    writeSchedule(dir, "aide", NIGHTLY);
    writeSchedule(dir, "other", TRAFFIC);
    const res = await fetch(`${base}/schedule?project=aide`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("nightly-report");
    expect(html).not.toContain("traffic-analysis");

    const res2 = await fetch(`${base}/schedule?project=other`, { headers: { "x-aide-token": TOKEN } });
    const html2 = await res2.text();
    expect(html2).toContain("traffic-analysis");
    expect(html2).not.toContain("nightly-report");
  });

  test("with no ?project=, the first allowed project (alphabetically) is selected", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, queueProjects: ["aide", "other"] },
      alsoProjects: ["other"],
    });
    writeSchedule(dir, "aide", NIGHTLY);
    writeSchedule(dir, "other", TRAFFIC);
    const res = await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } });
    const html = await res.text();
    expect(html).toContain("nightly-report");
  });

  test("the selected project with no schedule entry renders 200 with a project-scoped none-yet message", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("this project has no schedule entry yet");
  });

  test("no allowed project at all renders 200 with the generic none-yet message", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, queueProjects: [] } });
    const res = await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("no project has a schedule entry yet");
  });
});

describe("GET /schedule/<project>/new", () => {
  test("renders the create form, scoped to the named project", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule/aide/new`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/api/queue/schedule/aide"');
  });

  test("an unknown project is 404", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule/ghost/new`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(404);
  });
});

describe("GET /schedule/<project>/<name> (acceptance criterion 13)", () => {
  test("the Overview tab shows the cron and prompt path", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const res = await fetch(`${base}/schedule/aide/nightly-report`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0 3 * * *");
    expect(html).toContain("docs/nightly.md");
  });

  test("an unknown entry is 404", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const res = await fetch(`${base}/schedule/aide/ghost`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(404);
  });
});
