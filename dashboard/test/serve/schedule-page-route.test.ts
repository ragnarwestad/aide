// GET /schedule (spec 272, extended spec 276, reworked spec 278): the
// page listing every allowed project's `schedule:` entries together,
// plus the entry detail page and the New-job page. This is the
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
/** A queue config with two models, for the pages that draw the picker. */
const DEFAULTS = {
  budgetUsd: 3, jobCapUsd: 10, dailyCapUsd: 20,
  timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: { budgetUsd: 3 }, "codex-fast": { budgetUsd: 5, tool: "codex" as const } },
};
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

  test("every allowed project's entries appear together, in one table (criterion 1)", async () => {
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
    expect(html).toContain("traffic-analysis");
  });

  // The nav tab beside the page already says "Schedule" — a page
  // heading repeating it read as the same word twice, so the page now
  // renders with no visible `<h1>` at all (the title stays "Jobs" only
  // in `<title>`, via `pageShell`'s `hideHeading`).
  test("the page renders with no visible heading of its own", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const html = await (await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toContain("<h1>Jobs</h1>");
    expect(html).not.toContain("<h1>Schedule</h1>");
    expect(html).toContain("· Jobs</title>");
  });

  test("no <select name=\"project\"> filter/selector remains on the response (criterion 3)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const html = await (await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toContain('<select name="project">');
    expect(html).not.toContain('class="scheduleprojects"');
  });

  test("?q= narrows rows to a term matching project:name or the prompt path (criterion 4)", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, queueProjects: ["aide", "other"] },
      alsoProjects: ["other"],
    });
    writeSchedule(dir, "aide", NIGHTLY);
    writeSchedule(dir, "other", TRAFFIC);
    const res = await fetch(`${base}/schedule?q=aide`, { headers: { "x-aide-token": TOKEN } });
    const html = await res.text();
    expect(html).toContain("nightly-report");
    expect(html).not.toContain("traffic-analysis");
  });

  test("the default view (no ?sort=) orders rows by project:name ascending (criterion 7)", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, queueProjects: ["aide", "other"] },
      alsoProjects: ["other"],
    });
    writeSchedule(dir, "aide", NIGHTLY);
    writeSchedule(dir, "other", TRAFFIC);
    const html = await (await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.indexOf("aide:nightly-report")).toBeLessThan(html.indexOf("other:traffic-analysis"));
  });

  test("?sort=next orders soonest-first by default, and ?dir=desc reverses it (criterion 8)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    // Two entries whose next fire time is genuinely different, so the
    // sort key is unambiguous regardless of when the test happens to run.
    writeSchedule(
      dir,
      "aide",
      'name: aide\nschedule:\n' +
        '  - name: soon\n    cron: "* * * * *"\n    prompt: docs/nightly.md\n' +
        '  - name: later\n    cron: "0 0 1 1 *"\n    prompt: docs/nightly.md\n',
    );
    const asc = await (await fetch(`${base}/schedule?sort=next`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(asc.indexOf("aide:soon")).toBeLessThan(asc.indexOf("aide:later"));
    const desc = await (
      await fetch(`${base}/schedule?sort=next&dir=desc`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(desc.indexOf("aide:later")).toBeLessThan(desc.indexOf("aide:soon"));
  });

  test("?sort=last orders most-recent-run first by default, with a never-run entry sorting last (criterion 9)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(
      dir,
      "aide",
      'name: aide\nschedule:\n' +
        '  - name: has-run\n    cron: "0 3 * * *"\n    prompt: docs/nightly.md\n' +
        '  - name: never-run\n    cron: "0 4 * * *"\n    prompt: docs/nightly.md\n',
    );
    const run = await fetch(`${base}/api/queue/schedule/aide/has-run/run`, {
      method: "POST",
      headers: { accept: "application/json", "x-aide-token": TOKEN },
    });
    expect(run.status).toBe(200);
    const html = await (await fetch(`${base}/schedule?sort=last`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.indexOf("aide:has-run")).toBeLessThan(html.indexOf("aide:never-run"));
  });

  test("sort links and the search-clear control carry no data-nav attribute (criterion 10)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const html = await (
      await fetch(`${base}/schedule?q=nightly`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    // Scoped to `<main>`, not the whole page: `pageShell`'s own
    // site-wide nav tabs legitimately carry `data-nav` and are not
    // what this criterion is about.
    const main = html.slice(html.indexOf("<main>"), html.lastIndexOf("</main>"));
    expect(main).not.toContain("data-nav");
  });

  test("no schedule entry in any allowed project renders 200 with the exists-yet message (criterion 5)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No schedule entry exists yet.");
  });

  test("entries exist but a search term matches none renders the no-match message with the term (criterion 6)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const res = await fetch(`${base}/schedule?q=ghost`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No schedule entry matches &quot;ghost&quot;.");
  });
});

describe("GET /schedule/new (spec 278)", () => {
  test("renders a Project select listing every allowed project, action posts to /api/queue/schedule (criterion 12)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, queueProjects: ["aide", "other"] }, alsoProjects: ["other"] });
    const res = await fetch(`${base}/schedule/new`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<select name="project">');
    expect(html).toContain('<option value="aide">aide</option>');
    expect(html).toContain('<option value="other">other</option>');
    expect(html).toContain('action="/api/queue/schedule"');
  });

  // The route's own half of the model picker: the form can only draw
  // what it is handed, and only this proves `page-routes.ts` hands the
  // queue config's own model table to it.
  test("the form offers the configured models", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, queueDefaults: DEFAULTS } });
    const res = await fetch(`${base}/schedule/new`, { headers: { "x-aide-token": TOKEN } });
    const html = await res.text();
    expect(html).toContain('<select name="model"');
    expect(html).toContain('value="codex-fast"');
    expect(html).toContain('data-ai="model"');
  });

  test("the old /schedule/<project>/new path is gone", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule/aide/new`, { headers: { "x-aide-token": TOKEN } });
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

  // Editing an entry has to offer the same choice creating it did, and
  // show what the entry is actually on — otherwise a Save silently
  // moves a job onto whatever the form happened to draw.
  test("the Edit form shows the entry's own model, pre-selected", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN, queueDefaults: DEFAULTS } });
    writeSchedule(
      dir, "aide",
      'name: aide\nschedule:\n  - name: nightly-report\n    cron: "0 3 * * *"\n    prompt: docs/nightly.md\n' +
        "    model: codex-fast\n",
    );
    const res = await fetch(`${base}/schedule/aide/nightly-report`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<select name="model"');
    expect(html).toContain('value="codex-fast" data-tool="codex" title="$5 per step" selected');
    // And stated above the form, beside the cron and the prompt file.
    expect(html).toContain("<dt>Model</dt>");
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
