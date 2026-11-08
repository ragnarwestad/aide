// The merge into main is the last step of every skill whose work lands,
// and the phase is not finished until it is: the landing marks that step
// in the step's own run log, started and then done or stopped, in the
// skill's own words.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { landArchivedSpec, landStepBranch } from "../../../../src/serve/land-branch";
import { MERGE_STEP } from "../../../../src/serve/land-branch/steps.ts";

const ARCHIVE_MERGE_STEP = MERGE_STEP.archive!;
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

const marks = (lines: string[], title = ARCHIVE_MERGE_STEP) => lines.map((l) => l.replace(/^aide-run-spec \S+ \+\d+s /, "")).filter((l) => l.includes(title));

describe("the archive's merge is its last step in the log", () => {
  test("a merge that went through is started, then done", async () => {
    expect(marks(await archive())).toEqual([`${ARCHIVE_MERGE_STEP} — started`, `${ARCHIVE_MERGE_STEP} — done`]);
  });

  test("a merge that did not go through is stopped, as an error, saying the archive is not finished", async () => {
    const got = marks(await archive({ "merge -q --ff-only": { code: 1 }, "merge -q --no-edit": { code: 1 } }));
    expect(got[0]).toBe(`${ARCHIVE_MERGE_STEP} — started`);
    expect(got[1]).toStartWith(`error: ${ARCHIVE_MERGE_STEP} — stopped: `);
    expect(got[1]).toEndWith("the archive is not finished");
    expect(got).toHaveLength(2);
  });

  test("a landing resumed at boot marks the step it lands too", async () => {
    expect(marks(await archive({}, "archive", true))).toEqual([`${ARCHIVE_MERGE_STEP} — started`, `${ARCHIVE_MERGE_STEP} — done`]);
  });

  test("an analysis merged into main is marked the same way, as analyze's own last step", async () => {
    const title = MERGE_STEP.analyze!;
    expect(marks(await archive({}, "analyze"), title)).toEqual([`${title} — started`, `${title} — done`]);
  });

  test("each step's words are its skill's own last heading", () => {
    for (const [step, title] of Object.entries(MERGE_STEP)) {
      const skill = readFileSync(join(import.meta.dir, `../../../../../core/skills/aide-${step}/SKILL.md`), "utf-8");
      const last = [...skill.matchAll(/^### (Step (\d+) of (\d+): .+)$/gm)].at(-1)!;
      expect(last[2]).toBe(last[3]);
      expect(`--- ${last[1]}`, step).toBe(title!);
    }
  });
});
