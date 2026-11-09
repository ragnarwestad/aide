// The run log's stamped line, a step's mark, a step's commit subject, the
// `Workflow steps completed` line and the lookup of a spec's folder are each
// written once per language. Anywhere else in the dashboard or the runner, a
// line built or read by hand is a second copy that can drift from the first.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, read } from "../source.ts";

const SCRIPTS = join(ROOT, "..", "core", "scripts");

/** The core scripts under `globs` (from core/scripts), without whole comment lines. */
const bashSources = (...globs: string[]): { file: string; text: string }[] =>
  [...new Set(globs.flatMap((glob) => [...new Bun.Glob(glob).scanSync(SCRIPTS)]))].sort().map((file) => ({
    file,
    text: readFileSync(join(SCRIPTS, file), "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n"),
  }));

const tsSources = read("src/**/*.ts").filter(({ file }) => !file.endsWith(".test.ts"));
/** `aide-run-spec`, every `aide-*` command beside it, and every library they source. */
const scripts = bashSources("aide-*", "lib/**/*.sh");
/** The runner itself: `aide-run-spec` and its parts, with the spec library it reads names from. */
const runner = bashSources("aide-run-spec", "lib/run-spec/**/*.sh", "lib/spec-reference.sh");

/** `text` less the stretch from the first line matching `from` to the first line after it matching `to`. */
const without = (text: string, from: RegExp, to: RegExp): string => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => from.test(line));
  if (start < 0) return text;
  const end = lines.findIndex((line, i) => i > start && to.test(line));
  return [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end + 1)].join("\n");
};

const offenders = (sources: { file: string; text: string }[], pattern: RegExp, homes: string[]): string[] =>
  sources
    .filter(({ file }) => !homes.includes(file))
    .flatMap(({ file, text }) => text.split("\n").flatMap((line) => (pattern.test(line) ? [`${file}: ${line.trim()}`] : [])));

describe("each fixed line is written by hand nowhere but its definition", () => {
  test("the guard reads the dashboard's sources and the runner", () => {
    expect(tsSources.length).toBeGreaterThan(80);
    expect(scripts.some(({ file }) => file === "aide-run-spec")).toBe(true);
    expect(scripts.some(({ file }) => file === "lib/spec-state.sh")).toBe(true);
    expect(runner.filter(({ file }) => file.startsWith("lib/run-spec/")).length).toBeGreaterThanOrEqual(37);
  });

  test("the run-log line is built only in run-log.sh and step-log.ts (AC-1)", () => {
    expect(offenders(tsSources, /`aide-run-spec \$\{/, ["src/queue/parse-stream/step-log.ts"])).toEqual([]);
    expect(offenders(scripts, /printf ['"]aide-run-spec /, ["lib/run-spec/setup/run-log.sh"])).toEqual([]);
  });

  test("a step mark is built only in run-log.sh and step-marks.ts (AC-1)", () => {
    expect(offenders(tsSources, /["'`]--- Step /, ["src/queue/parse-stream/step-marks.ts"])).toEqual([]);
    expect(offenders(scripts, /["']--- Step /, ["lib/run-spec/setup/run-log.sh"])).toEqual([]);
  });

  test("the commit subject is written and read only in spec-reference.sh and workflow-history.ts (AC-2)", () => {
    expect(offenders(tsSources, /Run \/aide-/, ["src/git/workflow-history.ts"])).toEqual([]);
    expect(offenders(scripts, /Run \/aide-/, ["lib/spec-reference.sh"])).toEqual([]);
  });

  test("the Workflow steps line is read only in workflow_steps_in (AC-3)", () => {
    const sources = scripts.map(({ file, text }) => ({
      file,
      text:
        file === "lib/spec-state.sh"
          ? without(text, /^workflow_steps_in\(\)/, /^}/)
          : file === "lib/spec-transitions.sh"
            ? without(text, /^\s*workflow-line\)/, /^\s*;;\s*$/)
            : text,
    }));
    expect(offenders(sources, /workflow steps completed:/i, [])).toEqual([]);
  });

  test("a spec's folder is matched as <id>-* only in aide_find_spec_folder (AC-4)", () => {
    const sources = runner.map(({ file, text }) => ({
      file,
      text: file === "lib/spec-reference.sh" ? without(text, /^aide_find_spec_folder\(\)/, /^}/) : text,
    }));
    expect(offenders(sources, /"\$\{?\w+\}?"-\*/, [])).toEqual([]);
  });
});
