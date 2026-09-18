// GET /schedule (spec 272, extended spec 276, reworked spec 278): the
// page listing every allowed project's `schedule:` entries together,
// plus the entry detail page and the New-job page. This is the
// HTTP-level route test — `render/pages/schedule-page.test.ts` covers
// `renderSchedulePage()` alone, but only THIS test proves the route
// actually wires the token guard and `ctx.allowed`/`resolveSchedule`
// together (acceptance criterion 12).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduleRunOutputDir } from "../../src/queue/schedule.ts";
import { queueHarness } from "../helpers/queue-server.ts";
import { savable } from "../spec-page/spec-save-fixtures.ts";

const harness = queueHarness("aide-schedule-page-route-");
afterEach(() => harness.cleanup());

const TOKEN = "s3cret-token";

function writeSchedule(dir: string, project: string, yaml: string): void {
  writeFileSync(join(dir, "root", project, ".aide", "project.yaml"), yaml);
}

const NIGHTLY = 'name: aide\nschedule:\n  - name: nightly-report\n    cron: "0 3 * * *"\n    prompt: docs/nightly.md\n';
/** A queue config with two models, for the pages that draw the picker. */
const DEFAULTS = {
    
  timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: { }, "codex-fast": {  tool: "codex" as const } },
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

  // Spec 408, REQ-1/REQ-4: this route reads and remembers the language
  // the same way `/` already does.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/schedule?lang=nb`, { headers: { "x-aide-token": TOKEN } });
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
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
    expect(html).toContain('value="codex-fast" data-tool="codex" selected>codex-fast');
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

  // Spec 408, REQ-1/REQ-4.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const res = await fetch(`${base}/schedule/aide/nightly-report?lang=nb`, { headers: { "x-aide-token": TOKEN } });
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
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
    // The question in a sentence since 2026-09-08, where the entry's
    // name had to be typed back into a field before.
    expect(html).toContain("Are you sure you want to delete nightly-report?");
  });

  // Spec 408, REQ-1/REQ-4.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeSchedule(dir, "aide", NIGHTLY);
    const res = await fetch(
      `${base}/schedule/aide/nightly-report/delete?lang=nb`,
      { headers: { "x-aide-token": TOKEN } },
    );
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
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
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN, gitRun: savable("/host") } });
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

