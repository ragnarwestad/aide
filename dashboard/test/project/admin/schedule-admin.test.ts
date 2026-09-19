// The project-admin CRUD for schedule entries: validation, create, update
// (including a rename), delete and the enabled toggle, over the schedule
// store (the `schedules` key of the queue config file). A save writes that
// file and does nothing in git. Unit level; the routes suite proves the
// same rules over HTTP.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createScheduleEntry,
  deleteScheduleEntry,
  scheduleEntryError,
  setScheduleEnabled,
  updateScheduleEntry,
} from "../../../src/project/project-admin";
import type { ScheduleEntry } from "../../../src/queue/schedule.ts";
import { createScheduleStore } from "../../../src/queue/schedule-store.ts";

const dirs: string[] = [];
const PROJECT = "alpha";

/** A project checkout holding the prompt file, and the queue config file
 *  a store reads, seeded with `entries` under `alpha`. */
function setup(entries: Partial<ScheduleEntry>[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "aide-schedule-admin-"));
  dirs.push(dir);
  writeFileSync(join(dir, "docs-nightly.md"), "# nightly\n");
  const file = join(dir, "queue-config.json");
  if (entries.length) {
    writeFileSync(file, JSON.stringify({
      schedules: { [PROJECT]: entries.map((e) => ({ cron: "0 3 * * *", prompt: "docs-nightly.md", ...e })) },
    }));
  }
  const store = createScheduleStore(file);
  return { dir, file, store, stored: () => store.list(PROJECT) };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// `since` is `new Date().toISOString()` at call time, so no test can
// hard-code it — only bracket it between a `before`/`after` taken around
// the call.
function expectFreshSince(since: string | undefined, before: number, after: number): void {
  expect(since).toBeDefined();
  const parsed = Date.parse(since!);
  expect(parsed).toBeGreaterThanOrEqual(before);
  expect(parsed).toBeLessThanOrEqual(after);
}

const req = (over: Record<string, string> = {}) => ({
  name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", ...over,
});

describe("scheduleEntryError", () => {
  test("a duplicate name is refused", () => {
    const { dir, stored } = setup([{ name: "nightly" }]);
    expect(scheduleEntryError(dir, req({ cron: "0 4 * * *" }), stored())).toContain("nightly");
  });

  test("a missing prompt path is refused, naming the missing path", () => {
    const { dir } = setup();
    expect(scheduleEntryError(dir, req({ prompt: "does-not-exist.md" }), [])).toContain("does-not-exist.md");
  });

  test("a prompt path escaping the project root is refused", () => {
    const { dir } = setup();
    expect(scheduleEntryError(dir, req({ prompt: "../outside.md" }), [])).toBeTruthy();
  });

  test("an unparseable cron is refused", () => {
    const { dir } = setup();
    expect(scheduleEntryError(dir, req({ cron: "not-a-cron" }), [])).toBeTruthy();
  });

  test("a valid request has no error", () => {
    const { dir } = setup();
    expect(scheduleEntryError(dir, req(), [])).toBeNull();
  });

  test("editing an entry under its own unchanged name is not a collision", () => {
    const { dir, stored } = setup([{ name: "nightly" }]);
    expect(scheduleEntryError(dir, req({ cron: "0 4 * * *" }), stored(), "nightly")).toBeNull();
  });
});

