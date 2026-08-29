// The project-admin CRUD for schedule entries (spec 276): validation,
// create, update (including a rename) and the enabled toggle. Modeled
// on update-settings.ts's changed-only-write, refuse-before-write shape.
// Acceptance criteria 5, 6, 7, 8, 17 — unit level (Phase 4 proves the
// same rules over HTTP).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createScheduleEntry,
  deleteScheduleEntry,
  scheduleEntryError,
  setScheduleEnabled,
  updateScheduleEntry,
} from "../../../src/project/project-admin.ts";
import { parseManifest } from "../../../src/project/parse-manifest.ts";

const dirs: string[] = [];
function projectDir(manifestText?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-schedule-admin-"));
  dirs.push(dir);
  writeFileSync(join(dir, "docs-nightly.md"), "# nightly\n");
  mkdirSync(join(dir, ".aide"), { recursive: true });
  writeFileSync(join(dir, ".aide", "project.yaml"), manifestText ?? "name: alpha\n");
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const manifestOf = (dir: string) => join(dir, ".aide", "project.yaml");
const schedule = (dir: string) => {
  const result = parseManifest(readFileSync(manifestOf(dir), "utf-8"));
  if (!result.ok) throw new Error(result.error);
  return result.data.schedule ?? [];
};

describe("scheduleEntryError (acceptance criteria 5, 6, 7)", () => {
  test("a duplicate name is refused (criterion 5)", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const error = scheduleEntryError(dir, { name: "nightly", cron: "0 4 * * *", prompt: "docs-nightly.md" }, schedule(dir));
    expect(error).toContain("nightly");
  });

  test("a missing prompt path is refused, naming the missing path (criterion 6)", () => {
    const dir = projectDir();
    const error = scheduleEntryError(dir, { name: "nightly", cron: "0 3 * * *", prompt: "does-not-exist.md" }, []);
    expect(error).toContain("does-not-exist.md");
  });

  test("a prompt path escaping the project root is refused", () => {
    const dir = projectDir();
    const error = scheduleEntryError(dir, { name: "nightly", cron: "0 3 * * *", prompt: "../outside.md" }, []);
    expect(error).toBeTruthy();
  });

  test("an unparseable cron is refused (criterion 7)", () => {
    const dir = projectDir();
    const error = scheduleEntryError(dir, { name: "nightly", cron: "not-a-cron", prompt: "docs-nightly.md" }, []);
    expect(error).toBeTruthy();
  });

  test("a valid request has no error", () => {
    const dir = projectDir();
    const error = scheduleEntryError(dir, { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" }, []);
    expect(error).toBeNull();
  });

  test("editing an entry under its own unchanged name is not a collision", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const error = scheduleEntryError(
      dir, { name: "nightly", cron: "0 4 * * *", prompt: "docs-nightly.md" }, schedule(dir), "nightly",
    );
    expect(error).toBeNull();
  });
});

describe("createScheduleEntry", () => {
  test("a duplicate name is refused before any file is written (criterion 5)", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const before = readFileSync(manifestOf(dir), "utf-8");
    const result = createScheduleEntry(dir, { name: "nightly", cron: "0 4 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
    expect(readFileSync(manifestOf(dir), "utf-8")).toBe(before);
  });

  test("a valid entry is appended, enabled by default", () => {
    const dir = projectDir();
    const result = createScheduleEntry(dir, { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true },
    ]);
  });
});

describe("updateScheduleEntry (including a rename, acceptance criterion 17)", () => {
  test("editing cron leaves the name and every other entry untouched", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs-nightly.md\n",
    );
    const result = updateScheduleEntry(dir, "nightly", { name: "nightly", cron: "0 5 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "nightly", cron: "0 5 * * *", prompt: "docs-nightly.md", enabled: true },
      { name: "weekly", cron: "0 4 * * 0", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  test("renaming an entry is accepted and the entry keeps its position (criterion 17)", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const result = updateScheduleEntry(dir, "nightly", { name: "nightly-2", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "nightly-2", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  test("renaming to a name already used by ANOTHER entry is refused", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs-nightly.md\n",
    );
    const result = updateScheduleEntry(dir, "nightly", { name: "weekly", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
  });

  test("editing a nonexistent entry is refused", () => {
    const dir = projectDir();
    const result = updateScheduleEntry(dir, "ghost", { name: "ghost", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
  });
});

describe("setScheduleEnabled (acceptance criterion 8 — no confirm field required)", () => {
  test("flips enabled to false with only the enabled field", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const result = setScheduleEnabled(dir, "nightly", false);
    expect(result.ok).toBe(true);
    expect(schedule(dir)[0]!.enabled).toBe(false);
  });

  test("flips enabled back to true", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n    enabled: false\n",
    );
    const result = setScheduleEnabled(dir, "nightly", true);
    expect(result.ok).toBe(true);
    expect(schedule(dir)[0]!.enabled).toBe(true);
  });

  test("setting the same value is a no-op write (changed-only)", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const before = readFileSync(manifestOf(dir), "utf-8");
    const result = setScheduleEnabled(dir, "nightly", true);
    expect(result.ok).toBe(true);
    expect(readFileSync(manifestOf(dir), "utf-8")).toBe(before);
  });

  test("toggling a nonexistent entry is refused", () => {
    const dir = projectDir();
    const result = setScheduleEnabled(dir, "ghost", false);
    expect(result.ok).toBe(false);
  });
});

describe("deleteScheduleEntry (spec 277, acceptance criteria 1, 3, 5)", () => {
  test("deletes the named entry and leaves the others (criterion 1)", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs-nightly.md\n",
    );
    const result = deleteScheduleEntry(dir, "nightly");
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "weekly", cron: "0 4 * * 0", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  test("deleting the only entry removes the schedule key entirely (criterion 3)", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const result = deleteScheduleEntry(dir, "nightly");
    expect(result.ok).toBe(true);
    expect(readFileSync(manifestOf(dir), "utf-8")).not.toContain("schedule:");
  });

  test("deleting an unknown name is refused and writes nothing (criterion 5)", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const before = readFileSync(manifestOf(dir), "utf-8");
    const result = deleteScheduleEntry(dir, "ghost");
    expect(result.ok).toBe(false);
    expect(readFileSync(manifestOf(dir), "utf-8")).toBe(before);
  });
});
