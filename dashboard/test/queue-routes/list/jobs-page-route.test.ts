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
import { jobHome } from "../../../src/render/pages/jobs-page/rows.ts";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
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

describe("which kind of row a job gets (AC-5)", () => {
  const wiki = job({ id: "wiki1", specFolder: "wiki-aide", steps: ["wiki"], createdAt: "2026-10-08T10:01:00Z" });
  const sched = job({
    id: "sched1", specFolder: "schedule-nightly", steps: ["schedule"], state: "queued", startedAt: undefined,
    createdAt: "2026-10-08T10:02:00Z",
  });
  const failedWiki = job({
    id: "wikif", specFolder: "wiki-aide", steps: ["wiki"], state: "failed", createdAt: "2026-10-08T10:01:00Z",
    results: [{ step: "wiki", ok: false, exitCode: 1, costUsd: 0.1, costMeasured: true, terminalReason: "error", repos: [] }],
  });
  const OPEN_BOTH = "open=aide/wiki-aide,aide/schedule-nightly";

  const text = (html: string): string => html.replace(/<[^>]*>/g, "");
  const titleLine = (g: string): string => text(g.match(/<div class="spec-name">[\s\S]*?<\/div>/)?.[0] ?? "");
  const foldHref = (g: string): URL => {
    const href = g.match(/<a class="fold[^"]*"[^>]*?href="([^"]*)"/)?.[1] ?? "";
    return new URL(href.replaceAll("&amp;", "&"), "http://board");
  };

  test("a spec has its spec row; a wiki build and a scheduled job show title, state, time and cost shut (AC-5)", async () => {
    const { base } = board([job({}), wiki, sched]);
    const html = await rowsOf(base);

    expect(html).toContain('data-folder="81-queue-and-runner"');

    for (const [id, title] of [["spec-aide/wiki-aide", "Wiki build"], ["spec-aide/schedule-nightly", "nightly"]] as const) {
      const g = group(html, id);
      expect(titleLine(g)).toContain(title);
      expect(g).toContain("badgeslot");
      expect(g).toContain('data-col="started"');
      expect(g).toContain('data-col="cost"');
    }
  });

  test("shut, by default or with another row open, a job row has no links and no Stop or Cancel (AC-5)", async () => {
    const { base } = board([wiki, sched]);
    for (const query of ["", "open=aide/81-queue-and-runner"]) {
      const html = await rowsOf(base, query);
      for (const [id, jobId] of [["spec-aide/wiki-aide", "wiki1"], ["spec-aide/schedule-nightly", "sched1"]]) {
        const g = group(html, id);
        expect(g).not.toBe("");
        expect(g).not.toContain(`/jobs/${jobId}?tab=steps`);
        expect(g).not.toContain("tab=wiki");
        expect(g).not.toContain("tab=schedule");
        expect(g).not.toContain(`/api/queue/${jobId}/cancel`);
        expect(g).not.toContain("data-ask");
      }
    }
  });

  test("open, a wiki build has its Log and Wiki links and a Stop that posts in place; a scheduled job its links and Cancel (AC-5)", async () => {
    const { base } = board([wiki, sched]);
    const html = await rowsOf(base, OPEN_BOTH);

    const w = group(html, "spec-aide/wiki-aide");
    expect(w).toContain('href="/jobs/wiki1?tab=steps"');
    expect(w).toContain(`href="${attr(jobHome(wiki as never))}"`);
    expect(w).toContain('action="/api/queue/wiki1/cancel"');
    expect(w).toContain("actionform");
    expect(w).not.toContain("reloadform");

    const s = group(html, "spec-aide/schedule-nightly");
    expect(s).toContain('href="/jobs/sched1?tab=steps"');
    expect(s).toContain(`href="${attr(jobHome(sched as never))}"`);
    expect(s).toContain('action="/api/queue/sched1/cancel"');
  });

  test("an open row of a failed wiki build has its links and nothing to stop (AC-5)", async () => {
    const { base } = board([failedWiki]);
    const g = group(await rowsOf(base, "open=aide/wiki-aide"), "spec-aide/wiki-aide");
    expect(g).toContain('href="/jobs/wikif?tab=steps"');
    expect(g).toContain(`href="${attr(jobHome(failedWiki as never))}"`);
    expect(g).not.toContain("/api/queue/wikif/cancel");
    expect(g).not.toContain("data-ask");
  });

  test("the › opens a shut row and shuts an open one, by the open key, and ?only= answers one row (AC-5)", async () => {
    const { base } = board([wiki, sched]);

    const shut = group(await rowsOf(base), "spec-aide/wiki-aide");
    expect(shut).toContain('data-fold="open"');
    expect(shut).toContain('data-key="aide/wiki-aide"');
    const opens = foldHref(shut);
    expect(opens.pathname).toBe("/");
    expect(opens.searchParams.get("open")).toBe("aide/wiki-aide");

    const open = group(await rowsOf(base, "open=aide/wiki-aide"), "spec-aide/wiki-aide");
    const shuts = foldHref(open);
    expect(shuts.pathname).toBe("/");
    expect(shuts.searchParams.get("open")).toBeNull();

    const one = await rowsOf(base, "only=aide/wiki-aide");
    expect(one).toContain('id="spec-aide/wiki-aide"');
    expect(one).not.toContain('id="spec-aide/schedule-nightly"');
  });

  test("a row's title line leads with its project: aide:Wiki build and aide:nightly (AC-5)", async () => {
    const { base } = board([wiki, sched]);
    const html = await rowsOf(base);
    expect(titleLine(group(html, "spec-aide/wiki-aide"))).toBe("aide:Wiki build");
    expect(titleLine(group(html, "spec-aide/schedule-nightly"))).toBe("aide:nightly");
  });

  test("a running job of a spec on the allowlist has the spec's row, not a job row (AC-5)", async () => {
    const { base } = board([job({ id: "here" })]);
    const on = group(await rowsOf(base), "spec-aide/81-queue-and-runner");
    expect(on).toContain('data-folder="81-queue-and-runner"');
    expect(on).not.toContain('href="/jobs/here?tab=steps"');
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
    return board([failed], { failedCreatesPath });
  }

  test("its message is on the Jobs tab while it is not dismissed, never a row, and not the empty sentence", async () => {
    const { base } = withRecord();
    const html = await rowsOf(base);
    expect(html).toContain(renderFailedCreateNotices([record], "en"));
    expect(html).not.toContain(t("en", "jobs.nothingRunning"));
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

describe("nothing running (AC-1)", () => {
  test("with no Active spec, no wiki or scheduled row and no failed create the rows say so and draw no table (AC-1)", async () => {
    const empty = await rowsOf(board([], { queueProjects: [] }).base);
    expect(empty).toContain(t("en", "jobs.nothingRunning"));
    expect(empty).not.toContain("<table");
  });

  test("an Active spec alone, with no job in the queue, is a row and not the empty sentence (AC-1)", async () => {
    const busy = await rowsOf(board().base);
    expect(busy).not.toContain(t("en", "jobs.nothingRunning"));
    expect(busy).toContain("<table");
  });
});

const specKeys = (html: string): string[] =>
  [...html.matchAll(/<tr class="spechead\b[^>]*?\bid="spec-([^"]+)"/g)].map((m) => m[1]!).sort();

const STATE_OF = (done: string[], criteria: { task: string; done: boolean }[] = []): string =>
  JSON.stringify({ completedPhases: done, archived: null, reopened: null, phaseCounts: {}, acceptanceCriteria: criteria });

describe("every spec the Specs list shows under Active has a row, job or not (AC-1)", () => {
  test("a spec implemented and waiting, one held back on an unticked criterion and one analyzed, with no job in the queue (AC-1)", async () => {
    const folders = ["82-implemented", "83-held-back", "84-analyzed"];
    const { base, dir } = harness.start({ extra: { queueProjects: ["aide"] }, alsoSpecs: folders });
    const states: Record<string, string> = {
      "82-implemented": STATE_OF(["create", "analyze", "implement"]),
      "83-held-back": STATE_OF(["create", "analyze", "implement"], [{ task: "AC-1: it holds", done: false }]),
      "84-analyzed": STATE_OF(["create", "analyze"]),
    };
    for (const folder of folders) {
      writeFileSync(join(dir, "root", "aide", "specs", folder, "4-status.json"), states[folder]!);
    }

    const html = await rowsOf(base);
    for (const folder of folders) {
      expect(html).toContain(`id="spec-aide/${folder}"`);
      expect(html).toContain(`data-folder="${folder}"`);
    }
  });
});

describe("the Jobs tab and the Specs list's Active entry show the same specs (AC-1, AC-2)", () => {
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

  test("the spec rows of both answers name the same <project>/<folder> keys (AC-1, AC-2)", async () => {
    const { base } = everyKind();
    const list = await activeList(base);
    const tab = await rowsOf(base);
    expect(specKeys(tab)).toEqual(specKeys(list));
    expect(specKeys(tab)).toContain("aide/81-queue-and-runner");
    expect(specKeys(tab)).toContain("aide/82-no-job");
    expect(specKeys(tab)).not.toContain("aide/90-finished");
    expect(specKeys(tab)).not.toContain("aide/91-closed");
    expect(specKeys(tab)).not.toContain("retired/07-old");
  });

  test("an archived spec whose branch is on origin and not merged has the list's row for it, with its mark (AC-1, AC-2)", async () => {
    const { base } = everyKind();
    const list = group(await activeList(base), `spec-aide/${UNMERGED}`);
    const tab = group(await rowsOf(base), `spec-aide/${UNMERGED}`);
    expect(tab).not.toBe("");
    expect(tab).toContain("still on origin");
    // The list's links carry the Active entry it was asked for; the tab's carry none.
    const asTab = list.replaceAll("&amp;state=not-archived", "").replaceAll('href="/specs?', 'href="/?');
    expect(tab).toBe(asTab.replaceAll('href="/specs"', 'href="/"'));
  });

  test("a finished archived spec with a Reopen running and a closed spec with a failed job have no row of any kind (AC-2)", async () => {
    const { base } = everyKind([
      job({ id: "reopen", specFolder: "90-finished", steps: ["reopen"] }),
      job({ id: "bad", specFolder: "91-closed", steps: ["analyze"], state: "failed" }),
    ]);
    await activeList(base);
    const html = await rowsOf(base);
    expect(html).not.toContain("90-finished");
    expect(html).not.toContain("91-closed");
    expect(html).not.toContain("/jobs/reopen");
    expect(html).not.toContain("/jobs/bad");
  });
});

describe("the rows stand in the tab's order (AC-4)", () => {
  test("a running spec first, then the waiting wiki builds, the one that changed last first (AC-4)", async () => {
    const failedWiki = (o: Record<string, unknown>) =>
      job({
        state: "failed", steps: ["wiki"],
        results: [{ step: "wiki", ok: false, exitCode: 1, costUsd: 0.1, costMeasured: true, terminalReason: "error", repos: [] }],
        ...o,
      });
    // `other` was made later than `aide` but `aide` finished last.
    const { base } = board([
      failedWiki({ id: "wa", specFolder: "wiki-aide", createdAt: "2026-10-08T10:01:00Z", finishedAt: "2026-10-08T12:00:00Z" }),
      failedWiki({ id: "wo", project: "other", specFolder: "wiki-other", createdAt: "2026-10-08T10:05:00Z", finishedAt: "2026-10-08T10:06:00Z" }),
      job({ id: "run81" }),
    ]);
    const html = await rowsOf(base);
    const at = (id: string): number => html.indexOf(`id="spec-${id}"`);
    expect(at("aide/81-queue-and-runner")).toBeGreaterThan(-1);
    expect(at("aide/81-queue-and-runner")).toBeLessThan(at("aide/wiki-aide"));
    expect(at("aide/wiki-aide")).toBeLessThan(at("other/wiki-other"));
  });
});

// Spec 81: a done Analyze, then a failed Implement. Spec 82: an archive held
// back on an unticked criterion. Both are shown on the Jobs tab, and both are
// rows the Specs list draws.
describe("a spec's row on the Jobs tab is the Specs list's row (AC-3)", () => {
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

  // The list's links to its own address read as the Jobs tab's.
  const asJobs = (html: string): string => html.replaceAll('href="/specs?', 'href="/?').replaceAll('href="/specs"', 'href="/"');

  test("spec 81's rows are the list's rows for it (AC-3)", async () => {
    const base = await settled();
    const jobsTab = group(await rowsOf(base), "spec-aide/81-queue-and-runner");
    const list = group(await (await fetch(`${base}/specs?rows=1`)).text(), "spec-aide/81-queue-and-runner");
    expect(jobsTab).not.toBe("");
    expect(jobsTab).toBe(asJobs(list));
  });

  test("a held-back spec, open with its criteria and a phase's log unfolded, is the list's row too (AC-3)", async () => {
    const base = await settled();
    const jobsTab = group(await rowsOf(base, OPEN_82), "spec-aide/82-held-back");
    const list = group(await (await fetch(`${base}/specs?rows=1&${OPEN_82}`)).text(), "spec-aide/82-held-back");
    expect(jobsTab).toContain('class="checklist"');
    expect(jobsTab).toBe(asJobs(list));
  });

  test("a spec with no job, opened, is the list's rows for it too (AC-3)", async () => {
    const base = await settled();
    const open = "open=aide/83-idle";
    const jobsTab = group(await rowsOf(base, open), "spec-aide/83-idle");
    const list = group(await (await fetch(`${base}/specs?rows=1&${open}`)).text(), "spec-aide/83-idle");
    expect(jobsTab).not.toBe("");
    expect(jobsTab).toBe(asJobs(list));
  });

  test("neither a heading nor any link a spec row draws back to its page leads to /specs (AC-3)", async () => {
    const base = await settled();
    const html = await rowsOf(base, OPEN_82);
    expect(html).toContain("<thead>");
    expect(html).not.toMatch(/href="\/specs(\?|")/);
    expect(html).not.toMatch(/<thead>[\s\S]*?<a\b[\s\S]*?<\/thead>/);
  });

  test("?only= answers that spec's rows alone; a spec with no row gets a table with none (AC-3)", async () => {
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
