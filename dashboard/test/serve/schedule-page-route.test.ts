// GET /schedule (spec 272, extended spec 276, reworked spec 278): the
// page listing every allowed project's scheduled jobs together,
// plus the entry detail page and the New-job page. This is the
// HTTP-level route test — `render/pages/schedule-page.test.ts` covers
// `renderSchedulePage()` alone, but only THIS test proves the route
// actually wires the token guard and `ctx.allowed`/the schedule
// store together (acceptance criterion 12).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduleRunOutputDir } from "../../src/queue/schedule.ts";
import { queueHarness } from "../helpers/queue-server.ts";
import { savable } from "../spec-page/spec-save-fixtures.ts";

const harness = queueHarness("aide-schedule-page-route-");
afterEach(() => harness.cleanup());

// The jobs live in this queue config file, one per test.
let cfgDir: string;
let cfg: string;
beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), "aide-schedule-page-cfg-"));
  cfg = join(cfgDir, "queue-config.json");
});
afterEach(() => rmSync(cfgDir, { recursive: true, force: true }));

type Entry = Record<string, unknown>;

/** Set `project`'s jobs in the config file, keeping the other projects'. */
function writeSchedule(project: string, entries: Entry[]): void {
  let schedules: Record<string, Entry[]> = {};
  try {
    schedules = JSON.parse(readFileSync(cfg, "utf-8")).schedules ?? {};
  } catch {
    // no file yet
  }
  writeFileSync(cfg, JSON.stringify({ schedules: { ...schedules, [project]: entries } }));
}

const start = (opts: Parameters<typeof harness.start>[0] = {}) =>
  harness.start({ ...opts, extra: { queueConfigFile: cfg, ...opts.extra } });

const NIGHTLY: Entry = { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" };
/** A queue config with two models, for the pages that draw the picker. */
const DEFAULTS = {
    
  timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: { }, "codex-fast": {  tool: "codex" as const } },
};
const TRAFFIC: Entry = { name: "traffic-analysis", cron: "0 0 * * *", prompt: "docs/traffic.md" };

describe("GET /schedule (spec 272)", () => {
  test("every allowed project's entries appear together, in one table (criterion 1)", async () => {
    const { base } = start({
      extra: { queueProjects: ["aide", "other"] },
      alsoProjects: ["other"],
    });
    writeSchedule("aide", [NIGHTLY]);
    writeSchedule("other", [TRAFFIC]);
    const res = await fetch(`${base}/schedule`, );
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
    const { base } = start();
    const html = await (await fetch(`${base}/schedule`, )).text();
    expect(html).not.toContain("<h1>Jobs</h1>");
    expect(html).not.toContain("<h1>Schedule</h1>");
    expect(html).toContain("· Jobs</title>");
  });

  test("?q= narrows rows to a term matching project:name or the prompt path (criterion 4)", async () => {
    const { base } = start({
      extra: { queueProjects: ["aide", "other"] },
      alsoProjects: ["other"],
    });
    writeSchedule("aide", [NIGHTLY]);
    writeSchedule("other", [TRAFFIC]);
    const res = await fetch(`${base}/schedule?q=aide`, );
    const html = await res.text();
    expect(html).toContain("nightly-report");
    expect(html).not.toContain("traffic-analysis");
  });

  test("the default view (no ?sort=) orders rows by project:name ascending (criterion 7)", async () => {
    const { base } = start({
      extra: { queueProjects: ["aide", "other"] },
      alsoProjects: ["other"],
    });
    writeSchedule("aide", [NIGHTLY]);
    writeSchedule("other", [TRAFFIC]);
    const html = await (await fetch(`${base}/schedule`, )).text();
    expect(html.indexOf("aide:nightly-report")).toBeLessThan(html.indexOf("other:traffic-analysis"));
  });

  test("?sort=next orders soonest-first by default, and ?dir=desc reverses it (criterion 8)", async () => {
    const { base } = start();
    // Two entries whose next fire time is genuinely different, so the
    // sort key is unambiguous regardless of when the test happens to run.
    writeSchedule("aide", [
      { name: "soon", cron: "* * * * *", prompt: "docs/nightly.md" },
      { name: "later", cron: "0 0 1 1 *", prompt: "docs/nightly.md" },
    ]);
    const asc = await (await fetch(`${base}/schedule?sort=next`, )).text();
    expect(asc.indexOf("aide:soon")).toBeLessThan(asc.indexOf("aide:later"));
    const desc = await (
      await fetch(`${base}/schedule?sort=next&dir=desc`, )
    ).text();
    expect(desc.indexOf("aide:later")).toBeLessThan(desc.indexOf("aide:soon"));
  });

  test("?sort=last orders most-recent-run first by default, with a never-run entry sorting last (criterion 9)", async () => {
    const { base } = start();
    writeSchedule("aide", [
      { name: "has-run", cron: "0 3 * * *", prompt: "docs/nightly.md" },
      { name: "never-run", cron: "0 4 * * *", prompt: "docs/nightly.md" },
    ]);
    const run = await fetch(`${base}/api/queue/schedule/aide/has-run/run`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    expect(run.status).toBe(200);
    const html = await (await fetch(`${base}/schedule?sort=last`, )).text();
    expect(html.indexOf("aide:has-run")).toBeLessThan(html.indexOf("aide:never-run"));
  });

  test("sort links and the search-clear control carry no data-nav attribute (criterion 10)", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const html = await (
      await fetch(`${base}/schedule?q=nightly`, )
    ).text();
    // Scoped to `<main>`, not the whole page: `pageShell`'s own
    // site-wide nav tabs legitimately carry `data-nav` and are not
    // what this criterion is about.
    const main = html.slice(html.indexOf("<main>"), html.lastIndexOf("</main>"));
    expect(main).not.toContain("data-nav");
  });

  test("no schedule entry in any allowed project renders 200 with the exists-yet message (criterion 5)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/schedule`, );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No schedule entry exists yet.");
  });

  test("entries exist but a search term matches none renders the no-match message with the term (criterion 6)", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const res = await fetch(`${base}/schedule?q=ghost`, );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No schedule entry matches &quot;ghost&quot;.");
  });

  // Spec 408, REQ-1/REQ-4: this route reads and remembers the language
  // the same way `/` already does.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = start();
    const res = await fetch(`${base}/schedule?lang=nb`, );
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
  });
});

