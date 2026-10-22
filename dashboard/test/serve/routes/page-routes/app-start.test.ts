// Where the installed app is sent when it is launched: the Running tab when
// the tab has a row, the bare Specs list when it has none. The rows are counted
// by the rule the tab draws its empty sentence by, so a test here asks the
// served board, not the renderer.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { t } from "../../../../src/i18n";
import type { FailedCreate } from "../../../../src/push/failed-creates.ts";
import { setupQueueRoutesHarness } from "../../../queue-routes/fixtures.ts";

const { harness } = setupQueueRoutesHarness("aide-app-start-");
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

/** One Active spec by default; `queueProjects: []` is a board with none. */
const board = (jobs: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) =>
  harness.start({
    extra: { queueProjects: ["aide"], ...extra },
    ...(jobs.length ? { queueMirror: JSON.stringify(jobs) } : {}),
  });

/** The address the served manifest launches the app on. */
const startUrl = async (base: string): Promise<string> =>
  ((await (await fetch(`${base}/manifest.webmanifest`)).json()) as { start_url: string }).start_url;

/** Where a launch is sent: the status and `location` of the answer, not followed. */
const launch = async (base: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${await startUrl(base)}`, { redirect: "manual", headers });
  return { status: res.status, location: res.headers.get("location") };
};

describe("the installed app's start address sends it to the tab or the list", () => {
  test("a board with an Active spec opens the Running tab (AC-1)", async () => {
    const { base } = board();
    expect(await launch(base)).toEqual({ status: 302, location: "/" });
  });

  test("a job row alone counts as a row: a Close running opens the Running tab (AC-1)", async () => {
    const { base } = board([job({ id: "close", specFolder: "82-no-job", steps: ["close"] })], { queueProjects: [] });
    expect(await launch(base)).toEqual({ status: 302, location: "/" });
  });

  test("rows are counted before the tab's own view hides them (AC-1)", async () => {
    const { base } = board();
    const hidden = await fetch(`${base}/?q=nothing-matches`, { redirect: "manual" });
    expect(await hidden.text()).toContain(t("en", "jobs.noRowMatchesFilter"));
    const cookie = hidden.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .find((c) => c.startsWith("aide_jobs_view_"));
    expect(cookie).toBeDefined();
    expect(await launch(base, { cookie: cookie! })).toEqual({ status: 302, location: "/" });
  });

  test("a board with no row opens the Specs list bare, so its cookies decide the view (AC-2)", async () => {
    const { base } = board([], { queueProjects: [] });
    expect(await launch(base)).toEqual({ status: 302, location: "/specs" });
  });

  test("a failed create's message is not a row: the app opens the Specs list (AC-2)", async () => {
    const record: FailedCreate = {
      id: "cr", project: "aide", title: "A spec that never was", description: "text",
      reason: { key: "runner.serverRestarted", values: { button: "Create" } },
      failedAt: "2026-10-08T10:05:00.000Z",
    };
    const dir = mkdtempSync(join(tmpdir(), "aide-app-start-failed-"));
    tmp.push(dir);
    const failedCreatesPath = join(dir, "failed-creates.json");
    writeFileSync(failedCreatesPath, JSON.stringify([record]));
    const failed = job({ id: "cr", state: "failed", specFolder: "new-0a1b2c3d", steps: ["create"] });
    const { base } = board([failed], { queueProjects: [], failedCreatesPath });
    expect(await launch(base)).toEqual({ status: 302, location: "/specs" });
  });
});
