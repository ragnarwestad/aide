// A step's commit subject is written and read once in bash
// (core/scripts/lib/spec-reference.sh) and read once in TypeScript
// (parseStepSubject in src/git/workflow-history.ts). Both readers run here
// on one table of subjects, and on what the bash writer writes.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseStepSubject } from "../../../src/git/workflow-history.ts";

const LIB = join(import.meta.dir, "..", "..", "..", "..", "core", "scripts", "lib", "spec-reference.sh");
const FOLDER = "744-x";

type Read = { step: string; model?: string; stopped?: string } | undefined;

/** What bash `aide_read_step_subject` makes of a subject, in the TypeScript reader's shape. */
const bashRead = (subject: string, folder = FOLDER): Read => {
  const run = Bun.spawnSync({
    cmd: [
      "bash", "-c",
      'set -u; source "$1"; aide_read_step_subject "$2" "$3" || exit 1; printf "%s\\n%s\\n%s" "$subject_step" "$subject_model" "$subject_stop"',
      "_", LIB, subject, folder,
    ],
    stdout: "pipe",
  });
  if (run.exitCode !== 0) return undefined;
  const [step, model, stopped] = run.stdout.toString().split("\n");
  return { step: step!, ...(model ? { model } : {}), ...(stopped ? { stopped } : {}) };
};

const bashOut = (script: string, ...args: string[]): string =>
  Bun.spawnSync({ cmd: ["bash", "-c", `set -u; source "$1"; shift; ${script}`, "_", LIB, ...args], stdout: "pipe" }).stdout.toString();

const TABLE: Array<[string, Read]> = [
  ["Run /aide-analyze for 744-x (headless)", { step: "analyze" }],
  ["Run /aide-implement for 744-x (headless) (model: claude opus)", { step: "implement", model: "claude opus" }],
  ["Run /aide-implement for 744-x (headless) (model: codex) (stopped: timeout)", { step: "implement", model: "codex", stopped: "timeout" }],
  ["Run /aide-analyze for 744-x (model: claude claude-opus-5)", { step: "analyze", model: "claude claude-opus-5" }],
  ["Run /aide-archive for 744-x", { step: "archive" }],
  ["Run /aide-analyze for 745-other (headless)", undefined],
  ["Run /aide-analyze for 744-x-y (headless)", undefined],
  ["Merge remote-tracking branch 'origin/aide/744-x'", undefined],
  ["Revert \"Run /aide-analyze for 744-x (headless)\"", undefined],
  ["Run /aide-analyze for 744-x (headless) and more", undefined],
];

describe("the commit subject's readers", () => {
  for (const [subject, want] of TABLE) {
    test(`${JSON.stringify(subject)} reads the same on both sides (AC-2, AC-5)`, () => {
      expect(parseStepSubject(subject, FOLDER)).toEqual(want);
      expect(bashRead(subject)).toEqual(want);
    });
  }
});

describe("the subject bash writes", () => {
  const WRITTEN: Array<[string, string, Read]> = [
    ["analyze", "", { step: "analyze" }],
    ["implement", " (model: claude opus)", { step: "implement", model: "claude opus" }],
    ["archive", " (model: codex gpt-5) (stopped: provider-limit)", { step: "archive", model: "codex gpt-5", stopped: "provider-limit" }],
    ["create", " (stopped: timeout)", { step: "create", stopped: "timeout" }],
  ];

  for (const [step, notes, want] of WRITTEN) {
    test(`a headless ${step}${notes} is read back as that step by both readers (AC-2, AC-5)`, () => {
      const subject = bashOut('aide_step_subject "$1" "$2" "$3"', step, FOLDER, notes);
      expect(subject).toStartWith(bashOut('aide_step_subject_start "$1" "$2"', step, FOLDER));
      expect(parseStepSubject(subject, FOLDER)).toEqual(want);
      expect(bashRead(subject)).toEqual(want);
    });
  }
});
