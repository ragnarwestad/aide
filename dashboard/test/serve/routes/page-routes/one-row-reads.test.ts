import * as heads from "../../../../src/render/pages/specs-list/head-row.ts";
import { t } from "../../../../src/i18n";
import * as phases from "../../../../src/render/pages/specs-list/data-model/phases.ts";
import { targets as lookupTargets, type SpecLookupContext, type ScanState } from "../../../../src/serve/spec-lookup.ts";
import * as coverage from "../../../../src/project/ac-coverage.ts";
// What a request for one row asks the server for. The three routes a › asks
// are handed a context made by hand, which records every job a row view was
// built for and the keys every read of the archive was cut to: one row's
// request asks for that row's, and a list request for its selected range.

import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "../../../../src/queue/queue.ts";
import type { QueueRowView, SpecTarget } from "../../../../src/render";
import type { RoutesContext } from "../../../../src/serve/routes";
import { jobsPage } from "../../../../src/serve/routes/page-routes/jobs-page.ts";
import { specsPages } from "../../../../src/serve/routes/page-routes/specs-pages.ts";
import { specPageRoutes } from "../../../../src/serve/routes/spec-edit/spec-page.ts";
import { view as specView } from "../../../render/pages/spec-page-fixtures.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const job = (o: Record<string, unknown>) => ({
  id: "j", project: "aide", specFolder: "01-one", steps: ["analyze"], stepIndex: 0, state: "done",
  timeoutSec: {}, permissionMode: {}, model: {}, results: [],
  createdAt: "2026-11-10T10:00:00Z", startedAt: "2026-11-10T10:00:00Z", finishedAt: "2026-11-10T10:05:00Z", ...o,
});
const JOBS = [
  job({ id: "a1" }),
  job({ id: "a2", specFolder: "02-two" }),
  job({ id: "i2", specFolder: "02-two", steps: ["implement"], state: "failed", createdAt: "2026-11-10T11:00:00Z" }),
  job({ id: "a3", specFolder: "03-three" }),
  job({ id: "report", specFolder: "schedule-report", steps: ["schedule"], state: "failed" }),
  job({ id: "dep", specFolder: "deploy", steps: ["deploy"] }),
];
const SPEC_JOBS = ["a1", "a2", "a3", "i2"];
const EVERY_JOB = [...SPEC_JOBS, "dep", "report"].sort();
const TWO = "aide/02-two";

/** A route context over a real queue. `rowsFor` holds the id of every job a
 *  row view was built for; `archive` the keys each read of the archive was cut
 *  to, `undefined` for a read of the whole archive. */