describe("GET /schedule/<project>/<name> (acceptance criterion 13)", () => {
  test("the Overview tab shows the cron and prompt path", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const res = await fetch(`${base}/schedule/aide/nightly-report`, );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0 3 * * *");
    expect(html).toContain("docs/nightly.md");
  });

  // Editing an entry has to offer the same choice creating it did, and
  // show what the entry is actually on — otherwise a Save silently
  // moves a job onto whatever the form happened to draw.
  test("the Edit form shows the entry's own model, pre-selected", async () => {
    const { base } = start({ extra: { queueDefaults: DEFAULTS } });
    writeSchedule("aide", [{ ...NIGHTLY, model: "codex-fast" }]);
    const res = await fetch(`${base}/schedule/aide/nightly-report`, );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<select name="model"');
    expect(html).toContain('value="codex-fast" data-tool="codex" selected>codex-fast');
    // And stated above the form, beside the cron and the prompt file.
    expect(html).toContain("<dt>Model</dt>");
  });

  test("an unknown entry is 404", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const res = await fetch(`${base}/schedule/aide/ghost`, );
    expect(res.status).toBe(404);
  });

  // The page's own body used to repeat the entry's name as a second
  // `<h1>`, on top of the one `pageShell` already draws from the same
  // string — the name read twice, once above the Back link and once
  // below it.
  test("the entry's name is the page's ONE heading, not drawn twice", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const html = await (
      await fetch(`${base}/schedule/aide/nightly-report`, )
    ).text();
    expect(html.match(/<h1>nightly-report<\/h1>/g)?.length ?? 0).toBe(1);
  });

  // `pageShell`'s own heading used to sit above "← Back" (`.pagehead`
  // is drawn before `body`, which opens with `backLink`) — Back is
  // meant to be the very first thing on the page, so the shell's own
  // heading is hidden and the one heading left is drawn AFTER Back,
  // inside the body.
  test("the Back link is the first thing on the page, above the heading", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const html = await (
      await fetch(`${base}/schedule/aide/nightly-report`, )
    ).text();
    expect(html).not.toContain('class="pagehead"');
    const backAt = html.indexOf('class="backlink"');
    const headingAt = html.indexOf("<h1>nightly-report</h1>");
    expect(backAt).toBeGreaterThan(0);
    expect(backAt).toBeLessThan(headingAt);
  });

  // Spec 408, REQ-1/REQ-4.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const res = await fetch(`${base}/schedule/aide/nightly-report?lang=nb`, );
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
  });
});

