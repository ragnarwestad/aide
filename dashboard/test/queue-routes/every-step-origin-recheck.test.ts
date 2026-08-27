import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOKEN, setupQueueRoutesHarness } from "./fixtures.ts";
import {
  SPEC, BRANCH, AUTH, createOwnDirs, gitFor, repos, serverWith, resultDir,
  settle, result, stepWithResult,
} from "./every-step-lands-fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const { own, cleanup: cleanupOwnDirs } = createOwnDirs();

afterEach(() => {
  harness.cleanup();
  cleanupOwnDirs();
});

// --- spec 193: a landing that failed is not a spec that is done ----------
//
// Split out of stopped-and-every-step.test.ts by theme.
//
// Three specs reached the archive with their code still on a branch,
// and every row said done: the archive STEP succeeded, so the job
// stayed `done`, and the landing after it wrote only a sentence
// nothing was drawing. The queue's memory of its own pushes is not
// the answer to "does this spec still have a branch open" — origin
// is.
describe("an archive landing asks origin whether anything stayed open", () => {
  const serverWithHarness = (
    dir: string,
    paths: { root: string },
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
  ) => serverWith(harness, dir, paths, git);

  /** Spec 146's shape: the implement was run BY HAND, so the queue
   *  holds no job carrying the project root and archive's own run
   *  reports the specs repo alone. Nothing in the merge loop ever
   *  mentions the code branch, and it is still on origin. */
  const onlyTheSpecsRepo = (paths: { specs: string }) => ({
    branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
  });

  // Criterion 2.
  test("a branch left on origin in a repo the loop never saw is a failed job", async () => {
    const dir = own("aide-193-unlanded-");
    const paths = repos(dir);
    const git = gitFor({ openOn: [paths.project] });
    const { base } = serverWithHarness(dir, paths, git);

    const failed = await stepWithResult(
      base,
      dir,
      "archive",
      onlyTheSpecsRepo(paths),
      (j) => !!j.error,
    );

    expect(failed.state).toBe("failed");
    expect(failed.errorReason).toBe("unlanded");
    expect(String(failed.error)).toContain(paths.project);
    expect(String(failed.error)).toContain(BRANCH);
    // Spec 201: the state is half the sentence — the other half is
    // the move. The row's own button already offers it; the message
    // has to say so.
    expect(String(failed.error).toLowerCase()).toContain("run archive again");
  }, 20000);

  // Criterion 3. The happy path is the one this whole change must not
  // break: a landing that merged everything leaves no branch behind,
  // so origin agrees and the job stays exactly as it was.
  test("a landing that left nothing on origin stays done, with no error", async () => {
    const dir = own("aide-193-clean-");
    const paths = repos(dir);
    const git = gitFor({ openOn: [paths.project, paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);

    await stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
      (j) => j.state === "done",
    );
    const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

    expect(landed.state).toBe("done");
    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
  });

  // Criterion 4. An unanswerable question is not evidence. Same
  // fixture as criterion 2 — the branch really is still open — with
  // an origin that cannot be reached.
  test("a question origin cannot answer invents no failure", async () => {
    const dir = own("aide-193-unanswerable-");
    const paths = repos(dir);
    const git = gitFor({ openOn: [paths.project], lsRemoteCode: 128 });
    const { base } = serverWithHarness(dir, paths, git);

    const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

    expect(landed.state).toBe("done");
    expect(landed.error).toBeFalsy();
  });

  // Criterion 9. The verification is ARCHIVE's alone. An analyze runs
  // while implement's code branch is legitimately open, and the same
  // check there would call a healthy landing failed.
  test("an analyze landing is not asked, and stays done beside an open code branch", async () => {
    const dir = own("aide-193-analyze-");
    const paths = repos(dir);
    const git = gitFor({ openOn: [paths.project] });
    const { base } = serverWithHarness(dir, paths, git);

    const landed = await stepWithResult(base, dir, "analyze", onlyTheSpecsRepo(paths));

    expect(landed.state).toBe("done");
    expect(landed.error).toBeFalsy();
    // The SWEEP, not `isMerged`'s per-branch question: that one runs
    // on every page load and says nothing about the landing.
    expect(git.calls.some((c) => c.args.includes("refs/heads/aide/*"))).toBe(false);
  });

  // Criterion 10. `complete()` may already have queued the job's NEXT
  // step by the time the landing's promise settles, and a landing
  // must not overwrite a job that has moved on.
  test("a failed landing does not overwrite a job whose next step is queued", async () => {
    const dir = own("aide-193-moved-on-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);

    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze", "implement"] }),
      })
    ).json()) as { job: { id: string } };
    writeFileSync(
      join(resultDir(dir), `${made.job.id}.json`),
      JSON.stringify(result(onlyTheSpecsRepo(paths))),
    );
    const after = await settle(base, made.job.id, (j) => !!j.error || j.state === "failed");

    // Queued for implement, with the analyze landing's refusal on the
    // row beside it — not stranded as a failed job.
    expect(after.state).toBe("queued");
    expect(String(after.error)).toContain(paths.specs);
  }, 20000);

  // Criterion 8. The way out. A re-run of `archive` needs no new step:
  // the runner hands archive the open merge, the skill resolves it,
  // and the landing that follows merges cleanly.
  describe("archive can be enqueued again for such a spec", () => {
    /** A server whose spec is ALREADY in `archive/` on disk — the
     *  state the three stranded specs are in — with `GET /` run once,
     *  because that is where the archived-with-an-open-branch set is
     *  refreshed. An un-refreshed set is empty, so the enqueue fails
     *  closed. */
    async function archivedServer(name: string, branchStillOpen: boolean) {
      const dir = own(name);
      const paths = repos(dir);
      paths.archiveSpec();
      const git = gitFor({ openOn: branchStillOpen ? [paths.project] : [] });
      const { base } = serverWithHarness(dir, paths, git);
      await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } });
      return { base, paths };
    }

    const enqueue = (base: string) =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["archive"] }),
      });

    test("while its branch is still on origin", async () => {
      const { base } = await archivedServer("aide-193-rerun-open-", true);
      expect((await enqueue(base)).status).toBe(200);
    });

    test("and not once the branch is gone", async () => {
      const { base } = await archivedServer("aide-193-rerun-closed-", false);
      expect((await enqueue(base)).status).toBeGreaterThan(399);
    });

    // --- spec 198: the other way out ------------------------------------
    //
    // An archived spec can also be REOPENED, and unlike the re-run
    // above that does not depend on a branch being open — a spec whose
    // work has to be done again is one that finished cleanly, most of
    // the time. The two exceptions are kept apart in the resolver for
    // that reason: `specFolders` carries spec 193's open-branch
    // exception and admits every step, `archivedFolders` carries this
    // one and admits `reopen` alone.
    const enqueueReopen = (base: string, steps: string[] = ["reopen"]) =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps }),
      });

    test("reopen is accepted for an archived spec whose branch is gone", async () => {
      const { base } = await archivedServer("aide-198-reopen-closed-", false);
      expect((await enqueueReopen(base)).status).toBe(200);
    });

    test("and every other step still is not", async () => {
      const { base } = await archivedServer("aide-198-reopen-other-", false);
      const res = await enqueueReopen(base, ["implement"]);
      expect(res.status).toBeGreaterThan(399);
      expect(String((await res.json() as { error?: string }).error)).toContain("archived");
    });

    // A no-script form POST gets a redirect and nothing else, and the
    // specs list has no row for an archived spec to put the answer on.
    // The reader comes back to the page the button is on.
    test("a form press comes back to the spec's own page", async () => {
      const { base } = await archivedServer("aide-198-reopen-back-", false);
      const res = await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "x-aide-token": TOKEN, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ project: "aide", specFolder: SPEC, steps: "reopen" }),
        redirect: "manual",
      });
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.headers.get("location")).toContain(`/specs/aide/${SPEC}`);
    });
  });
});
