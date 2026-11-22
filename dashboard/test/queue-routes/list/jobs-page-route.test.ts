// GET / is the Jobs page: the board's first page. These are the rules it has
// of its own — what it answers, the view its address and its cookie name, which
// jobs get which kind of row, the sentence for nothing — and that a spec's row
// on it is the row the Specs list draws.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { t } from "../../../src/i18n";
import type { FailedCreate } from "../../../src/push/failed-creates.ts";
import { renderFailedCreateNotices } from "../../../src/render/pages/specs-list/failed-create-notices.ts";
import { newSpecLink } from "../../../src/render/pages/specs-list/filter-bar.ts";
import { pageUntil, ran, statusSaying } from "../../helpers/queue-server.ts";
import { dated, group, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const tmp: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true });
});

const job = (o: Record<string, unknown>) => ({
  id: "j1",
  project: "aide",
  specFolder: "81-queue-and-runner",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  timeoutSec: {},
  permissionMode: {},
  model: {},
  results: [],
  createdAt: "2026-10-08T10:00:00Z",
  startedAt: "2026-10-08T10:00:00Z",
  ...o,
});

/** A queue config whose schedule holds `nightly` and `report` for aide and
 *  `report` for other, so a waiting scheduled job of either keeps its row.
 *  Switched off, so the scheduler queues no run of its own beside them. */
function scheduleConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-jobs-schedule-"));
  tmp.push(dir);
  const file = join(dir, "queue-config.json");
  const entry = (name: string) => ({ name, cron: "0 3 * * *", prompt: `docs/${name}.md`, enabled: false });
  writeFileSync(file, JSON.stringify({ schedules: { aide: [entry("nightly"), entry("report")], other: [entry("report")] } }));
  return file;
}

const board = (jobs: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) =>
  harness.start({
    extra: { queueProjects: ["aide"], ...extra },
    ...(jobs.length ? { queueMirror: JSON.stringify(jobs) } : {}),
  });

/** A board whose schedule holds the entries `scheduleConfig` writes. */
const scheduled = (jobs: Record<string, unknown>[]) => board(jobs, { queueConfigFile: scheduleConfig() });

/** The Jobs tab's rows. Not followed through a redirect: the Specs list's rows are not the answer. */
const rowsOf = async (base: string, query = ""): Promise<string> => {
  const res = await fetch(`${base}/?rows=1${query ? `&${query}` : ""}`, { redirect: "manual" });
  expect(res.status).toBe(200);
  return await res.text();
};

/** A row group's title line: everything before its state line, without the fold's cell. */
const headOf = (g: string): string => (g.split('<tr class="specstate"')[0] ?? "").replace(/<td class="foldcell"[\s\S]*?<\/td>/, "");
const hrefsOf = (html: string): string[] => [...html.matchAll(/<a\b[^>]*?href="([^"]*)"/g)].map((m) => m[1]);
/** The line under a row's state that says why the job ended. */
const noticeOf = (g: string): string => g.match(/<tr class="specnotice"[^>]*>[\s\S]*?<\/tr>/)?.[0] ?? "";

