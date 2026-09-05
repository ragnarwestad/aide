// Spec 406: landing a `close` step. The specs root merges normally,
// exactly as an archive landing's does; the code root's branch is
// DELETED, never merged — Close records that the work will not be
// used. Follows the shape archive-landing.test.ts's own suite already
// tests against, reusing its fixtures.

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeEventSink } from "../fixtures.ts";
import {
  AUTH,
  SPEC,
  SPECS_REPO,
  gitFor,
  merges,
  settle,
  serverWithRunner,
  start,
} from "./archive-landing-fixtures.ts";

const CODE_REPO = "/repos/aide";

/** `runStep`'s own shape, plus the reason a close step's own POST
 *  validation requires (queue/parse-request.ts) — never posted for
 *  any other step, so the sibling suite's `runStep` stays as it is. */
async function runCloseStep(base: string): Promise<{ id: string }> {
  const made = (await (
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["close"], closeReason: "this idea does not hold" }),
    })
  ).json()) as { job: { id: string } };
  return made.job;
}

const CLOSE_RESULT = {
  ok: true,
  exitCode: 0,
  costUsd: 0.1,
  costMeasured: true,
  terminalReason: "closed",
  branch: "aide/81-queue-and-runner",
  branchUrls: [
    { root: SPECS_REPO, url: "https://example.test/aide-specs" },
    { root: CODE_REPO, url: "https://example.test/aide" },
  ],
  repos: [],
};

describe("spec 406: landing a close step", () => {
  test("the specs root merges and pushes normally", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(start, "aide-close-results-", git, { queueProjectRoot: "/repos" });
    const job = await runCloseStep(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CLOSE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls).some((c) => c.dir === SPECS_REPO)).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
  });

  test("the code root's branch is deleted, never merged", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(start, "aide-close-results-", git, { queueProjectRoot: "/repos" });
    const job = await runCloseStep(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CLOSE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    // No merge call ever touches the code root.
    expect(merges(git.calls).some((c) => c.dir === CODE_REPO)).toBe(false);
    expect(git.calls.some((c) => c.dir === CODE_REPO)).toBe(true);
    // The delete happens directly — no switch/fetch/ff-only merge
    // sequence against the code root at all, only the origin-existence
    // check and the two deletes.
    expect(git.calls.some((c) => c.dir === CODE_REPO && c.args.join(" ").startsWith("ls-remote"))).toBe(true);
    expect(git.calls.some((c) => c.dir === CODE_REPO && c.args.join(" ") === "push -q origin --delete aide/81-queue-and-runner")).toBe(true);
    expect(git.calls.some((c) => c.dir === CODE_REPO && c.args[0] === "branch" && c.args.includes("-D"))).toBe(true);
    // And it landed clean.
    expect(landed.branchUrls).toEqual([]);
  });

  test("no merge-event report fires for the discarded code root — only for the merged specs root", async () => {
    const git = gitFor();
    const sink = mergeEventSink();
    const { base, results } = serverWithRunner(start, "aide-close-results-", git, {
      queueProjectRoot: "/repos",
      ...sink,
    });
    const job = await runCloseStep(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CLOSE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(sink.posted.some((p) => p.repoRoot === SPECS_REPO)).toBe(true);
    expect(sink.posted.some((p) => p.repoRoot === CODE_REPO)).toBe(false);
  });

  test("a failed origin delete is reported the same way archive's own left-behind branch is", async () => {
    const git = gitFor({ deleteFails: [CODE_REPO] });
    const { base, results } = serverWithRunner(start, "aide-close-results-", git, { queueProjectRoot: "/repos" });
    const job = await runCloseStep(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CLOSE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(landed.branchDeleteError).toBeTruthy();
  });
});
