// The merge into main is the last step of every skill whose work lands,
// and the phase is not finished until it is: the landing marks that step
// in the step's own run log, started and then done or stopped, in the
// skill's own words.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { landArchivedSpec, landStepBranch } from "../../../../src/serve/land-branch";
import { MERGE_STEP, MERGE_TITLE } from "../../../../src/serve/land-branch/steps.ts";
import { stepMarkLine } from "../../../../src/queue/parse-stream/step-marks.ts";
import { retryArchiveLanding } from "../../../../src/serve/land-branch/retry";
import type { Job } from "../../../../src/queue/queue.ts";

/** A merge mark for `step` with `ending`, as the landing writes it. */
const mergeMark = (step: keyof typeof MERGE_STEP, ending: string): string => stepMarkLine(MERGE_STEP[step]!, MERGE_TITLE, ending);
import { BRANCH, landCtx, landingGit, REPOS } from "../landing-fixtures.ts";
import type { Answer } from "../../../helpers/fake-git.ts";

async function archive(over: Record<string, Answer> = {}, step: "archive" | "analyze" = "archive", resumed = false): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "archive-merge-step-"));
  const streamFile = join(dir, `job.${step}.stream.jsonl`);
  writeFileSync(streamFile, "");
  // As the landing is handed it: the step that just ran is the job's own
  // `streamFile`, and its result is not stored yet — the results end on
  // the step before, or are empty (a job queued for archive alone). A
  // landing resumed at boot has the result and no pointer.
  const job = resumed
    ? { id: "j", project: "aide", specFolder: "150-spec", results: [{ step, streamFile }] }
    : { id: "j", project: "aide", specFolder: "150-spec", streamFile, results: [] };
  const { ctx } = landCtx(landingGit(over).run, {
    queue: {
      get: () => job,
      list: () => [],
      update: () => {},
      transition: () => ({ ok: true }),
      branchesFor: () => REPOS,
      pullRequestFor: () => ({}),
    },
    testServers: { store: { get: () => undefined } },
  });
  const c = ctx as unknown as Parameters<typeof landArchivedSpec>[0];
  const j = job as unknown as Parameters<typeof landArchivedSpec>[1];
  if (step === "archive") await landArchivedSpec(c, j, { branch: BRANCH, branchUrls: REPOS });
  else await landStepBranch(c, j, step, { branch: BRANCH, branchUrls: REPOS });
  return readFileSync(join(dir, `job.${step}.run.log`), "utf-8").trim().split("\n");
}

const marks = (lines: string[], step: keyof typeof MERGE_STEP = "archive") =>
  lines.map((l) => l.replace(/^aide-run-spec \S+ \+\d+s /, "")).filter((l) => l.includes(mergeMark(step, "")));

describe("the archive's merge is its last step in the log", () => {
  test("a merge that went through is started, then done", async () => {
    expect(marks(await archive())).toEqual([mergeMark("archive", "started"), mergeMark("archive", "done")]);
  });

  test("a merge that did not go through is stopped, as an error, saying the archive is not finished", async () => {
    const got = marks(await archive({ "merge -q --ff-only": { code: 1 }, "merge -q --no-edit": { code: 1 } }));
    expect(got[0]).toBe(mergeMark("archive", "started"));
    expect(got[1]).toStartWith(`error: ${mergeMark("archive", "stopped: ")}`);
    expect(got[1]).toEndWith("the archive is not finished");
    expect(got).toHaveLength(2);
  });

  test("a landing resumed at boot marks the step it lands too", async () => {
    expect(marks(await archive({}, "archive", true))).toEqual([mergeMark("archive", "started"), mergeMark("archive", "done")]);
  });

  test("an analysis merged into main is marked the same way, as analyze's own last step", async () => {
    expect(marks(await archive({}, "analyze"), "analyze")).toEqual([mergeMark("analyze", "started"), mergeMark("analyze", "done")]);
  });

  test("each step's words are its skill's own last heading", () => {
    for (const [step, place] of Object.entries(MERGE_STEP)) {
      const skill = readFileSync(join(import.meta.dir, `../../../../../core/skills/aide-${step}/SKILL.md`), "utf-8");
      const last = [...skill.matchAll(/^### (Step (\d+) of (\d+): .+)$/gm)].at(-1)!;
      expect(last[2]).toBe(last[3]);
      expect(last[1], step).toBe(`Step ${place}: ${MERGE_TITLE}`);
    }
  });
});

test("a red archive landing spends one allowance and a repeated failure does not queue a third run (AC-5, AC-9)", () => {
  const job = { id: "j", state: "done", retry: undefined, results: [{ step: "archive", repos: [] }] } as unknown as Job;
  const queue = {
    get: () => job,
    transition: (_id: string, _event: string, patch: Partial<Job>) => {
      Object.assign(job, patch, { state: "queued" });
      return { ok: true as const, job };
    },
  };
  expect(retryArchiveLanding(queue as never, job.id, "archive", true, { key: "landing.testsRedOnMergeFallback", values: { base: "main" } }, "failed test"))
    .toBe(true);
  expect(job.retry).toMatchObject({ action: "archive", attempts: 2, previousAttempt: { terminalReason: "archive-tests-red" } });
  job.state = "done";
  expect(retryArchiveLanding(queue as never, job.id, "archive", true, "red again", "failed test")).toBe(false);
});
