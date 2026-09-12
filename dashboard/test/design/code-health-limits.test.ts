// Spec 443, AC-5/AC-6/AC-7: enforces the four code-health limits named in
// dashboard/CLAUDE.md's "Code health" section — a source file's line
// count, a test file's line count, a directory's file count, and test/
// mirroring src/'s top-level structure. Picked up by `bun test`'s own
// discovery with no separate registration (AC-6).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFilesUnder(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

function lineCount(file: string): number {
  // Matches `wc -l`: counts newline characters, not array elements — a
  // file ending in a trailing newline must not count one line too many.
  return readFileSync(file, "utf-8").replace(/\n$/, "").split("\n").length;
}

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "src");
const TEST = join(ROOT, "test");

// Rule 1: files already over the 500-line limit, keyed by their path
// relative to the dashboard root, with the line count measured when
// this list was written. A file that grows past that count fails; one
// that shrinks below 500 has its entry removed instead.
const OVER_LINE_LIMIT: Record<string, number> = {
  "src/queue/runner.ts": 596,
  "src/queue/store.ts": 584,
  "src/git/branch-merge.ts": 581,
  "src/render/ui/shell.ts": 530,
  "src/render/pages/queue-list/data-model/types.ts": 510,
};

// src/i18n/messages.ts is exempt by filename alone (see EXEMPT_BY_FILENAME
// below) and is deliberately not duplicated here.
const EXEMPT_BY_FILENAME = ["messages.ts", "en.ts", "nb.ts"];

// Rule 3: directories already over the 15-.ts-file limit, keyed by their
// path relative to the dashboard root, with the count measured when this
// list was written.
const OVER_FILE_COUNT: Record<string, number> = {
  "src/serve": 24,
  "test/render/pages": 25,
  "test/queue-client": 21,
  "test/design": 23,
  "test/project": 20,
  "test/serve": 20,
};

// Rule 4: top-level test/ directories that group tests by feature rather
// than by a matching src/ directory name — a deliberate, existing
// pattern, not drift to clean up.
const TEST_ONLY_TOP_LEVEL_DIRS = [
  "archived", "deploy", "design", "e2e", "fixtures", "guards",
  "handle-queue", "helpers", "queue-detail", "queue-routes", "round",
  "spec-page",
];

function relPath(file: string): string {
  return file.slice(ROOT.length + 1);
}

describe("dashboard code health (spec 443)", () => {
  const srcFiles = tsFilesUnder(SRC);
  const testFiles = tsFilesUnder(TEST);

  test("the scan visits at least 200 files under src and 300 under test", () => {
    expect(srcFiles.length).toBeGreaterThanOrEqual(200);
    expect(testFiles.length).toBeGreaterThanOrEqual(300);
  });

  test("every source file under src is at most 500 lines, unless exempt (AC-7)", () => {
    const bad: string[] = [];
    for (const file of srcFiles) {
      const rel = relPath(file);
      if (EXEMPT_BY_FILENAME.includes(basename(file))) continue;
      const lines = lineCount(file);
      const recorded = OVER_LINE_LIMIT[rel];
      if (recorded !== undefined) {
        if (lines !== recorded) bad.push(`${rel}: ${lines} lines (recorded ${recorded} — update or remove the exception)`);
        continue;
      }
      if (lines > 500) bad.push(`${rel}: ${lines} lines`);
    }
    expect(bad).toEqual([]);
  });

  test("every test file under test is at most 800 lines", () => {
    const bad: string[] = [];
    for (const file of testFiles) {
      const lines = lineCount(file);
      if (lines > 800) bad.push(`${relPath(file)}: ${lines} lines`);
    }
    expect(bad).toEqual([]);
  });

  test("every directory holds at most 15 .ts files directly inside it, unless exempt (AC-7)", () => {
    const dirs = new Set<string>();
    for (const file of [...srcFiles, ...testFiles]) {
      dirs.add(join(file, ".."));
    }
    const bad: string[] = [];
    for (const dir of dirs) {
      const count = readdirSync(dir).filter((name) => name.endsWith(".ts") && statSync(join(dir, name)).isFile()).length;
      const rel = relPath(dir);
      const recorded = OVER_FILE_COUNT[rel];
      if (recorded !== undefined) {
        if (count !== recorded) bad.push(`${rel}: ${count} files (recorded ${recorded} — update or remove the exception)`);
        continue;
      }
      if (count > 15) bad.push(`${rel}: ${count} files`);
    }
    expect(bad).toEqual([]);
  });

  test("every top-level test/ directory matches a src/ directory name or is a named exception", () => {
    const srcTopLevel = new Set(
      readdirSync(SRC).filter((name) => statSync(join(SRC, name)).isDirectory()),
    );
    const testTopLevel = readdirSync(TEST).filter((name) => statSync(join(TEST, name)).isDirectory());
    const bad = testTopLevel.filter(
      (name) => !srcTopLevel.has(name) && !TEST_ONLY_TOP_LEVEL_DIRS.includes(name),
    );
    expect(bad).toEqual([]);
  });
});
