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

  // The nav tab beside the heading already says "Schedule" — the page's
  // own title used to repeat it, which read as the same word twice.
  test("the page's own heading says Jobs, not Schedule again", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const html = await (await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("<h1>Jobs</h1>");
    expect(html).not.toContain("<h1>Schedule</h1>");
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

  // The page's own body used to repeat the entry's name as a second
  // `<h1>`, on top of the one `pageShell` already draws from the same
  // string — the name read twice, once above the Back link and once
  // below it.
  test("the entry's name is the page's ONE heading, not drawn twice", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const html = await (
      await fetch(`${base}/schedule/aide/nightly-report`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(html.match(/<h1>nightly-report<\/h1>/g)?.length ?? 0).toBe(1);
  });

  // `pageShell`'s own heading used to sit above "← Back" (`.pagehead`
  // is drawn before `body`, which opens with `backLink`) — Back is
  // meant to be the very first thing on the page, so the shell's own
  // heading is hidden and the one heading left is drawn AFTER Back,
  // inside the body.
  test("the Back link is the first thing on the page, above the heading", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const html = await (
      await fetch(`${base}/schedule/aide/nightly-report`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(html).not.toContain('class="pagehead"');
    const backAt = html.indexOf('class="backlink"');
    const headingAt = html.indexOf("<h1>nightly-report</h1>");
    expect(backAt).toBeGreaterThan(0);
    expect(backAt).toBeLessThan(headingAt);
  });
});

describe("GET /schedule/<project>/<name>/delete (spec 277)", () => {
  test("renders the confirmation, naming the entry (criterion 8)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const res = await fetch(`${base}/schedule/aide/nightly-report/delete`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("nightly-report");
    expect(html).toContain(`data-confirm="nightly-report"`);
  });

  test("an unknown entry in an allowed project is 404 (criterion 5)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const res = await fetch(`${base}/schedule/aide/ghost/delete`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(404);
  });

  test("an unallowed project is 404 (criterion 6)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule/ghost-project/nightly/delete`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(404);
  });

  test("after a successful delete, the entry's own detail page is 404 (criterion 9)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const del = await fetch(`${base}/api/queue/schedule/aide/nightly-report/delete`, {
      method: "POST",
      headers: { accept: "application/json", "x-aide-token": TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nightly-report" }),
    });
    expect(del.status).toBe(200);
    const res = await fetch(`${base}/schedule/aide/nightly-report`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(404);
  });
});
