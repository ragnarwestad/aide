// The test board's Run control starts its round over from nothing
// (self-run.ts), and the rows the last round left would read as history
// the new run never had: `dropProject()` takes every job of one project
// out of the store, and only that project's.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../src/queue/queue.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};

const resolve = (project: string) =>
  project === "aide-test"
    ? { specFolders: ["01-add-the-first-fact", "02-add-a-second-fact"] }
    : project === "aide"
      ? { specFolders: ["81-queue-and-runner"] }
      : null;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-drop-project-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("QueueStore.dropProject", () => {
  test("drops every job of the project, keeps the others, and mirrors the result", () => {
    const mirror = join(dir, "queue.json");
    let changes = 0;
    const store = new QueueStore({ defaults: DEFAULTS, resolve, mirrorPath: mirror, onChange: () => (changes += 1) });
    for (const specFolder of ["01-add-the-first-fact", "02-add-a-second-fact"]) {
      const made = store.enqueue({ project: "aide-test", specFolder, steps: ["analyze"] });
      if (!made.ok) throw new Error(made.error);
    }
    const kept = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!kept.ok) throw new Error(kept.error);
    const before = changes;

    expect(store.dropProject("aide-test")).toBe(2);
    expect(store.list().map((j) => j.project)).toEqual(["aide"]);
    expect(changes).toBe(before + 1);
    expect(existsSync(mirror)).toBe(true);
    const onDisk = JSON.parse(readFileSync(mirror, "utf8")) as { project: string }[];
    expect(onDisk.map((j) => j.project)).toEqual(["aide"]);
  });

  test("a project with no jobs drops nothing and says so", () => {
    let changes = 0;
    const store = new QueueStore({ defaults: DEFAULTS, resolve, onChange: () => (changes += 1) });
    expect(store.dropProject("aide-test")).toBe(0);
    expect(changes).toBe(0);
  });
});