describe("createScheduleEntry", () => {
  test("a valid entry is appended, enabled by default, and read back from the store", () => {
    const { dir, store, stored } = setup([{ name: "existing" }]);
    const before = Date.now();
    const result = createScheduleEntry(store, PROJECT, dir, req());
    expect(result).toEqual({ ok: true });
    expect(stored().map((e) => e.name)).toEqual(["existing", "nightly"]);
    expect(stored()[1]!.enabled).toBe(true);
    expectFreshSince(stored()[1]!.since, before, Date.now());
  });

  test("a duplicate name is refused and the file is untouched", () => {
    const { dir, file, store } = setup([{ name: "nightly" }]);
    const bytes = readFileSync(file, "utf-8");
    const result = createScheduleEntry(store, PROJECT, dir, req());
    expect(result.ok).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe(bytes);
  });

  test("the picked model is stored on the entry", () => {
    const { dir, store, stored } = setup();
    createScheduleEntry(store, PROJECT, dir, req({ model: "Sonnet" }), ["Sonnet", "Opus"]);
    expect(stored()[0]!.model).toBe("Sonnet");
  });

  test("a model the dashboard does not offer is refused and nothing is written", () => {
    const { dir, file, store } = setup();
    const result = createScheduleEntry(store, PROJECT, dir, req({ model: "Haiku" }), ["Sonnet"]);
    expect(result.ok).toBe(false);
    expect(() => readFileSync(file, "utf-8")).toThrow();
  });

  test("no model at all is accepted — the configuration decides", () => {
    const { dir, store, stored } = setup();
    expect(createScheduleEntry(store, PROJECT, dir, req(), ["Sonnet"]).ok).toBe(true);
    expect(stored()[0]!.model).toBeUndefined();
  });

  test("a store that cannot save refuses with its reason", () => {
    const { dir, store, file } = setup();
    writeFileSync(file, "{ not json");
    const result = createScheduleEntry(store, PROJECT, dir, req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("valid");
  });

  test("a server with no config file refuses", () => {
    const { dir } = setup();
    const result = createScheduleEntry(createScheduleStore(undefined), PROJECT, dir, req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--queue-config");
  });
});

describe("updateScheduleEntry (including a rename)", () => {
  test("editing the model replaces the entry's own pick and keeps everything else", () => {
    const { dir, store, stored } = setup([{ name: "nightly", model: "Sonnet", enabled: false }, { name: "other" }]);
    const before = Date.now();
    const result = updateScheduleEntry(store, PROJECT, dir, "nightly", req({ model: "Opus" }), ["Sonnet", "Opus"]);
    expect(result.ok).toBe(true);
    expect(stored()[0]).toMatchObject({ name: "nightly", model: "Opus", enabled: false });
    expectFreshSince(stored()[0]!.since, before, Date.now());
    expect(stored()[1]!.name).toBe("other");
  });

  test("a model the dashboard does not offer is refused", () => {
    const { dir, store } = setup([{ name: "nightly", model: "Sonnet" }]);
    expect(updateScheduleEntry(store, PROJECT, dir, "nightly", req({ model: "Haiku" }), ["Sonnet"]).ok).toBe(false);
  });

  test("editing cron leaves the name and every other entry untouched", () => {
    const { dir, store, stored } = setup([{ name: "nightly" }, { name: "weekly", cron: "0 4 * * 0" }]);
    updateScheduleEntry(store, PROJECT, dir, "nightly", req({ cron: "0 5 * * *" }));
    expect(stored().map((e) => [e.name, e.cron])).toEqual([["nightly", "0 5 * * *"], ["weekly", "0 4 * * 0"]]);
  });

  test("renaming an entry is accepted and the entry keeps its position, with a fresh since", () => {
    const { dir, store, stored } = setup([{ name: "nightly", since: "2020-01-01T00:00:00.000Z" }, { name: "weekly" }]);
    const before = Date.now();
    const result = updateScheduleEntry(store, PROJECT, dir, "nightly", req({ name: "renamed" }));
    expect(result.ok).toBe(true);
    expect(stored().map((e) => e.name)).toEqual(["renamed", "weekly"]);
    expectFreshSince(stored()[0]!.since, before, Date.now());
  });

  test("renaming to a name already used by ANOTHER entry is refused", () => {
    const { dir, store } = setup([{ name: "nightly" }, { name: "weekly" }]);
    expect(updateScheduleEntry(store, PROJECT, dir, "nightly", req({ name: "weekly" })).ok).toBe(false);
  });

  test("editing a nonexistent entry is refused", () => {
    const { dir, store } = setup([{ name: "nightly" }]);
    const result = updateScheduleEntry(store, PROJECT, dir, "ghost", req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ghost");
  });
});

describe("setScheduleEnabled", () => {
  test("flips enabled to false, and back to true", () => {
    const { store, stored } = setup([{ name: "nightly" }]);
    expect(setScheduleEnabled(store, PROJECT, "nightly", false).ok).toBe(true);
    expect(stored()[0]!.enabled).toBe(false);
    expect(setScheduleEnabled(store, PROJECT, "nightly", true).ok).toBe(true);
    expect(stored()[0]!.enabled).toBe(true);
  });

  test("setting the same value writes nothing", () => {
    const { store, file } = setup([{ name: "nightly" }]);
    const bytes = readFileSync(file, "utf-8");
    expect(setScheduleEnabled(store, PROJECT, "nightly", true).ok).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe(bytes);
  });

  test("toggling a nonexistent entry is refused", () => {
    const { store } = setup([{ name: "nightly" }]);
    expect(setScheduleEnabled(store, PROJECT, "ghost", false).ok).toBe(false);
  });
});

describe("deleteScheduleEntry", () => {
  test("deletes the named entry and leaves the others", () => {
    const { store, stored } = setup([{ name: "nightly" }, { name: "weekly" }]);
    expect(deleteScheduleEntry(store, PROJECT, "nightly").ok).toBe(true);
    expect(stored().map((e) => e.name)).toEqual(["weekly"]);
  });

  test("deleting the only entry removes the project's key entirely", () => {
    const { store, file } = setup([{ name: "nightly" }]);
    deleteScheduleEntry(store, PROJECT, "nightly");
    expect(JSON.parse(readFileSync(file, "utf-8")).schedules).not.toHaveProperty(PROJECT);
  });

  test("deleting an unknown name is refused and writes nothing", () => {
    const { store, file } = setup([{ name: "nightly" }]);
    const bytes = readFileSync(file, "utf-8");
    expect(deleteScheduleEntry(store, PROJECT, "ghost").ok).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe(bytes);
  });
});

describe("a model name that differs from a listed one only in case", () => {
  test("create stores the listed spelling", () => {
    const { dir, store, stored } = setup();
    expect(createScheduleEntry(store, PROJECT, dir, req({ model: "sonnet" }), ["Sonnet", "Opus"]).ok).toBe(true);
    expect(stored()[0]!.model).toBe("Sonnet");
  });

  test("edit stores the listed spelling", () => {
    const { dir, store, stored } = setup([{ name: "nightly" }]);
    expect(updateScheduleEntry(store, PROJECT, dir, "nightly", req({ model: "sonnet" }), ["Sonnet", "Opus"]).ok).toBe(true);
    expect(stored()[0]!.model).toBe("Sonnet");
  });

  test("several case-only matches are refused, naming both", () => {
    const { dir, store } = setup();
    const result = createScheduleEntry(store, PROJECT, dir, req({ model: "sonnet" }), ["Sonnet", "SONNET"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Sonnet");
    expect(result.error).toContain("SONNET");
  });
});
