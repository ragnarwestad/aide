// The manifest's `schedule:` list-block writer (spec 276). Unlike
// `upsertManifestScalar`, this writes a LIST-shaped key — find the
// `schedule:` span, replace it whole, leave every other line untouched.
// Acceptance criteria 3, 4.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeScheduleList } from "../../../src/project/project-admin.ts";
import { parseManifest } from "../../../src/project/parse-manifest.ts";
import type { ScheduleEntry } from "../../../src/project/parse-manifest.ts";

const dirs: string[] = [];
const manifest = (text?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "aide-schedule-io-"));
  dirs.push(dir);
  const file = join(dir, "project.yaml");
  if (text !== undefined) writeFileSync(file, text);
  return file;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const NIGHTLY: ScheduleEntry = { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true };
const WEEKLY: ScheduleEntry = { name: "weekly", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true };

describe("writeScheduleList (acceptance criteria 3, 4)", () => {
  test("appends the block when the manifest has no schedule: key yet", () => {
    const file = manifest("name: alpha\ndescription: the first one\n");
    writeScheduleList(file, [NIGHTLY]);
    const result = parseManifest(readFileSync(file, "utf-8"));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toEqual([NIGHTLY]);
  });

  test("replaces an existing schedule: span with a new list of entries", () => {
    const file = manifest(
      "name: alpha\nschedule:\n  - name: old\n    cron: \"0 1 * * *\"\n    prompt: docs/old.md\n",
    );
    writeScheduleList(file, [NIGHTLY, WEEKLY]);
    const result = parseManifest(readFileSync(file, "utf-8"));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toEqual([NIGHTLY, WEEKLY]);
  });

  test("editing one entry by name leaves every other entry untouched (acceptance criterion 4)", () => {
    const file = manifest(
      "name: alpha\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs/weekly.md\n",
    );
    const before = parseManifest(readFileSync(file, "utf-8"));
    if (!before.ok) throw new Error(before.error);
    const updated = before.data.schedule!.map((e) => (e.name === "nightly" ? { ...e, cron: "0 5 * * *" } : e));
    writeScheduleList(file, updated);
    const after = parseManifest(readFileSync(file, "utf-8"));
    if (!after.ok) throw new Error(after.error);
    expect(after.data.schedule).toEqual([
      { name: "nightly", cron: "0 5 * * *", prompt: "docs/nightly.md", enabled: true },
      { name: "weekly", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true },
    ]);
  });

  test("writing an empty list removes the schedule: key entirely", () => {
    const file = manifest(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n",
    );
    writeScheduleList(file, []);
    const result = parseManifest(readFileSync(file, "utf-8"));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toBeUndefined();
    expect(readFileSync(file, "utf-8")).toBe("name: alpha\n");
  });

  test("an entry with enabled: false round-trips, and an enabled entry never gains an enabled: line", () => {
    const file = manifest("name: alpha\n");
    writeScheduleList(file, [{ ...NIGHTLY, enabled: false }]);
    const text = readFileSync(file, "utf-8");
    expect(text).toContain("enabled: false");
    const result = parseManifest(text);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toEqual([{ ...NIGHTLY, enabled: false }]);

    const file2 = manifest("name: alpha\n");
    writeScheduleList(file2, [NIGHTLY]);
    expect(readFileSync(file2, "utf-8")).not.toContain("enabled");
  });

  // Criterion 3: every other line, including comments and unrelated
  // keys, is byte-identical to the input.
  test("every line outside the schedule: span is byte-identical to the input", () => {
    const before =
      "# .aide/project.yaml — the project's identity card.\n" +
      "name: alpha\n" +
      "stack:\n" +
      "  frontend: TypeScript/Vite\n" +
      "schedule:\n" +
      "  - name: old\n    cron: \"0 1 * * *\"\n    prompt: docs/old.md\n" +
      "docs:\n" +
      "  - README.md\n";
    const file = manifest(before);
    writeScheduleList(file, [NIGHTLY]);
    const after = readFileSync(file, "utf-8");
    const expected =
      "# .aide/project.yaml — the project's identity card.\n" +
      "name: alpha\n" +
      "stack:\n" +
      "  frontend: TypeScript/Vite\n" +
      "schedule:\n" +
      "  - name: \"nightly\"\n    cron: \"0 3 * * *\"\n    prompt: \"docs/nightly.md\"\n" +
      "docs:\n" +
      "  - README.md\n";
    expect(after).toBe(expected);
  });

  test("throws rather than write when the intended entries would not reparse (guard)", () => {
    // A name containing a double quote would break the always-quoted
    // serialization; the write-time guard must catch it before disk.
    const file = manifest("name: alpha\n");
    expect(() => writeScheduleList(file, [{ ...NIGHTLY, name: 'bad"name' }])).toThrow();
  });
});