function board(count?: number, mixed = false) {
  const records = count ? Array.from({ length: count }, (_, i) => job({ id: `j${i}`, specFolder: mixed && i % 4 === 0 ? `schedule-${i}` : `${String(i).padStart(5, "0")}-item`, ...(!mixed ? { createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() } : {}), ...(mixed ? { steps: [i % 4 === 0 ? "schedule" : "analyze"], state: i % 4 === 0 ? "failed" : "running" } : {}) })) : JOBS;
  const dir = mkdtempSync(join(tmpdir(), "aide-one-row-reads-"));
  dirs.push(dir);
  writeFileSync(join(dir, "queue.json"), JSON.stringify(records));
  const queue = new QueueStore({
    mirrorPath: join(dir, "queue.json"),
    defaults: { timeoutSec: { default: 600 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => null,
  });
  const targets: SpecTarget[] = (count ? records.filter((_, i) => !mixed || i % 4 === 1 || i % 4 === 2).map((j) => j.specFolder as string) : ["01-one", "02-two", "03-three"]).map((specFolder, i) => ({ project: "aide", specFolder, ...(count && !mixed ? { createdAt: records[i]!.createdAt as string } : {}) }));
  const archived = mixed ? records.filter((_, i) => i % 4 === 3).map((record) => ({
    project: "aide", folder: record.specFolder as string, title: "Archived work", done: ["create", "analyze", "implement", "archive"],
    closed: Number(String(record.id).slice(1)) % 8 === 3, models: {}, phaseOutcomes: { implement: { timeSpentMs: 1000, cost: 1 } }, summaryDuration: { ms: 1000 },
  })) : [];
  if (mixed && targets.length > 1) {
    targets[0]!.group = { name: "Release", position: 1 };
    targets[1]!.group = { name: "Release", position: 2 };
  }
  const rowsFor: string[] = [];
  const archive: (string[] | undefined)[] = [];
  let html = "";
  const ctx = {
    opts: { runnerAvailable: true },
    runner: null,
    nav: () => [{ label: "Projects", path: "/projects" }],
    allowed: new Set(["aide"]),
    serverPort: () => 0,
    queue,
    scheduleStore: { list: () => [] },
    push: { failedCreates: { list: () => [] } },
    targets: () => targets,
    withFreshness: (list: SpecTarget[]) => list,
    readScan: () => ({ archived: archived.map((spec) => `aide/${spec.folder}`) }),
    archivedSpecSummaries: () => archived,
    specRef: () => undefined,
    specDir: (_project: string, folder: string) => `/nowhere/${folder}`,
    pdfToolAvailable: false,
    jobRow: async (j: ReturnType<QueueStore["list"]>[number]) => {
      rowsFor.push(j.id);
      return { ...j, spentUsd: 0, timeoutSec: 600 } as unknown as QueueRowView;
    },
    archivedSpecRows: (_state: string | undefined, only?: ReadonlySet<string>) => {
      archive.push(only ? [...only] : undefined);
      return archived.filter((spec) => !only || only.has(`aide/${spec.folder}`));
    },
    specPageView: async (project: string, specFolder: string) => specView({ project, specFolder }),
  } as unknown as RoutesContext;

  const ask = async (route: typeof jobsPage, address: string): Promise<Response> => {
    rowsFor.length = 0;
    archive.length = 0;
    const url = new URL(`http://board.test${address}`);
    const res = await route(ctx, new Request(url), url, url.pathname);
    if (!res) throw new Error(`${address} is not this route's`);
    const body = html = await res.text();
    res.headers.set("x-benchmark-bytes", String(new TextEncoder().encode(body).length));
    return res;
  };
  /** What the last request read: the jobs it built a row view for, and the cuts of its archive reads. */
  const read = () => ({ rows: [...new Set(rowsFor)].sort(), archive: [...new Set(archive.map((keys) => JSON.stringify(keys?.sort())))] });
  return { ask, read, targets, queue, ctx, html: () => html };
}

const cutTo = (...keys: string[]) => [JSON.stringify(keys?.sort())];
const SELECTED_ARCHIVE = cutTo("aide/01-one", "aide/02-two", "aide/03-three");

describe("the Jobs tab's route", () => {
  test("one spec's row builds that spec's jobs and reads the archive for it alone (AC-1)", async () => {
    const { ask, read } = board();
    expect((await ask(jobsPage, `/?rows=1&only=${TWO}`)).status).toBe(200);
    expect(read()).toEqual({ rows: ["a2", "i2"], archive: cutTo(TWO) });
  });

  test("`only` without `rows`, and the app's start address, build the whole view (AC-1)", async () => {
    const { ask, read } = board();
    await ask(jobsPage, `/?only=${TWO}`);
    expect(read()).toEqual({ rows: EVERY_JOB, archive: SELECTED_ARCHIVE });
    expect((await ask(jobsPage, `/app?rows=1&only=${TWO}`)).status).toBe(302);
    expect(read()).toEqual({ rows: EVERY_JOB, archive: SELECTED_ARCHIVE });
  });

  test("one job's row builds that job alone and reads no archived spec (AC-2)", async () => {
    const { ask, read } = board();
    await ask(jobsPage, "/?rows=1&only=aide/deploy:deploy");
    expect(read()).toEqual({ rows: ["dep"], archive: cutTo() });
  });
});

describe("the Specs list's route", () => {
  test("one spec's row builds that spec's jobs and reads the archive for it alone (AC-3)", async () => {
    const { ask, read } = board();
    expect((await ask(specsPages, `/specs?rows=1&only=${TWO}`)).status).toBe(200);
    expect(read()).toEqual({ rows: ["a2", "i2"], archive: cutTo(TWO) });
  });

  test("the rows of the whole list build the selected jobs and restrict archive reads to their keys (AC-3)", async () => {
    const { ask, read } = board();
    await ask(specsPages, "/specs?rows=1");
    expect(read()).toEqual({ rows: SPEC_JOBS, archive: SELECTED_ARCHIVE });
  });
});

describe("a spec's own address", () => {
  test("the spec opened in place builds that spec's jobs and reads the archive for it alone (AC-4)", async () => {
    const { ask, read } = board();
    const res = await ask(specPageRoutes, "/specs/aide/02-two?detail=1");
    expect(res.status).toBe(200);
    expect(read()).toEqual({ rows: ["a2", "i2"], archive: cutTo(TWO) });
  });

  test("another spec's row builds that other spec's jobs alone (AC-4)", async () => {
    const { ask, read } = board();
    await ask(specPageRoutes, "/specs/aide/02-two?rows=1&only=aide/03-three");
    expect(read()).toEqual({ rows: ["a3"], archive: cutTo("aide/03-three") });
  });

  test("the rows of the whole list build the selected jobs and restrict archive reads to their keys (AC-4)", async () => {
    const { ask, read } = board();
    await ask(specPageRoutes, "/specs/aide/02-two?rows=1");
    expect(read()).toEqual({ rows: SPEC_JOBS, archive: SELECTED_ARCHIVE });
  });
});

if (process.env.BATCH_BENCHMARK) {
  test("measure list responses over fixed large datasets", async () => {
    for (const count of [1000, 10000]) {
      const { ask, read } = board(count, process.env.BATCH_MIXED === "1");
      for (const [route, path] of [[jobsPage, "/?state=all"], [specsPages, "/specs?state=all"]] as const) {
        for (const suffix of ["", "&limit=200", "&rows=1&limit=200"]) {
          const times: number[] = [];
          let bytes = 0;
          for (let n = 0; n < 5; n++) {
            const started = performance.now();
            const response = await ask(route, path + suffix);
            bytes = Number(response.headers.get("x-benchmark-bytes"));
            times.push(performance.now() - started);
          }
          times.sort((a, b) => a - b);
          console.log(JSON.stringify({ count, path: path + suffix, ms: times, bytes, detailJobs: read().rows.length, archiveSelections: read().archive.map((keys) => keys === undefined ? "all" : JSON.parse(keys).length) }));
        }
      }
    }
  }, 120000);
}

for (const [route, path] of [[jobsPage, "/"], [specsPages, "/specs"]] as const) {
  test(`${path} selects globally before building only the loaded jobs (AC-1, AC-4, AC-5, AC-9, AC-10)`, async () => {
    const { ask, read, targets } = board(250);
    targets[0]!.description = "unique older needle";
    await ask(route, `${path}?state=all`);
    expect(read().rows).toHaveLength(100);
    expect(read().rows).not.toContain("j0");
    await ask(route, `${path}?state=all&limit=200&rows=1`);
    expect(read().rows).toHaveLength(200);
    await ask(route, `${path}?state=all&q=needle`);
    expect(read().rows).toEqual(["j0"]);
    targets[0]!.notVerified = 1;
    await ask(route, `${path}?state=not-verified`);
    expect(read().rows).toEqual(["j0"]);
    await ask(path === "/specs" ? specPageRoutes : route, path === "/specs" ? "/specs/aide/00000-item?state=all&detail=1" : `${path}?state=all&open=aide/00000-item`);
    expect(read().rows).toContain("j0");
    expect(read().rows.length).toBeLessThanOrEqual(101);
  });
}

for (const [route, path] of [[jobsPage, "/"], [specsPages, "/specs"]] as const) {
  test(`${path} counts globally and never reads hidden target details (AC-5, AC-10)`, async () => {
    const { ask, targets, html, read } = board(250);
    const detailed = new Set<string>();
    for (const target of targets) {
      Object.defineProperty(target, "acceptance", { get() { detailed.add(target.specFolder); return undefined; } });
    }
    const phaseReads = spyOn(phases, "phasesFor");
    const headReads = spyOn(heads, "specHeadRow");
    await ask(route, `${path}?state=all`);
    const phaseTargets = phaseReads.mock.calls.map((call) => call[1]?.specFolder);
    const headTargets = headReads.mock.calls.map((call) => call[0].specFolder);
    headReads.mockRestore();
    phaseReads.mockRestore();
    expect(html()).toContain('data-result-count>(250)');
    expect(detailed.size).toBe(100);
    const selected = new Set(read().rows.map((id) => targets[Number(id.slice(1))]!.specFolder));
    expect([...detailed].every((folder) => selected.has(folder))).toBe(true);
    expect(phaseTargets.every((folder) => !!folder && selected.has(folder))).toBe(true);
    expect(headTargets.length).toBeGreaterThan(0);
    expect(headTargets.every((folder) => selected.has(folder))).toBe(true);
  });
}

for (const [route, path] of [[jobsPage, "/"], [specsPages, "/specs"]] as const) {
  test(`${path} retries selection when the queue changes during enrichment (AC-7)`, async () => {
    const { ask, ctx, queue, read } = board(150);
    const original = ctx.jobRow;
    let changed = false;
    ctx.jobRow = async (job) => {
      if (!changed) { changed = true; queue.update("j149", { state: "failed" }); }
      return original(job);
    };
    const response = await ask(route, `${path}?state=all&rows=1`);
    expect(response.status).toBe(200);
    expect(changed).toBe(true);
    expect(read().rows).toHaveLength(100);
  });
}

test("cold and expired live scans defer acceptance coverage until a selected target reads it (AC-10)", () => {
  const root = mkdtempSync(join(tmpdir(), "batch-target-scan-"));
  dirs.push(root);
  const project = join(root, "aide");
  mkdirSync(join(project, ".aide"), { recursive: true });
  writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
  for (let i = 0; i < 150; i++) {
    const dir = join(project, "specs", `${i + 1}-scan`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "1-description.md"), "# Scan\n");
    writeFileSync(join(dir, "4-status.md"), "# Status\n");
    writeFileSync(join(dir, "4-status.json"), JSON.stringify({ completedPhases: ["analyze"], acceptanceCriteria: [{ task: "Check", done: false }] }));
  }
  let scan: ScanState | null = null;
  const ctx = {
    projectRoot: root, allowed: new Set(["aide"]), machineryProjectDir: () => project,
    ownedSpecsRoot: () => undefined, readScan: () => scan, writeScan: (value: ScanState | null) => { scan = value; },
  } as unknown as SpecLookupContext;
  ctx.targets = () => lookupTargets(ctx);
  const read = spyOn(coverage, "readAcCoverage");
  try {
    const cold = ctx.targets();
    expect(cold).toHaveLength(150);
    expect(read).not.toHaveBeenCalled();
    expect(ctx.targets()).toBe(cold);
    void cold[0]!.acceptance;
    expect(read).toHaveBeenCalledTimes(1);
    read.mockClear();
    scan!.at = 0;
    const expired = ctx.targets();
    expect(expired).not.toBe(cold);
    expect(read).not.toHaveBeenCalled();
    void expired[149]!.acceptance;
    expect(read).toHaveBeenCalledTimes(1);
  } finally { read.mockRestore(); }
});

test("an empty search distinguishes existing specs from an empty board (AC-4)", async () => {
  const { ask, html } = board(150);
  await ask(specsPages, "/specs?q=missing-query-value");
  expect(html()).toContain(t("en", "list.noSpecMatchesFilter"));
});

test("a new Jobs search excludes a previously opened nonmatching job (AC-4, AC-6)", async () => {
  const { ask, read } = board();
  await ask(jobsPage, "/?rows=1&open=aide%2Fschedule-report&q=missing-query-value");
  expect(read().rows).toEqual([]);
});

for (const count of [1000, 10000]) {
  for (const [route, path] of [[jobsPage, "/"], [specsPages, "/specs"]] as const) {
    for (const limit of [100, 200]) {
      test(`${path} bounds row construction to ${limit} entries among ${count} mixed records (AC-10)`, async () => {
        const { ask, read, html } = board(count, true);
        const headReads = spyOn(heads, "specHeadRow");
        try {
          await ask(route, `${path}?state=all&limit=${limit}${limit === 200 ? "&rows=1" : ""}`);
          expect(Number(html().match(/data-window-loaded="(\d+)"/)?.[1])).toBe(limit);
          expect(read().rows.length).toBeLessThanOrEqual(limit + 1);
          expect(new Set(headReads.mock.calls.map((call) => `${call[0].project}/${call[0].specFolder}`)).size).toBeLessThanOrEqual(limit + 1);
          for (const keys of read().archive) {
            expect(keys).toBeDefined();
            expect(JSON.parse(keys!).length).toBeLessThanOrEqual(limit + 1);
          }
        } finally { headReads.mockRestore(); }
      });
    }
  }
}
