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
import { scheduleRunOutputDir } from "../../../src/queue/schedule.ts";
import { writeProposalsRecord } from "../../../src/queue/spec-proposals.ts";
import { scheduleRunPath } from "../../../src/render";
import { queueHarness } from "../../helpers/queue-server.ts";
import { Window } from "happy-dom";

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

/** A page's markup as a document. */
function parse(html: string): Document {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
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

});

describe("GET /schedule/<project>/<name> (acceptance criterion 13)", () => {
  // Editing an entry has to offer the same choice creating it did, and
  // show what the entry is actually on — otherwise a Save silently
  // moves a job onto whatever the form happened to draw.
  test("Edit on the Settings tab shows the entry's own model, pre-selected (AC-5)", async () => {
    const { base } = start({ extra: { queueDefaults: DEFAULTS } });
    writeSchedule("aide", [{ ...NIGHTLY, model: "codex-fast" }]);
    const res = await fetch(`${base}/schedule/aide/nightly-report?tab=settings&edit=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/api/queue/schedule/aide/nightly-report"');
    expect(html).toContain('<select name="model"');
    expect(html).toContain('value="codex-fast" data-tool="codex" selected>');
  });

  test("a row on the project's Schedule tab opens the entry's page on Report (AC-2)", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const tab = await (await fetch(`${base}/projects/aide?tab=schedule`)).text();
    const href = tab.match(/<tr data-row-href="([^"]+)"/)![1]!.replaceAll("&amp;", "&");
    const res = await fetch(`${base}${href}`);
    expect(res.status).toBe(200);
    const doc = parse(await res.text());
    expect(doc.querySelector('nav.subtabs a[aria-current="page"]')?.textContent).toBe("Report");
    expect(doc.querySelector("section#report") !== null).toBe(true);
  });

  test("Settings' Delete goes to the project's Schedule tab, and an entry with no model shows the schedule step's default (AC-4)", async () => {
    const { base } = start({ extra: { queueDefaults: { ...DEFAULTS, model: { default: "sonnet", schedule: "codex-fast" } } } });
    writeSchedule("aide", [NIGHTLY]);
    const doc = parse(await (await fetch(`${base}/schedule/aide/nightly-report?tab=settings`)).text());
    const ok = doc.querySelector('form[action="/api/queue/schedule/aide/nightly-report/delete"]');
    expect(ok?.getAttribute("data-done")).toBe("/projects/aide?tab=schedule");
    const model = [...doc.querySelectorAll("table.facts tr")].find((tr) => tr.children[0]!.textContent === "Model");
    expect(model?.children[1]!.textContent).toBe("codex-fast");
  });

  test("a save from Settings that renames the entry lands on its Settings tab with the saved values (AC-5)", async () => {
    const { base, dir } = start();
    mkdirSync(join(dir, "root", "aide", "docs"), { recursive: true });
    writeFileSync(join(dir, "root", "aide", "docs", "nightly.md"), "# nightly\n");
    writeSchedule("aide", [{ ...NIGHTLY, name: "nightly" }]);
    const save = await fetch(`${base}/api/queue/schedule/aide/nightly`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        name: "renamed", cron: "0 5 * * *", prompt: "docs/nightly.md", back: "/schedule/aide/nightly?tab=settings",
      }).toString(),
    });
    const { location } = (await save.json()) as { location: string };
    const doc = parse(await (await fetch(`${base}${location}`)).text());
    const values = [...doc.querySelectorAll("table.facts tr")].map((tr) => tr.children[1]!.textContent);
    expect(values).toContain("renamed");
    expect(values).toContain("0 5 * * *");
  });

  test("an unknown entry is 404", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    const res = await fetch(`${base}/schedule/aide/ghost`, );
    expect(res.status).toBe(404);
  });

});

describe("GET /schedule with an unlisted model (spec 494)", () => {
  const withModel = (model: string): Entry[] => [{ ...NIGHTLY, model }];
  test("an entry naming a model the queue does not offer is flagged on the list and on its project's Schedule tab", async () => {
    const { base } = start({ extra: { queueDefaults: DEFAULTS } });
    writeSchedule("aide", withModel("retired"));
    const list = await (await fetch(`${base}/schedule`)).text();
    expect(list).toContain("retired");
    expect(list).toContain("sonnet, codex-fast");
    const tab = await (await fetch(`${base}/projects/aide?tab=schedule`)).text();
    expect(tab).toContain("sonnet, codex-fast");
    expect(tab).toContain("is not one the queue offers");
  });

  test("the flag on the list and on the Schedule tab links to the entry's Settings tab (AC-6)", async () => {
    const { base } = start({ extra: { queueDefaults: DEFAULTS } });
    writeSchedule("aide", withModel("retired"));
    for (const path of ["/schedule", "/projects/aide?tab=schedule"]) {
      const hrefs = [...parse(await (await fetch(`${base}${path}`)).text()).querySelectorAll("a")].map((a) => a.getAttribute("href")!);
      expect(hrefs).toContain("/schedule/aide/nightly-report?tab=settings");
    }
  });

  test("an entry naming a listed model in another case is not flagged", async () => {
    const { base } = start({ extra: { queueDefaults: DEFAULTS } });
    writeSchedule("aide", withModel("SONNET"));
    const list = await (await fetch(`${base}/schedule`)).text();
    expect(list).not.toContain("is not one the queue offers");
    const tab = await (await fetch(`${base}/projects/aide?tab=schedule`)).text();
    expect(tab).not.toContain("is not one the queue offers");
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

  test("a picked run's report is in a frame, with its time, outcome and a link to the bare file", async () => {
    const { base } = setup([
      { id: "old", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>OLD-TEXT</p>" },
      { id: "new", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>NEW-TEXT</p>" },
    ]);
    const html = await get(base, `${PAGE}?run=new`);
    expect(html).toMatch(/<iframe\b[^>]*data-report-frame/);
    expect(html).toContain("NEW-TEXT");
    expect(html).not.toContain("OLD-TEXT");
    expect(html).toContain("2026-09-02T03:00:00Z");
    expect(html).toContain(`href="/schedule-output/aide/${KEY}/runs/new/index.html"`);
  });

  test("an entry that has never run says so once, shows no list, and ?run= is ignored (AC-6)", async () => {
    const { base } = setup([]);
    const html = await get(base, `${PAGE}?run=anything`);
    expect(html.split("This entry has not run yet.").length - 1).toBe(1);
    expect(html).not.toContain("<iframe");
    const doc = parse(html);
    expect(doc.getElementById("runs")).toBeNull();
    expect(doc.querySelector("table")).toBeNull();
  });

  /** The runs list's rows, by run id, and the one marked as shown. */
  function runsList(html: string): { ids: (string | null)[]; marked: (string | null)[]; headings: Element[] } {
    const doc = parse(html);
    const rows = [...doc.querySelectorAll("#runs tbody tr")];
    const id = (tr: Element) => new URL(tr.getAttribute("data-row-href")!, "http://board").searchParams.get("run");
    return {
      ids: rows.map(id),
      marked: rows.filter((tr) => tr.getAttribute("aria-current") === "true").map(id),
      headings: [...doc.querySelectorAll("#runs thead th")],
    };
  }

  test("with no run picked, the Report tab is the list of runs alone, newest first, with no report", async () => {
    const { base } = setup([
      { id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>FIRST-TEXT</p>" },
      { id: "r2", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>SECOND-TEXT</p>" },
      { id: "r3", state: "running", at: "2026-09-03T03:00:00Z" },
    ]);
    const html = await get(base, PAGE);
    expect(html).not.toContain("<iframe");
    expect(parse(html).getElementById("report")).toBeNull();
    expect(runsList(html)).toMatchObject({ ids: ["r3", "r2", "r1"], marked: [] });
  });

  test("?run= marks that run in the list (AC-3)", async () => {
    const { base } = setup([
      { id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>a</p>" },
      { id: "r2", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>b</p>" },
    ]);
    expect(runsList(await get(base, `${PAGE}?run=r1`)).marked).toEqual(["r1"]);
  });

  test("?sort= and ?dir= reach the list (AC-5)", async () => {
    const { base } = setup([{ id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>a</p>" }]);
    const { headings } = runsList(await get(base, `${PAGE}?sort=duration&dir=asc`));
    expect(headings.map((th) => th.getAttribute("aria-sort"))).toEqual([null, null, "ascending"]);
  });

  test("a heading keeps a ?run= that names one of the entry's runs, and no other (AC-5)", async () => {
    const { base } = setup([{ id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>a</p>" }]);
    const runOf = (th: Element) =>
      new URL(th.querySelector("a")!.getAttribute("href")!, "http://board").searchParams.get("run");
    expect(runsList(await get(base, `${PAGE}?run=r1&sort=state`)).headings.map(runOf)).toEqual(["r1", "r1", "r1"]);
    expect(runsList(await get(base, `${PAGE}?run=nope&sort=state`)).headings.map(runOf)).toEqual([null, null, null]);
  });

  test("an old link to the History tab opens the Report tab, with the runs (AC-7)", async () => {
    const { base } = setup([{ id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>REPORT-R1</p>" }]);
    const res = await fetch(`${base}${PAGE}?tab=history`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(runsList(html).ids).toEqual(["r1"]);
    expect(parse(html).querySelector('nav.subtabs a[aria-current="page"]')?.textContent).toBe("Report");
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

  test("a run with a record lists its proposals under the report, and only that run does (AC-3)", async () => {
    const { base, outputRoot } = setup([
      { id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>a</p>" },
      { id: "r2", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>b</p>" },
    ]);
    writeProposalsRecord(outputRoot, "aide", KEY, "r1", {
      at: "2026-09-01T03:01:00Z",
      proposals: [
        { title: "Made one", result: "created", jobId: "b1" },
        { title: "Known", result: "skipped", why: { code: "exists", folder: "7-known", kind: "closed" } },
      ],
    });
    const withRecord = await get(base, `${PAGE}?run=r1`);
    expect(withRecord).toContain('id="proposals"');
    expect(withRecord).toContain("Made one");
    expect(withRecord).toContain('href="/jobs/b1"');
    expect(withRecord).toContain('href="/specs/aide/7-known"');
    expect(await get(base, `${PAGE}?run=r2`)).not.toContain('id="proposals"');
  });

  test("the address a source block gives is the one the runs list uses, and the page answers it (AC-3)", async () => {
    const { base } = setup([{ id: "r1", state: "done", at: "2026-09-01T03:00:00Z", report: "<p>REPORT-R1</p>" }]);
    const path = scheduleRunPath("aide", "nightly-report", "r1");
    expect(await get(base, PAGE)).toContain(`href="${path}"`);
    const res = await fetch(`${base}${path.split("#")[0]}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("REPORT-R1");
  });

  test("a ?run= naming no job of this entry shows the list alone, and nothing outside the run's directory", async () => {
    const { base, outputRoot } = setup([{ id: "new", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>NEW-TEXT</p>" }]);
    writeFileSync(join(outputRoot, "aide", KEY, "index.html"), "<p>SENTINEL-OUTSIDE</p>");
    for (const run of ["nope", "../../etc/passwd", "..%2F..%2Findex.html"]) {
      const html = await get(base, `${PAGE}?run=${run}`);
      expect(runsList(html).ids).toEqual(["new"]);
      expect(html).not.toContain("NEW-TEXT");
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

  test("the list's output link opens the newest run's report, and only when that run has one", async () => {
    const withReport = setup([{ id: "new", state: "done", at: "2026-09-02T03:00:00Z", report: "<p>x</p>" }]);
    expect(await get(withReport.base, "/schedule")).toContain(`href="${PAGE}?run=new#report"`);
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
      const own = await (await fetch(`${base}/schedule/aide/nightly-report`)).text();
      expect(own).toContain("run=aide-run");
      expect(own).not.toContain("run=other-run");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("the page that makes an entry", () => {
  test("New starts on the defaults, posts a create for its project, and goes back where it was opened from", async () => {
    const { base } = start();
    const res = await fetch(`${base}/schedule/new?project=aide`, { headers: { referer: `${base}/schedule?q=x` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/api/queue/schedule"');
    expect(html).toContain('<input type="hidden" name="project" value="aide">');
    expect(html).toContain('value="0 7 * * *"');
    expect(html).toContain('<a class="backlink" rel="noreferrer" href="/schedule?q=x">');
    expect(html).toContain('<input type="hidden" name="back" value="/schedule?q=x">');
  });

  test("New with no project is 404", async () => {
    const { base } = start();
    expect((await fetch(`${base}/schedule/new`)).status).toBe(404);
  });

  test("the separate edit page is gone: its address is 404 (AC-6)", async () => {
    const { base } = start();
    writeSchedule("aide", [NIGHTLY]);
    expect((await fetch(`${base}/schedule/aide/nightly-report/edit`)).status).toBe(404);
  });
});