describe("GET /schedule/<project>/<name>/delete (spec 277)", () => {
  test("renders the confirmation, naming the entry (criterion 8)", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const res = await fetch(`${base}/schedule/aide/nightly-report/delete`, );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("nightly-report");
    // The question in a sentence since 2026-09-08, where the entry's
    // name had to be typed back into a field before.
    expect(html).toContain("Are you sure you want to delete nightly-report?");
  });

  // Spec 408, REQ-1/REQ-4.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const res = await fetch(
      `${base}/schedule/aide/nightly-report/delete?lang=nb`,
    );
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
  });

  test("an unknown entry in an allowed project is 404 (criterion 5)", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const res = await fetch(`${base}/schedule/aide/ghost/delete`, );
    expect(res.status).toBe(404);
  });

  test("an unallowed project is 404 (criterion 6)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/schedule/ghost-project/nightly/delete`, );
    expect(res.status).toBe(404);
  });

  test("after a successful delete, the entry's own detail page is 404 (criterion 9)", async () => {
    const { base } = start({ extra: { gitRun: savable("/host") } });
    writeSchedule("aide", [NIGHTLY]);
    const del = await fetch(`${base}/api/queue/schedule/aide/nightly-report/delete`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nightly-report" }),
    });
    expect(del.status).toBe(200);
    const res = await fetch(`${base}/schedule/aide/nightly-report`, );
    expect(res.status).toBe(404);
  });
});

describe("GET /schedule with a refusal or an unlisted model (spec 494)", () => {
  const withModel = (model: string): Entry[] => [{ ...NIGHTLY, model }];
  test("?error= is drawn in the slot, escaped", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}/schedule?error=${encodeURIComponent("bad <b>")}`)).text();
    expect(html).toContain('<p class="refused rowmsg failed" aria-live="polite">bad &lt;b&gt;</p>');
    expect(await (await fetch(`${base}/schedule`)).text()).toContain('<p class="refused" aria-live="polite"></p>');
  });

  test("an entry naming a model the queue does not offer is flagged on the list and on its own page", async () => {
    const { base } = start({ extra: { queueDefaults: DEFAULTS } });
    writeSchedule("aide", withModel("retired"));
    const list = await (await fetch(`${base}/schedule`)).text();
    expect(list).toContain("retired");
    expect(list).toContain("sonnet, codex-fast");
    const detail = await (await fetch(`${base}/schedule/aide/nightly-report`)).text();
    expect(detail).toContain("sonnet, codex-fast");
    expect(detail).toContain("is not one the queue offers");
  });

  test("an entry naming a listed model in another case is not flagged", async () => {
    const { base } = start({ extra: { queueDefaults: DEFAULTS } });
    writeSchedule("aide", withModel("SONNET"));
    const list = await (await fetch(`${base}/schedule`)).text();
    expect(list).not.toContain("is not one the queue offers");
    const detail = await (await fetch(`${base}/schedule/aide/nightly-report`)).text();
    expect(detail).not.toContain("is not one the queue offers");
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
    const { base } = start({
      extra: { scheduleOutputRoot: outputRoot, queueMirrorPath: mirror },
    });
    writeSchedule("aide", [NIGHTLY]);
    return { base, outputRoot };
  }

  const get = async (base: string, path: string): Promise<string> =>
    (await fetch(`${base}${path}`, )).text();
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
    const res = await fetch(`${base}/schedule-output/aide/${KEY}/runs/new/index.html`, );
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

describe("where the pages read the jobs from", () => {
  test("an entry only a project's manifest lists is on neither /schedule nor its own page (AC-2)", async () => {
    const { base, dir } = start();
    writeFileSync(
      join(dir, "root", "aide", ".aide", "project.yaml"),
      'name: aide\nschedule:\n  - name: from-manifest\n    cron: "0 3 * * *"\n    prompt: docs/nightly.md\n',
    );
    writeSchedule("aide", [NIGHTLY]);
    const list = await (await fetch(`${base}/schedule`)).text();
    expect(list).toContain("nightly-report");
    expect(list).not.toContain("from-manifest");
    expect((await fetch(`${base}/schedule/aide/from-manifest`)).status).toBe(404);
  });

  test("jobs recorded under a name stay attached when the entry is added under the same project, and not under another (AC-4)", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "aide-schedule-history-"));
    const mirror = join(scratch, "queue.json");
    const job = (project: string, id: string) => ({
      id, project, specFolder: "schedule-nightly-report", steps: ["schedule"], stepIndex: 0, state: "done",
      timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-09-02T03:00:00Z", startedAt: "2026-09-02T03:00:00Z",
    });
    writeFileSync(mirror, JSON.stringify([job("aide", "aide-run"), job("other", "other-run")]));
    try {
      const { base } = start({ extra: { queueMirrorPath: mirror, queueProjects: ["aide", "other"] }, alsoProjects: ["other"] });
      writeSchedule("aide", [NIGHTLY]);
      writeSchedule("other", [{ ...NIGHTLY, name: "unrelated" }]);
      const own = await (await fetch(`${base}/schedule/aide/nightly-report?tab=history`)).text();
      expect(own).toContain("run=aide-run");
      expect(own).not.toContain("run=other-run");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