// Spec 495: the entry's page shows a run's report. Real files under a
// fixture output root, jobs seeded through the queue's own mirror file so
// each has the id and state the test names.
describe("GET /schedule/<project>/<entry> shows a run's report (spec 495)", () => {
  const KEY = "schedule-nightly-report";
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  interface Seed { id: string; state: string; at: string; report?: string }

  function setup(seeds: Seed[]): { base: string; outputRoot: string } {
    const scratch = mkdtempSync(join(tmpdir(), "aide-schedule-report-"));
    tmp.push(scratch);
    const outputRoot = join(scratch, "out");
    const mirror = join(scratch, "queue.json");
    writeFileSync(
      mirror,
      JSON.stringify(
        seeds.map((s) => ({
          id: s.id, project: "aide", specFolder: KEY, steps: ["schedule"], stepIndex: 0, state: s.state,
          timeoutSec: {}, permissionMode: {}, model: {}, createdAt: s.at, startedAt: s.at,
        })),
      ),
    );
    for (const s of seeds) {
      if (s.report === undefined) continue;
      const dir = scheduleRunOutputDir(outputRoot, "aide", KEY, s.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), s.report);
    }
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, scheduleOutputRoot: outputRoot, queueMirrorPath: mirror },
    });
    writeSchedule(dir, "aide", NIGHTLY);
    return { base, outputRoot };
  }

  const get = async (base: string, path: string): Promise<string> =>
    (await fetch(`${base}${path}`, { headers: { "x-aide-token": TOKEN } })).text();
  const PAGE = "/schedule/aide/nightly-report";

  test("the newest run's report is in a frame, with its time, outcome and a link to the bare file", async () => {
    const { base } = setup([
      { id: "old", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>OLD-TEXT</p>" },
      { id: "new", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>NEW-TEXT</p>" },
    ]);
    const html = await get(base, PAGE);
    expect(html).toMatch(/<iframe\b[^>]*data-report-frame/);
    expect(html).toContain("NEW-TEXT");
    expect(html).not.toContain("OLD-TEXT");
    expect(html).toContain("2026-09-02T03:00:00Z");
    expect(html).toContain(`href="/schedule-output/aide/${KEY}/runs/new/index.html"`);
  });

  test("a newest run with no report shows its sentence, never an older run's report, even while it runs", async () => {
    const { base } = setup([
      { id: "old", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>OLD-TEXT</p>" },
      { id: "new", state: "running", at: "2026-09-02T03:00:00Z" },
    ]);
    const html = await get(base, PAGE);
    expect(html).toContain("No report from this run (running)");
    expect(html).not.toContain("OLD-TEXT");
    expect(html).not.toContain("<iframe");
  });

  test("an entry that has never run says so, and ?run= is ignored", async () => {
    const { base } = setup([]);
    const html = await get(base, `${PAGE}?run=anything`);
    expect(html).toContain("This entry has not run yet.");
    expect(html).not.toContain("<iframe");
  });

  test("?run= picks that run's report, with that run's own time, and neither of the others'", async () => {
    const { base } = setup([
      { id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>FIRST-TEXT</p>" },
      { id: "r2", state: "failed", at: "2026-09-02T03:00:00Z", report: "<p>SECOND-TEXT</p>" },
      { id: "r3", state: "done", at: "2026-09-03T03:00:00Z", report: "<p>THIRD-TEXT</p>" },
    ]);
    const html = await get(base, `${PAGE}?run=r2`);
    expect(html).toContain("SECOND-TEXT");
    expect(html).toContain("2026-09-02T03:00:00Z");
    expect(html).not.toContain("FIRST-TEXT");
    expect(html).not.toContain("THIRD-TEXT");
  });

  test("History links every row to its run", async () => {
    const { base } = setup([
      { id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>a</p>" },
      { id: "r2", state: "failed", at: "2026-09-02T03:00:00Z" },
    ]);
    const html = await get(base, `${PAGE}?tab=history`);
    expect(html).toContain(`href="${PAGE}?run=r1#report"`);
    expect(html).toContain(`href="${PAGE}?run=r2#report"`);
  });

  test("a ?run= naming no job of this entry shows the newest run, and nothing outside the run's directory", async () => {
    const { base, outputRoot } = setup([{ id: "new", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>NEW-TEXT</p>" }]);
    writeFileSync(join(outputRoot, "aide", KEY, "index.html"), "<p>SENTINEL-OUTSIDE</p>");
    for (const run of ["nope", "../../etc/passwd", "..%2F..%2Findex.html"]) {
      const html = await get(base, `${PAGE}?run=${run}`);
      expect(html).toContain("NEW-TEXT");
      expect(html).not.toContain("SENTINEL-OUTSIDE");
    }
  });

  test("the bare file is served as text/html with the token", async () => {
    const { base } = setup([{ id: "new", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>NEW-TEXT</p>" }]);
    const res = await fetch(`${base}/schedule-output/aide/${KEY}/runs/new/index.html`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("NEW-TEXT");
  });

  test("the list's output link goes to the entry's page, and only when the newest run has a report", async () => {
    const withReport = setup([{ id: "new", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>x</p>" }]);
    expect(await get(withReport.base, "/schedule")).toContain(`href="${PAGE}#report"`);
    const without = setup([
      { id: "old", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>x</p>" },
      { id: "new", state: "done", at: "2026-09-02T03:00:00Z" },
    ]);
    expect(await get(without.base, "/schedule")).not.toContain("#report");
  });
});
