// GET / is the Jobs page: the board's first page. These are the rules it has
// of its own — what it answers, where an old Specs list link goes, which jobs
// get which kind of row, the sentence for nothing — and that a spec's row on
// it is the row the Specs list draws.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { t } from "../../../src/i18n";
import type { FailedCreate } from "../../../src/push/failed-creates.ts";
import { renderFailedCreateNotices } from "../../../src/render/pages/specs-list/failed-create-notices.ts";
import { jobHome, jobTitle } from "../../../src/render/pages/jobs-page/rows.ts";
import { ran } from "../../helpers/queue-server.ts";
import { dated, setupQueueRoutesHarness } from "../fixtures.ts";

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

const board = (jobs: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) =>
  harness.start({
    extra: { queueProjects: ["aide"], ...extra },
    ...(jobs.length ? { queueMirror: JSON.stringify(jobs) } : {}),
  });

/** The Jobs tab's rows. Not followed through a redirect: the Specs list's rows are not the answer. */
const rowsOf = async (base: string, query = ""): Promise<string> => {
  const res = await fetch(`${base}/?rows=1${query ? `&${query}` : ""}`, { redirect: "manual" });
  expect(res.status).toBe(200);
  return await res.text();
};

/** One row group: from its title line, as the page script finds it, to its gap row. */
const group = (html: string, id: string): string =>
  html.match(new RegExp(`<tr class="spechead\\b[^>]*?\\bid="${id}"[\\s\\S]*?<tr class="specgap"[^>]*>.*?</tr>`))?.[0] ?? "";

const attr = (s: string): string => s.replaceAll("&", "&amp;");

