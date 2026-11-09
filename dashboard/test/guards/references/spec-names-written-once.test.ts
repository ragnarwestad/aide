// A spec folder, its branch, the create and schedule keys and the spec's file
// names are written once per language: src/project/spec-names.ts for the
// dashboard, core/scripts/lib/spec-reference.sh for the runner. Anywhere else
// in either, a name written by hand is a second copy that can drift.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, read } from "../source.ts";

const TS_HOME = "src/project/spec-names.ts";
const SCRIPTS = join(ROOT, "..", "core", "scripts");

const FILE_NAMES = ["1-description", "2-analysis", "3-solution", "4-status", "ac-coverage"];
/** A file name, plain or regex-escaped: `4-status.md`, `4-status\.md`, `4-status.json`. */
const FILE_NAME = new RegExp(`(?:${FILE_NAMES.join("|")})\\\\?\\.(?:md|json)`);

const TS_PATTERNS: Array<[string, string, RegExp]> = [
  ["the spec-folder test", "AC-1", /\^\\d\+(?:-|\(-\|\$\)|\(\?=)/],
  ["a spec's branch", "AC-2", /["'`]aide\/(?:["'`]|\$\{)/],
  ["the schedule key", "AC-3", /["'`]schedule-(?:["'`]|\$\{)/],
  ["the provisional create key", "AC-3", /new-\[0-9a-f\]|`new-\$\{/],
  ["a spec file name", "AC-4", FILE_NAME],
];

const BASH_PATTERNS: Array<[string, string, RegExp]> = [
  ["the spec-folder test", "AC-1", /\[0-9\]\+-/],
  ["a spec's branch", "AC-2", /aide\/\$/],
  ["the schedule key", "AC-3", /#schedule-/],
  ["the provisional create key", "AC-3", /new-\[0-9a-f\]/],
  ["a spec file name", "AC-4", FILE_NAME],
];

const tsSources = read("src/**/*.ts").filter(({ file }) => !file.endsWith(".test.ts") && file !== TS_HOME);

/** The runner's own bash — `aide-run-spec` and its parts — without whole comment lines. */
const runnerSources = (): { file: string; text: string }[] => {
  const files = ["aide-run-spec", ...new Bun.Glob("lib/run-spec/**/*.sh").scanSync(SCRIPTS)];
  return files.map((file) => ({
    file,
    text: readFileSync(join(SCRIPTS, file), "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n"),
  }));
};

const offenders = (sources: { file: string; text: string }[], pattern: RegExp): string[] =>
  sources.flatMap(({ file, text }) =>
    text.split("\n").flatMap((line) => (pattern.test(line) ? [`${file}: ${line.trim()}`] : [])),
  );

describe("the names are written by hand nowhere but their definition", () => {
  const runner = runnerSources();

  test("the guard reads the dashboard's sources and the runner", () => {
    expect(tsSources.length).toBeGreaterThan(80);
    expect(runner.some(({ file }) => file === "aide-run-spec")).toBe(true);
    expect(runner.filter(({ file }) => file.startsWith("lib/run-spec/")).length).toBeGreaterThanOrEqual(37);
  });

  for (const [what, ac, pattern] of TS_PATTERNS) {
    test(`no TypeScript source spells ${what} by hand (${ac})`, () => {
      expect(offenders(tsSources, pattern)).toEqual([]);
    });
  }

  for (const [what, ac, pattern] of BASH_PATTERNS) {
    test(`no part of the runner spells ${what} by hand (${ac})`, () => {
      expect(offenders(runner, pattern)).toEqual([]);
    });
  }
});
