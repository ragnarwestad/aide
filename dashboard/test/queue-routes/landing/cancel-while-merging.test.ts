// Cancel always works. A job whose step has ended reads `done` while its
// work is merged into the default branch and the project's tests run on
// the merge, and Cancel refused it — "the job is already done" — with a
// suite that had already gone red once running on to its end (498,
// 2026-09-19). Now Cancel stops that run, nothing is pushed, and the
// job ends cancelled.

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runScript } from "../../../src/serve/land-branch/run-script.ts";
import { repoOf } from "./every-step-lands-fixtures.ts";
import { ARCHIVE_RESULT, AUTH, BRANCH, gitFor, runStep, serverWithRunner, settle, start } from "./archive-landing-fixtures.ts";

describe("Cancel while a finished step's work is merged and tested", () => {
  test("stops the test run and ends the job cancelled", async () => {
    let codeRoot = "";
    const needsRealMerge: string[] = [];
    const inner = gitFor({ needsRealMerge });
    const git = {
      calls: inner.calls,
      run: async (dir: string, args: string[]) => {
        if (repoOf(dir) === codeRoot && args.join(" ").startsWith("diff --quiet")) {
          inner.calls.push({ dir, args });
          return { code: 1, stdout: "" };
        }
        return inner.run(dir, args);
      },
    };
    // The test run, the way the real one is started: a script of its own,
    // for this job, that would take a minute.
    const { base, dir, results } = serverWithRunner(start, "aide-cancel-merging-", git as never, {
      landingGate: async (root, job, branch) => {
        const out = await runScript(["bash", "-c", "sleep 60"], root, 120_000, (job as { id?: string }).id);
        return out.code === 0
          ? { ok: true }
          : { ok: false, error: `the project's tests are red on this merge — the work is still on ${branch}.` };
      },
    });
    const specsRoot = join(dir, "root", "aide", "specs");
    codeRoot = join(dir, "root", "aide");
    needsRealMerge.push(codeRoot);
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ...ARCHIVE_RESULT,
        branchUrls: [
          { root: specsRoot, url: "https://example.test/aide-specs" },
          { root: codeRoot, url: "https://example.test/aide" },
        ],
      }),
    );
    await settle(base, job.id, (j) => j.state === "done" && j.landing === true);

    const began = Date.now();
    const pressed = await fetch(`${base}/api/queue/${job.id}/cancel`, { method: "POST", headers: AUTH });
    expect(pressed.status).toBe(200);
    const ended = await settle(base, job.id, (j) => j.state === "cancelled");

    expect(Date.now() - began).toBeLessThan(10_000);
    expect(ended.state).toBe("cancelled");
    expect(BRANCH).toContain("aide/");
  });
});