describe("GET / answers the Jobs page, GET /?rows=1 its rows alone (AC-1)", () => {
  test("the page holds its rows in #jobrows, the rows answer holds no page around them (AC-1)", async () => {
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

  test("a method other than GET is refused (AC-1)", async () => {
    const { base } = board();
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
  });

  test("an address with no list key is the Jobs page, in the reader's language (AC-1)", async () => {
    const { base } = board();
    const res = await fetch(`${base}/?lang=nb`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="jobrows"');
  });
});

describe("an old link to the Specs list is sent on (AC-1)", () => {
  test("state, project, sort, dir and q answer 302 to /specs with the same query (AC-1)", async () => {
    const { base } = board();
    for (const key of ["state", "project", "sort", "dir", "q"]) {
      const res = await fetch(`${base}/?${key}=x`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/specs?${key}=x`);
    }
  });

  test("an empty value is caught too (AC-1)", async () => {
    const { base } = board();
    const res = await fetch(`${base}/?q=`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/specs?q=");
  });

  test("rows, only, open, checks and phases are the Jobs tab's own: it answers, it sends nothing on (AC-1)", async () => {
    const { base } = board([job({})]);
    for (const key of ["rows", "only", "open", "checks", "phases"]) {
      const res = await fetch(`${base}/?${key}=aide/81-queue-and-runner`, { redirect: "manual" });
      expect(res.status).toBe(200);
    }
    const open = await (await fetch(`${base}/?open=aide/81-queue-and-runner`)).text();
    expect(open).toContain('id="jobrows"');
  });
});

describe("which kind of row a job gets (AC-2, AC-6)", () => {
  const wiki = job({ id: "wiki1", specFolder: "wiki-aide", steps: ["wiki"], createdAt: "2026-10-08T10:01:00Z" });
  const sched = job({
    id: "sched1", specFolder: "schedule-nightly", steps: ["schedule"], state: "queued", startedAt: undefined,
    createdAt: "2026-10-08T10:02:00Z",
  });

  test("a spec has its spec row; a wiki build and a scheduled job have a job row each, with title, Log and home (AC-2)", async () => {
    const { base } = board([job({}), wiki, sched]);
    const html = await rowsOf(base);

    expect(html).toContain('data-folder="81-queue-and-runner"');

    const w = group(html, "spec-aide/wiki-aide");
    expect(w).toContain(attr(jobTitle({ ...wiki, wikiRefresh: false } as never, "en", () => undefined)));
    expect(w).toContain('href="/jobs/wiki1?tab=steps"');
    expect(w).toContain(`href="${attr(jobHome(wiki as never))}"`);

    const s = group(html, "spec-aide/schedule-nightly");
    expect(s).toContain(attr(jobTitle(sched as never, "en", () => undefined)));
    expect(s).toContain('href="/jobs/sched1?tab=steps"');
    expect(s).toContain(`href="${attr(jobHome(sched as never))}"`);
  });

  test("a job row's Stop posts in place, as the list's Cancel does (AC-6)", async () => {
    const { base } = board([wiki]);
    const w = group(await rowsOf(base), "spec-aide/wiki-aide");
    expect(w).toContain('action="/api/queue/wiki1/cancel"');
    expect(w).toContain("actionform");
    expect(w).not.toContain("reloadform");
  });

  test("a running job of a project off the allowlist has a job row; on the allowlist it has the spec's row (AC-2)", async () => {
    const { base } = board([job({ id: "gone", project: "retired", specFolder: "07-old" }), job({ id: "here" })]);
    const html = await rowsOf(base);

    const off = group(html, "spec-retired/07-old");
    expect(off).toContain('href="/jobs/gone?tab=steps"');
    expect(off).not.toContain('data-folder="07-old"');

    const on = group(html, "spec-aide/81-queue-and-runner");
    expect(on).toContain('data-folder="81-queue-and-runner"');
    expect(on).not.toContain('href="/jobs/here?tab=steps"');
  });

  test("a finished job that needs nobody has no row (AC-2)", async () => {
    const { base } = board([job({ state: "done", specFolder: "55-finished-fine" })]);
    const html = await rowsOf(base);
    expect(html).not.toContain("55-finished-fine");
    expect(html).toContain(t("en", "jobs.nothingRunning"));
  });
});

describe("a create that ended without a spec shows as the Specs list's message (AC-3)", () => {
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
    return board([failed], { failedCreatesPath });
  }

  test("its message is on the Jobs tab while it is not dismissed, never a row, and not the empty sentence (AC-3)", async () => {
    const { base } = withRecord();
    const html = await rowsOf(base);
    expect(html).toContain(renderFailedCreateNotices([record], "en"));
    expect(html).not.toContain(t("en", "jobs.nothingRunning"));
    expect(html).not.toContain('id="spec-aide/new-0a1b2c3d"');
  });

  test("once dismissed neither the message nor a row is there (AC-3)", async () => {
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

describe("nothing running (AC-7)", () => {
  test("with nothing to show the rows say so and draw no table; with a running job they do not (AC-7)", async () => {
    const empty = await rowsOf(board().base);
    expect(empty).toContain(t("en", "jobs.nothingRunning"));
    expect(empty).not.toContain("<table");

    const busy = await rowsOf(board([job({})]).base);
    expect(busy).not.toContain(t("en", "jobs.nothingRunning"));
    expect(busy).toContain("<table");
  });
});

// Spec 81: a done Analyze, then a failed Implement. Spec 82: an archive held
// back on an unticked criterion. Both are shown on the Jobs tab, and both are
// rows the Specs list draws.
describe("a spec's row on the Jobs tab is the Specs list's row (AC-4, AC-5)", () => {
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
    job({ id: "wiki1", specFolder: "wiki-aide", steps: ["wiki"], createdAt: T(4), startedAt: T(4) }),
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
      alsoSpecs: ["82-held-back"],
      status: STATUS,
    });
    for (const folder of ["81-queue-and-runner", "82-held-back"]) {
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

  // The list's links to its own address read as the Jobs tab's.
  const asJobs = (html: string): string => html.replaceAll('href="/specs?', 'href="/?').replaceAll('href="/specs"', 'href="/"');

  test("spec 81's rows are the list's rows for it (AC-4)", async () => {
    const base = await settled();
    const jobsTab = group(await rowsOf(base), "spec-aide/81-queue-and-runner");
    const list = group(await (await fetch(`${base}/specs?rows=1`)).text(), "spec-aide/81-queue-and-runner");
    expect(jobsTab).not.toBe("");
    expect(jobsTab).toBe(asJobs(list));
  });

  test("a held-back spec, open with its criteria and a phase's log unfolded, is the list's row too (AC-5)", async () => {
    const base = await settled();
    const jobsTab = group(await rowsOf(base, OPEN_82), "spec-aide/82-held-back");
    const list = group(await (await fetch(`${base}/specs?rows=1&${OPEN_82}`)).text(), "spec-aide/82-held-back");
    expect(jobsTab).toContain('class="checklist"');
    expect(jobsTab).toBe(asJobs(list));
  });

  test("neither a heading nor any link a spec row draws back to its page leads to /specs (AC-4)", async () => {
    const base = await settled();
    const html = await rowsOf(base, OPEN_82);
    expect(html).toContain("<thead>");
    expect(html).not.toMatch(/href="\/specs(\?|")/);
    expect(html).not.toMatch(/<thead>[\s\S]*?<a\b[\s\S]*?<\/thead>/);
  });

  test("?only= answers that spec's rows alone; a spec with no row gets a table with none (AC-5)", async () => {
    const base = await settled();
    const one = await rowsOf(base, `only=aide/81-queue-and-runner&${OPEN_82}`);
    expect(one).toContain('id="spec-aide/81-queue-and-runner"');
    expect(one).not.toContain('id="spec-aide/82-held-back"');
    expect(one).not.toContain('id="spec-aide/wiki-aide"');

    const none = await rowsOf(base, "only=aide/99-no-row");
    expect(none).toContain("<table");
    expect(none).not.toContain("spechead");
  });
});