describe("GET / answers the Jobs page, GET /?rows=1 its rows alone", () => {
  test("the page holds its rows in #jobrows, the rows answer holds no page around them", async () => {
    const { base } = board([job({})]);
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="jobrows"');
    expect(html).toContain("<header");

    const rows = await rowsOf(base);
    expect(rows).not.toContain("<header");
    expect(rows).not.toContain('id="jobrows"');
    expect(rows).toContain('id="spec-aide/81-queue-and-runner"');
  });

  test("the tab for / reads Jobs and is current, and the document's title says Jobs (AC-1)", async () => {
    const { base } = board([job({})]);
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toMatch(/<a class="tab"[^>]*href="\/"[^>]*aria-current="page"[^>]*>[\s\S]*Jobs[\s\S]*<\/a>/);
    expect(html).toContain("<title>aide -board · Jobs</title>");
  });

  test("a method other than GET is refused", async () => {
    const { base } = board();
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
  });

  test("an address with no list key is the Jobs page, in the reader's language", async () => {
    const { base } = board();
    const res = await fetch(`${base}/?lang=nb`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="jobrows"');
  });

  test("rows, only, open, checks and phases are the Jobs tab's own: it answers, it sends nothing on", async () => {
    const { base } = board([job({})]);
    for (const key of ["rows", "only", "open", "checks", "phases"]) {
      const res = await fetch(`${base}/?${key}=aide/81-queue-and-runner`, { redirect: "manual" });
      expect(res.status).toBe(200);
    }
    const open = await (await fetch(`${base}/?open=aide/81-queue-and-runner`)).text();
    expect(open).toContain('id="jobrows"');
  });
});

describe("which kind of row a job gets", () => {
  const report = job({ id: "report1", specFolder: "schedule-report", steps: ["schedule"], createdAt: "2026-10-08T10:01:00Z" });
  const sched = job({
    id: "sched1", specFolder: "schedule-nightly", steps: ["schedule"], state: "queued", startedAt: undefined,
    createdAt: "2026-10-08T10:02:00Z",
  });
  const failedReport = job({
    id: "reportf", specFolder: "schedule-report", steps: ["schedule"], state: "failed", createdAt: "2026-10-08T10:01:00Z",
    results: [{ step: "schedule", ok: false, exitCode: 1, costUsd: 0.1, costMeasured: true, terminalReason: "error", repos: [] }],
  });
  const OPEN_BOTH = "open=aide/schedule-report@report1,aide/schedule-nightly@sched1";

  const text = (html: string): string => html.replace(/<[^>]*>/g, "");
  const titleLine = (g: string): string => text(g.match(/<div class="spec-name">[\s\S]*?<\/div>/)?.[0] ?? "");
  const foldHref = (g: string): URL => {
    const href = g.match(/<a class="fold[^"]*"[^>]*?href="([^"]*)"/)?.[1] ?? "";
    return new URL(href.replaceAll("&amp;", "&"), "http://board");
  };

  test("a spec has its spec row; a running and a queued scheduled job show title, state, time and cost shut", async () => {
    const { base } = board([job({}), report, sched]);
    const html = await rowsOf(base);

    expect(html).toContain('data-folder="81-queue-and-runner"');

    for (const [id, title] of [["spec-aide/schedule-report@report1", "report"], ["spec-aide/schedule-nightly@sched1", "nightly"]] as const) {
      const g = group(html, id);
      expect(titleLine(g)).toContain(title);
      expect(g).toContain("badgeslot");
      expect(g).toContain('data-col="started"');
      expect(g).toContain('data-col="cost"');
    }
  });

  test("shut, by default or with another row open, a job row has no links and no Stop or Cancel", async () => {
    const { base } = board([report, sched]);
    for (const query of ["", "open=aide/81-queue-and-runner"]) {
      const html = await rowsOf(base, query);
      for (const [id, jobId] of [["spec-aide/schedule-report@report1", "report1"], ["spec-aide/schedule-nightly@sched1", "sched1"]]) {
        const g = group(html, id);
        expect(g).not.toBe("");
        expect(g).not.toContain("tab=schedule");
        expect(g).not.toContain(`/api/queue/${jobId}/cancel`);
        expect(g).not.toContain("data-ask");
      }
    }
  });

  test("an open scheduled job still offers Stop or Cancel", async () => {
    const { base } = board([report, sched]);
    const html = await rowsOf(base, OPEN_BOTH);
    const w = group(html, "spec-aide/schedule-report@report1");
    expect(w).toContain('action="/api/queue/report1/cancel"');
    expect(w).toContain("actionform");
    expect(w).not.toContain("reloadform");
    expect(group(html, "spec-aide/schedule-nightly@sched1")).toContain('action="/api/queue/sched1/cancel"');
  });

  test("a failed scheduled job keeps its notice on the Jobs card", async () => {
    const { base } = scheduled([failedReport]);
    for (const query of ["", "open=aide/schedule-report@reportf"]) {
      const g = group(await rowsOf(base, query), "spec-aide/schedule-report@reportf");
      const line = noticeOf(g);
      expect(text(line)).toContain(t("en", "jobs.endedFailed"));
      expect(g).not.toContain("/api/queue/reportf/cancel");
    }
  });

  test("a Close, a Reopen and a Deploy have no link under the title, open or shut, and none to a log while they run", async () => {
    const { base } = board([
      job({ id: "cl", specFolder: "82-no-job", steps: ["close"] }),
      job({ id: "re", specFolder: "90-finished", steps: ["reopen"] }),
      job({ id: "dep", specFolder: "deploy", steps: ["deploy"] }),
    ]);
    const keys = ["aide/82-no-job:close@cl", "aide/90-finished:reopen@re", "aide/deploy:deploy@dep"];
    for (const query of ["", `open=${keys.join(",")}`]) {
      const html = await rowsOf(base, query);
      for (const key of keys) {
        const g = group(html, `spec-${key}`);
        expect(g).not.toBe("");
        expect(hrefsOf(headOf(g))).toEqual(["/projects/aide"]);
      }
    }
  });

  test("the › opens a shut row and shuts an open one, by the open key, and ?only= answers one row", async () => {
    const { base } = board([report, sched]);

    const shut = group(await rowsOf(base), "spec-aide/schedule-report@report1");
    expect(shut).toContain('data-fold="open"');
    expect(shut).toContain('data-key="aide/schedule-report@report1"');
    const opens = foldHref(shut);
    expect(opens.pathname).toBe("/");
    expect(opens.searchParams.get("open")).toBe("aide/schedule-report@report1");

    const open = group(await rowsOf(base, "open=aide/schedule-report@report1"), "spec-aide/schedule-report@report1");
    const shuts = foldHref(open);
    expect(shuts.pathname).toBe("/");
    expect(shuts.searchParams.get("open")).toBeNull();

    const one = await rowsOf(base, "only=aide/schedule-report@report1");
    expect(one).toContain('id="spec-aide/schedule-report@report1"');
    expect(one).not.toContain('id="spec-aide/schedule-nightly@sched1"');
  });

  test("a row's title line leads with its project: aide:report and aide:nightly", async () => {
    const { base } = board([report, sched]);
    const html = await rowsOf(base);
    expect(titleLine(group(html, "spec-aide/schedule-report@report1"))).toBe("aide:report");
    expect(titleLine(group(html, "spec-aide/schedule-nightly@sched1"))).toBe("aide:nightly");
  });

  test("a running job of a spec on the allowlist has the spec's row, not a job row", async () => {
    const { base } = board([job({ id: "here" })]);
    const on = group(await rowsOf(base), "spec-aide/81-queue-and-runner");
    expect(on).toContain('data-folder="81-queue-and-runner"');
  });
});

describe("a create that ended without a spec shows as the Specs list's message", () => {
  const failed = job({ id: "cr", state: "failed", specFolder: "new-0a1b2c3d", steps: ["create"] });
  const record: FailedCreate = {
    id: "cr", project: "aide", title: "A spec that never was", description: "text",
    reason: { key: "runner.serverRestarted", values: { button: "Create" } },
    failedAt: "2026-10-08T10:05:00.000Z",
  };

  function withRecord() {
    const dir = mkdtempSync(join(tmpdir(), "aide-jobs-failed-create-"));
    tmp.push(dir);
    const failedCreatesPath = join(dir, "failed-creates.json");
    writeFileSync(failedCreatesPath, JSON.stringify([record]));
    return board([failed], { failedCreatesPath, queueProjects: [] });
  }

  test("its message coexists with the empty sentence until dismissed", async () => {
    const { base } = withRecord();
    const html = await rowsOf(base);
    expect(html).toContain(renderFailedCreateNotices([record], "en"));
    expect(html).toContain(t("en", "jobs.nothingRunning"));
    expect(html).not.toContain('id="spec-aide/new-0a1b2c3d"');
  });

  test("once dismissed neither the message nor a row is there", async () => {
    const { base } = withRecord();
    const res = await fetch(`${base}/api/queue/failed-creates/cr/dismiss`, {
      method: "POST",
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    const html = await rowsOf(base);
    expect(html).not.toContain(renderFailedCreateNotices([record], "en"));
    expect(html).not.toContain('id="spec-aide/new-0a1b2c3d"');
  });
});

describe("nothing running", () => {
  test("with no Active spec, no scheduled row and no failed create the rows say so", async () => {
    const empty = await rowsOf(board([], { queueProjects: [] }).base);
    expect(empty).toContain(t("en", "jobs.nothingRunning"));
  });

  test("an empty tab with a saved search still reports nothing running", async () => {
    const { base } = board([], { queueProjects: [] });
    const first = await fetch(`${base}/?rows=1&q=missing`);
    const cookie = first.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => c.startsWith("aide_jobs_view_"));
    expect(cookie).toBeDefined();
    const res = await fetch(`${base}/?rows=1`, { headers: { cookie: cookie! } });
    const html = await res.text();
    expect(html).toContain(t("en", "jobs.nothingRunning"));
    expect(html).not.toContain(t("en", "jobs.noRowMatchesFilter"));
  });

  test("the full page on an empty board is the Running tab, not a redirect to the Specs list", async () => {
    const res = await fetch(`${board([], { queueProjects: [] }).base}/`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(t("en", "jobs.nothingRunning"));
    expect(html).toContain('<meta name="aide-start" content="/specs">');
  });

  test("the full page with a row names no page to start on", async () => {
    const res = await fetch(`${board([job({})]).base}/`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('<meta name="aide-start"');
  });


});

describe("before the board's first specs sweep", () => {
  test("a spec with only its creation record has a row on Jobs (AC-4)", async () => {
    const html = await rowsOf(board([], { specCachePollMs: 0 }).base);
    expect(html).toContain('id="spec-aide/81-queue-and-runner"');
  });
});

describe("New spec", () => {
  test("the Specs list's rows carry the New spec link for a project on the allowlist (AC-7)", async () => {
    const specs = await fetch(`${board().base}/specs?rows=1`, { redirect: "manual" });
    expect(await specs.text()).toContain(newSpecLink({ createProjects: ["aide"] }, "en"));
  });
});

const specKeys = (html: string): string[] =>
  [...html.matchAll(/<tr class="spechead\b[^>]*?\bid="spec-([^"]+)"/g)].map((m) => m[1]!).sort();

const STATE_OF = (done: string[], criteria: { task: string; done: boolean }[] = []): string =>
  JSON.stringify({ completedPhases: done, archived: null, reopened: null, phaseCounts: {}, acceptanceCriteria: criteria });

describe("every spec the Specs list shows under Active has a row, job or not", () => {
  test("a spec implemented and waiting, one held back on an unticked criterion and one analyzed, with no job in the queue", async () => {
    const folders = ["82-implemented", "83-held-back", "84-analyzed"];
    const states: Record<string, string> = {
      "82-implemented": STATE_OF(["create", "analyze", "implement"]),
      "83-held-back": STATE_OF(["create", "analyze", "implement"], [{ task: "AC-1: it holds", done: false }]),
      "84-analyzed": STATE_OF(["create", "analyze"]),
    };
    const { base } = harness.start({
      extra: { queueProjects: ["aide"] }, alsoSpecs: folders,
      before: (dir) => {
        for (const folder of folders) writeFileSync(join(dir, "root", "aide", "specs", folder, "4-status.json"), states[folder]!);
      },
    });

    const html = await pageUntil(base, "/?rows=1", (rows) => folders.every((folder) => rows.includes(`id="spec-aide/${folder}"`)));
    for (const folder of folders) {
      expect(html).toContain(`id="spec-aide/${folder}"`);
      expect(html).toContain(`data-folder="${folder}"`);
    }
  });
});

describe("the Jobs tab keeps work records while Specs also shows unstarted specs", () => {
  const UNMERGED = "92-unmerged";
  const specsRepo = join("aide", "specs");
  // The unmerged spec's branch is on origin and not part of the default branch.
  const gitRun = async (dir: string, args: string[]) => {
    const a = args.join(" ");
    if (a.startsWith("ls-remote --heads") && dir.endsWith(specsRepo)) {
      return { code: 0, stdout: `sha\trefs/heads/aide/${UNMERGED}\n` };
    }
    if (a.startsWith("merge-base --is-ancestor")) return { code: 1, stdout: "" };
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    return { code: 0, stdout: "" };
  };
  const closed = `${statusSaying(["create", "analyze", "close"])}\n- **Closed:** 2026-09-20 — did not hold\n`;

  function everyKind(extraJobs: Record<string, unknown>[] = []) {
    return harness.start({
      extra: { queueProjects: ["aide"], gitRun: gitRun as never },
      alsoSpecs: ["82-no-job"],
      archivedSpecs: { "90-finished": {}, "91-closed": { status: closed }, [UNMERGED]: {} },
      queueMirror: JSON.stringify([
        job({ id: "run81" }),
        job({ id: "cr", specFolder: "new-0a1b2c3d", steps: ["create"] }),
        job({ id: "off", project: "retired", specFolder: "07-old" }),
        ...extraJobs,
      ]),
    });
  }

  /** The list's Active rows, asked until the unmerged archived spec is on them. */
  async function activeList(base: string): Promise<string> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const html = await (await fetch(`${base}/specs?rows=1&state=not-archived`)).text();
      if (html.includes(`id="spec-aide/${UNMERGED}"`)) return html;
      if (Date.now() > deadline) throw new Error("the unmerged archived spec never reached the Active list");
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  test("Jobs leaves a never-run spec on Specs and keeps running and finished work (AC-3, AC-8)", async () => {
    const { base, server } = everyKind();
    const list = await activeList(base);
    await server.settle();
    const tab = await rowsOf(base);
    expect(specKeys(list)).toContain("aide/82-no-job");
    expect(specKeys(tab)).toContain("aide/81-queue-and-runner");
    expect(specKeys(tab)).not.toContain("aide/82-no-job");
    expect(specKeys(tab)).toContain("aide/90-finished");
    expect(specKeys(tab)).toContain("aide/91-closed");
    expect(specKeys(tab)).not.toContain("retired/07-old");
  });

  test("an archived or closed spec keeps its row as a record, whether or not the queue still holds its jobs", async () => {
    const tab = await rowsOf(everyKind([job({ id: "arch90", specFolder: "90-finished", steps: ["archive"], state: "done" })]).base);
    for (const folder of ["90-finished", "91-closed"]) expect(group(tab, `spec-aide/${folder}`)).toContain('data-run="archived"');
  });

  test("an archived spec whose branch is on origin and not merged keeps its mark on both pages", async () => {
    const { base } = everyKind();
    const list = group(await activeList(base), `spec-aide/${UNMERGED}`);
    const tab = group(await rowsOf(base), `spec-aide/${UNMERGED}`);
    expect(tab).not.toBe("");
    expect(tab).toContain("still on origin");
    expect(list).not.toBe("");
    expect(list).toContain("still on origin");
    expect(tab).toContain(">Failed<");
    expect(list).toContain(">Archived<");
  });

  // A Reopen or Close is a job of its own, as a scheduled job is: its own row,
  // never its spec's.
  test("a Reopen running on an archived spec is a row of its own, and the spec has none", async () => {
    const { base } = everyKind([job({ id: "reopen", specFolder: "90-finished", steps: ["reopen"] })]);
    const html = await rowsOf(base);
    expect(group(html, "spec-aide/90-finished:reopen@reopen")).toContain("b-running");
    expect(html).not.toContain('id="spec-aide/90-finished"');
  });

  test("a Close running on a live spec is a row of its own, and the spec's row is not the close's", async () => {
    const { base } = everyKind([job({ id: "close", specFolder: "82-no-job", steps: ["close"] })]);
    const html = await rowsOf(base);
    expect(group(html, "spec-aide/82-no-job:close@close")).toContain("b-running");
    expect(group(html, "spec-aide/82-no-job")).not.toContain("b-running");
  });

  for (const step of ["reopen", "close"]) {
    test(`an open ${step} row has a line per step of the job, a shut one none, and neither offers Stop`, async () => {
      const { base } = everyKind([job({ id: step, specFolder: "90-finished", steps: [step] })]);
      const row = async (query = "") => group(await rowsOf(base, query), `spec-aide/90-finished:${step}@${step}`);
      const lines = (html: string): number => (html.match(/<tr class="subrow" data-step=/g) ?? []).length;
      expect(lines(await row())).toBe(0);
      const open = await row(`open=aide/90-finished:${step}@${step}`);
      expect(lines(open)).toBeGreaterThan(0);
      expect(open).not.toContain("/cancel");
    });
  }
});

describe("a spec's title on the Running tab", () => {
  const FOLDER = "81-queue-and-runner";
  const titleHref = (html: string): string => {
    const g = group(html, `spec-aide/${FOLDER}`);
    return g.match(/<a class="specpart"[^>]*?href="([^"]*)"/)?.[1] ?? "";
  };

  test("leads to the spec's own address, ending in its row's anchor, which answers the Specs list with that row", async () => {
    const { base } = board([job({})]);
    const href = titleHref(await rowsOf(base));
    expect(href).toBe(`/specs/aide/${FOLDER}#spec-aide/${FOLDER}`);

    const page = await (await fetch(`${base}${href.split("#")[0]}`)).text();
    expect(page).toContain(`data-spec-detail="aide/${FOLDER}"`);
    expect(page).toContain(`id="spec-aide/${FOLDER}"`);
  });

  test("the current round keeps the spec's own key, an earlier one a key of its own with the real spec address (AC-7)", async () => {
    const html = await rowsOf(board([job({ id: "first", state: "done", finishedAt: "2026-10-08T10:05:00Z" }),
      job({ id: "reopen-done", steps: ["reopen"], state: "done", createdAt: "2026-10-09T10:00:00Z", finishedAt: "2026-10-09T10:05:00Z" }), job({ id: "second", steps: ["implement"], state: "done", createdAt: "2026-10-10T10:00:00Z", finishedAt: "2026-10-10T10:05:00Z" })]).base);
    expect(group(html, "spec-aide/81-queue-and-runner")).toContain('data-key="aide/81-queue-and-runner"');
    const earlier = group(html, "spec-aide/81-queue-and-runner@2026-10-08T10%3A00%3A00Z");
    expect(earlier).toContain('data-key="aide/81-queue-and-runner@2026-10-08T10%3A00%3A00Z"');
    expect(earlier).toContain('href="/specs/aide/81-queue-and-runner#spec-aide/81-queue-and-runner"');
    expect(earlier).not.toContain('href="/specs/aide/81-queue-and-runner@');
  });
});
// A done Analyze, then a failed Implement. An archive held
// back on an unticked criterion. Both are shown on the Jobs tab, and both are
// rows the Specs list draws.
describe("a spec's shut row on the Jobs tab is the Specs list's row, and its open row adds the phase lines", () => {
  const T = (m: number): string => `2026-10-08T10:${String(m).padStart(2, "0")}:00Z`;
  const step = (name: string, o: Record<string, unknown> = {}) => ({
    step: name, ok: true, exitCode: 0, costUsd: 0.1, costMeasured: true, terminalReason: "completed", repos: [], ...o,
  });
  const jobs = [
    job({ id: "a81", steps: ["analyze"], state: "done", createdAt: T(1), startedAt: T(1), results: [step("analyze")] }),
    job({ id: "i81", steps: ["implement"], state: "failed", createdAt: T(2), startedAt: T(2), results: [step("implement", { ok: false, exitCode: 1, terminalReason: "error" })] }),
    job({
      id: "h82", specFolder: "82-held-back", steps: ["archive"], state: "done", createdAt: T(3), startedAt: T(3),
      results: [step("archive", { terminalReason: "acceptance-criteria-unticked" })],
    }),
    job({ id: "sched1", specFolder: "schedule-nightly", steps: ["schedule"], createdAt: T(4), startedAt: T(4) }),
  ];
  const STATUS = [
    "# Status", "", "## Tracking info", "",
    "- **Workflow steps completed:** create, analyze, implement", "",
    "## Acceptance criteria", "", "| Task | Status | Notes |", "|------|--------|-------|",
    "| AC-1: it holds | ⬜ | |", "",
  ].join("\n");
  const STATE = JSON.stringify({
    completedPhases: ["create", "analyze", "implement"], archived: null, reopened: null, phaseCounts: {},
    acceptanceCriteria: [{ task: "AC-1: it holds", done: false }],
  });
  const OPEN_82 = new URLSearchParams({
    open: "aide/82-held-back",
    checks: "aide/82-held-back",
    phases: "aide/82-held-back:implement",
  }).toString();

  async function settled() {
    const { base, dir } = harness.start({
      extra: { queueProjects: ["aide"] },
      queueMirror: JSON.stringify(jobs),
      alsoSpecs: ["82-held-back", "83-idle"],
      status: STATUS,
    });
    for (const folder of ["81-queue-and-runner", "82-held-back", "83-idle"]) {
      writeFileSync(join(dir, "root", "aide", "specs", folder, "4-status.json"), STATE);
      ran(dir, ["create", "analyze", "implement"], folder);
    }
    // A row reads git caches that fill on their own schedule: ask again until
    // the list's rows are settled, so the two answers below are of one state.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const html = await (await fetch(`${base}/specs?rows=1&${OPEN_82}`)).text();
      if (dated(html) && group(html, "spec-aide/82-held-back").includes('class="checklist"')) break;
      if (Date.now() > deadline) throw new Error("the specs list never settled");
      await new Promise((r) => setTimeout(r, 25));
    }
    return base;
  }

  test("the fixture spec is present on both pages", async () => {
    const base = await settled();
    const jobsTab = group(await rowsOf(base), "spec-aide/81-queue-and-runner");
    const list = group(await (await fetch(`${base}/specs?rows=1`)).text(), "spec-aide/81-queue-and-runner");
    expect(jobsTab).not.toBe("");
    expect(list).not.toBe("");
    expect(jobsTab).toContain("81-queue-and-runner");
    expect(list).toContain("81-queue-and-runner");
  });

  test("an acceptance wait keeps its acceptance panel on both pages (AC-4)", async () => {
    const base = await settled();
    const jobsTab = group(await rowsOf(base, OPEN_82), "spec-aide/82-held-back");
    const list = group(await (await fetch(`${base}/specs/aide/82-held-back?rows=1&${OPEN_82}`)).text(), "spec-aide/82-held-back");
    expect(jobsTab).toContain('class="checklist"');
    expect(jobsTab).toContain('action="/api/queue/specs/aide/82-held-back/tick?fromList=1"');
    expect(jobsTab).toContain("data-step=");
    expect(list).toContain('class="checklist"');
    expect(list).toContain('action="/api/queue/specs/aide/82-held-back/tick?fromList=1"');
  });

  test("a spec with no job opened on each: the Jobs tab has its Run, the list has none", async () => {
    const base = await settled();
    const open = "open=aide/83-idle";
    const jobsTab = group(await rowsOf(base, open), "spec-aide/83-idle");
    const list = group(await (await fetch(`${base}/specs/aide/83-idle?rows=1&${open}`)).text(), "spec-aide/83-idle");
    expect(jobsTab).toContain('class="rowrun"');
    expect(list).not.toBe("");
    expect(list).not.toContain('class="rowrun"');
    expect(jobsTab).toContain("83-idle");
    expect(list).toContain("83-idle");
  });

  test("no link a spec row draws back to its page leads to /specs", async () => {
    const base = await settled();
    const html = await rowsOf(base, OPEN_82);
    expect(html).toContain("<thead>");
    expect(html).not.toMatch(/href="\/specs[?"]/);
  });

  test("?only= answers that spec's rows alone; a spec with no row gets a table with none", async () => {
    const base = await settled();
    const one = await rowsOf(base, `only=aide/81-queue-and-runner&${OPEN_82}`);
    expect(one).toContain('id="spec-aide/81-queue-and-runner"');
    expect(one).not.toContain('id="spec-aide/82-held-back"');
    expect(one).not.toContain('id="spec-aide/schedule-nightly@sched1"');

    const none = await rowsOf(base, "only=aide/99-no-row");
    expect(none).toContain("<table");
    expect(none).not.toContain("spechead");
  });
});

// A running spec and a failed scheduled job of `aide`.
describe("the Jobs tab's view: its address, its cookie and its sentence for no row", () => {
  const report = job({
    id: "reportf", specFolder: "schedule-report", steps: ["schedule"], state: "failed", createdAt: "2026-10-08T10:01:00Z",
    results: [{ step: "schedule", ok: false, exitCode: 1, costUsd: 0.1, costMeasured: true, terminalReason: "error", repos: [] }],
  });
  const SPEC_ID = 'id="spec-aide/81-queue-and-runner"';
  const REPORT_ID = 'id="spec-aide/schedule-report@reportf"';
  const withBoth = () => scheduled([job({ id: "run81" }), report]);

  /** The `name=value` of the Jobs tab's cookie in an answer, as a request sends it back. */
  const jobsCookie = (res: Response): string | undefined =>
    res.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => c.startsWith("aide_jobs_view_"));

  test("a view key narrows the rows and the answer is 200, not a redirect", async () => {
    const { base } = withBoth();
    const html = await rowsOf(base, "state=failed");
    expect(html).toContain(REPORT_ID);
    expect(html).not.toContain(SPEC_ID);
  });

  test("a view that hides every row answers the sentence for it, and no row", async () => {
    const { base } = withBoth();
    const html = await rowsOf(base, "q=nothing-matches");
    expect(html).toContain(t("en", "jobs.noRowMatchesFilter"));
    expect(html).not.toContain("spechead");
  });

  test("?only= follows the view: a row the view hides answers a table with none", async () => {
    const { base } = withBoth();
    const html = await rowsOf(base, "only=aide/81-queue-and-runner&state=failed");
    expect(html).toContain("<table");
    expect(html).not.toContain("spechead");
  });

  test("the tab's own cookie is written, and neither of the Specs list's, and the list writes none of the tab's", async () => {
    const { base } = withBoth();
    const tabRes = await fetch(`${base}/?rows=1&state=stopped&sort=cost&q=x`);
    const names = tabRes.headers.getSetCookie().map((c) => c.split("=")[0]);
    expect(names.some((n) => n!.startsWith("aide_jobs_view_"))).toBe(true);
    expect(names.some((n) => n!.startsWith("aide_state_") || n!.startsWith("aide_sort_"))).toBe(false);

    const listRes = await fetch(`${base}/specs?rows=1&state=failed&sort=spec`);
    expect(listRes.headers.getSetCookie().some((c) => c.startsWith("aide_jobs_view_"))).toBe(false);
  });

  test("the Jobs tab's second heading is Title and the Specs list's is unchanged", async () => {
    const { base } = withBoth();
    const tabHead = (await rowsOf(base)).match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    expect(tabHead).toContain(t("en", "jobs.colTitle"));
    expect(tabHead).not.toContain(t("en", "list.colSpec"));
    const listHead = (await (await fetch(`${base}/specs?rows=1`)).text()).match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    expect(listHead).toContain(t("en", "list.colSpec"));
  });

  test("the Jobs filters have fixed labels and separate choices (AC-1, AC-2)", async () => {
    const { base } = withBoth();
    const html = await rowsOf(base, "state=failed&kind=schedule");
    const state = html.match(/<details[^>]*data-filter="state"[\s\S]*?<\/details>/)?.[0] ?? "";
    const kind = html.match(/<details[^>]*data-filter="kind"[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(html.match(/data-filter="/g)).toHaveLength(2);
    expect(state).toContain(`>${t("en", "list.statesLabel")}<`); expect(kind).toContain(`>${t("en", "jobs.typesLabel")}<`);
    expect(state).toContain(t("en", "list.state.failed")); expect(kind).toContain(t("en", "jobs.filterKindSchedule"));
    expect(state).not.toContain(t("en", "jobs.filterKindSchedule"));
    expect(kind).not.toContain(t("en", "list.state.failed"));
  });

  test("the Jobs bar shows one filtered result count and keeps choice counts (AC-4, AC-5)", async () => {
    const { base } = withBoth();
    const html = await rowsOf(base, "q=report&state=failed&kind=schedule");
    expect(html.match(/data-result-count>\((\d+)\)</g)).toEqual(["data-result-count>(1)<"]);
    expect(html).toContain(`${t("en", "list.state.failed")} (1)`);
    expect(html).toContain(`${t("en", "jobs.filterKindSchedule")} (1)`);
  });

  test("the Jobs filter labels follow the selected language (AC-8)", async () => {
    const { base } = withBoth();
    const html = await rowsOf(base, "lang=de");
    expect(html).toContain(`>${t("de", "list.statesLabel")}<`); expect(html).toContain(`>${t("de", "jobs.typesLabel")}<`);
  });

  describe("a project key", () => {
    const reportOther = job({ ...report, id: "reporto", project: "other", createdAt: "2026-10-08T10:02:00Z" });
    const withOther = () => scheduled([job({ id: "run81" }), report, reportOther]);
    const rowIds = (html: string): string[] => [...html.matchAll(/<tr class="spechead\b[^>]*?\bid="([^"]+)"/g)].map((m) => m[1]!);

    test("with one project on the board and none chosen, the filter bar holds only the state and type dropdowns (AC-1)", async () => {
      const { base } = withOther();
      const html = await rowsOf(base, "");
      expect(html.match(/data-filter="/g)).toHaveLength(2);
      expect(html).toContain('data-filter="state"');
      expect(html).toContain('data-filter="kind"');
      expect(html).not.toContain('data-filter="project"');
    });

    test("an address that carries one keeps only that project's rows (AC-2)", async () => {
      const { base } = withOther();
      const without = rowIds(await rowsOf(base, "state=all"));
      expect(without).toContain("spec-other/schedule-report@reporto");
      expect(rowIds(await rowsOf(base, "state=all&project=other"))).toEqual(["spec-other/schedule-report@reporto"]);
    });

    test("every link and the search form the tab builds from its view carry it on (AC-2)", async () => {
      const { base } = withOther();
      const html = await rowsOf(base, "state=all&project=aide&sort=cost&q=report");
      const form = html.match(/<form class="specsearch"[\s\S]*?<\/form>/)?.[0] ?? "";
      expect(form).toContain('name="sort"');
      expect(form).toContain('name="project" value="aide"');
      // The Project filter's own entries choose a project, All projects none.
      const outsideFilter = html.replace(/<details class="menu state" id="project-filter"[\s\S]*?<\/details>/, "");
      const hrefs = [...outsideFilter.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&")).filter((h) => h.startsWith("/?"));
      expect(hrefs).not.toHaveLength(0);
      expect(hrefs.filter((h) => new URL(h, "http://x").searchParams.get("project") !== "aide")).toEqual([]);
    });
  });

  test("a bare /?rows=1 brings back the view the cookie remembers", async () => {
    const { base } = withBoth();
    const first = await fetch(`${base}/?q=report`);
    const cookie = jobsCookie(first);
    expect(cookie).toBeDefined();
    const res = await fetch(`${base}/?rows=1`, { headers: { cookie: cookie! } });
    const html = await res.text();
    expect(html).toContain(REPORT_ID);
    expect(html).not.toContain(SPEC_ID);
  });
});

describe("a search for an execution-group member", () => {
  const groupedBoard = () => harness.start({
    extra: { queueProjects: ["aide"] },
    executionGroups: [{
      id: "group-1", project: "aide", name: "specs-jobs-improvements",
      members: ["805-grouped-first", "806-grouped-second"], completedMembers: [],
      branch: "aide/group-805-grouped-first", state: "prepared", createdAt: "2026-11-15T10:00:00Z", jobs: [],
    }],
    alsoSpecs: ["804-ungrouped", "805-grouped-first", "806-grouped-second"],
    queueMirror: JSON.stringify([job({ id: "j804", specFolder: "804-ungrouped", state: "done" })]),
  });
  const opened = (html: string): boolean => html.includes('data-group-open="search"');
  const groupCard = (html: string): string =>
    html.match(/<tr class="execution-group"[^>]*id="group-group-1"[\s\S]*?<tr class="specgap"[^>]*>.*?<\/tr>/)?.[0] ?? "";

  test("reported grouped references retain their history and open the existing group disclosure (AC-1, AC-2)", async () => {
    const ordinary = await rowsOf(groupedBoard().base, "q=aide%3A804");
    expect(ordinary).toContain('id="spec-aide/804-ungrouped"');
    harness.cleanup();

    for (const folder of ["805-grouped-first", "806-grouped-second"]) {
      const { base } = groupedBoard();
      const html = await rowsOf(base, `q=${encodeURIComponent(`aide:${folder.split("-")[0]}`)}`);
      const card = groupCard(html);
      expect(card).not.toBe("");
      expect(opened(card)).toBe(true);
      expect(html).toContain(`data-folder="${folder}"`);
      harness.cleanup();
    }
  });
});

describe("the spec a Create just queued is open on arrival, found by its job", () => {
  const create = (specFolder: string) =>
    job({ id: "c1", specFolder, steps: ["create", "analyze"], state: specFolder.startsWith("new-") ? "running" : "queued", createTitle: "A new spec" });
  const opened = (g: string): boolean => /<a class="fold[^"]*"[^>]*aria-expanded="true"/.test(g);

  test("before the spec has its number, and after, `created` opens its row and no other", async () => {
    for (const folder of ["new-abc12345", "630-a-new-spec"]) {
      const { base } = board([create(folder), job({ id: "j2" })]);
      const html = await rowsOf(base, "created=c1");
      expect(opened(group(html, `spec-aide/${folder}`))).toBe(true);
      expect(opened(group(html, "spec-aide/81-queue-and-runner"))).toBe(false);
      harness.cleanup();
    }
  });

  test("a `created` that names no job opens nothing", async () => {
    const { base } = board([job({})]);
    expect(opened(group(await rowsOf(base, "created=gone"), "spec-aide/81-queue-and-runner"))).toBe(false);
  });
});
