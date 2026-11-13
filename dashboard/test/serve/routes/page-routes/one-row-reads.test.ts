// What a request for one row asks the server for. The three routes a › asks
// are handed a context made by hand, which records every job a row view was
// built for and the keys every read of the archive was cut to: one row's
// request asks for that row's, and a request for the whole list for all of it.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
function board() {
  const dir = mkdtempSync(join(tmpdir(), "aide-one-row-reads-"));
  dirs.push(dir);
  writeFileSync(join(dir, "queue.json"), JSON.stringify(JOBS));
  const queue = new QueueStore({
    mirrorPath: join(dir, "queue.json"),
    defaults: { timeoutSec: { default: 600 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => null,
  });
  const targets: SpecTarget[] = ["01-one", "02-two", "03-three"].map((specFolder) => ({ project: "aide", specFolder }));
  const rowsFor: string[] = [];
  const archive: (string[] | undefined)[] = [];
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
    readScan: () => ({ archived: [] }),
    specRef: () => undefined,
    specDir: (_project: string, folder: string) => `/nowhere/${folder}`,
    pdfToolAvailable: false,
    jobRow: async (j: ReturnType<QueueStore["list"]>[number]) => {
      rowsFor.push(j.id);
      return { ...j, spentUsd: 0, timeoutSec: 600 } as unknown as QueueRowView;
    },
    archivedSpecRows: (_state: string | undefined, only?: ReadonlySet<string>) => {
      archive.push(only ? [...only] : undefined);
      return [];
    },
    specPageView: async (project: string, specFolder: string) => specView({ project, specFolder }),
  } as unknown as RoutesContext;

  const ask = async (route: typeof jobsPage, address: string): Promise<Response> => {
    rowsFor.length = 0;
    archive.length = 0;
    const url = new URL(`http://board.test${address}`);
    const res = await route(ctx, new Request(url), url, url.pathname);
    if (!res) throw new Error(`${address} is not this route's`);
    await res.text();
    return res;
  };
  /** What the last request read: the jobs it built a row view for, and the cuts of its archive reads. */
  const read = () => ({ rows: [...new Set(rowsFor)].sort(), archive: [...new Set(archive.map((keys) => JSON.stringify(keys)))] });
  return { ask, read };
}

const cutTo = (...keys: string[]) => [JSON.stringify(keys)];
const WHOLE_ARCHIVE = [JSON.stringify(undefined)];

describe("the Jobs tab's route", () => {
  test("one spec's row builds that spec's jobs and reads the archive for it alone (AC-1)", async () => {
    const { ask, read } = board();
    expect((await ask(jobsPage, `/?rows=1&only=${TWO}`)).status).toBe(200);
    expect(read()).toEqual({ rows: ["a2", "i2"], archive: cutTo(TWO) });
  });

  test("`only` without `rows`, and the app's start address, build the whole view (AC-1)", async () => {
    const { ask, read } = board();
    await ask(jobsPage, `/?only=${TWO}`);
    expect(read()).toEqual({ rows: EVERY_JOB, archive: WHOLE_ARCHIVE });
    expect((await ask(jobsPage, `/app?rows=1&only=${TWO}`)).status).toBe(302);
    expect(read()).toEqual({ rows: EVERY_JOB, archive: WHOLE_ARCHIVE });
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

  test("the rows of the whole list build every listed job and read the archive whole (AC-3)", async () => {
    const { ask, read } = board();
    await ask(specsPages, "/specs?rows=1");
    expect(read()).toEqual({ rows: SPEC_JOBS, archive: WHOLE_ARCHIVE });
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

  test("the rows of the whole list build every listed job and read the archive whole (AC-4)", async () => {
    const { ask, read } = board();
    await ask(specPageRoutes, "/specs/aide/02-two?rows=1");
    expect(read()).toEqual({ rows: SPEC_JOBS, archive: WHOLE_ARCHIVE });
  });
});
