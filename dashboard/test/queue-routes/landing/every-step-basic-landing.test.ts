import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOKEN, specHead, specControls, OPEN_81, setupQueueRoutesHarness } from "../fixtures.ts";

/** The message a job carries, as text. Since spec 380 a job stores
 *  WHICH message and what fills its blanks; the reader composes it.
 *  These tests assert on what a reader would see, so they compose it
 *  the same way, in English. */
import { renderSentence } from "../../../src/i18n/message.ts";

function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}

import { SPEC, AUTH, createOwnDirs, gitFor, repos, installs, serverWith, resultDir, runStep, settle, merges, result, stepWithResult } from "./every-step-lands-fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const { own, cleanup: cleanupOwnDirs } = createOwnDirs();

afterEach(() => {
  harness.cleanup();
  cleanupOwnDirs();
});

// --- spec 149: every step lands the work it produced -------------------------
//
// Split out of stopped-and-every-step.test.ts by theme: the basic
// per-step landing rules. The origin re-check (spec 193) and the
// pull-request mode (spec 220) are their own sibling files.
//
// Every step that touched only a repo it is safe to merge lands ITSELF,
// the moment it finishes — with no press and no browser attached. The
// six phases used to end with the spec archived and the code still on a
// branch, waiting for someone to press Merge; the same steps run one at
// a time piled "ready to merge" buttons on the row for the specs repo
// and one for the code. None of those buttons exist any more. Every step
// lands the work it produced, and `implement` is the one exception ON
// PURPOSE: its branch is where a person tests the code, by leaving
// `archive` unticked.
//
// `archive` is therefore the one step that sends CODE to a default
// branch — so it is the one landing that has to look past its own
// outcome (the code branch moved during implement, not during archive)
// and the one that has to install afterwards, exactly as the Merge
// button did.
describe("every step lands its own work (spec 149)", () => {
  const serverWithHarness = (
    dir: string,
    paths: { root: string },
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Parameters<typeof serverWith>[4] = {},
  ) => serverWith(harness, dir, paths, git, extra);

  // Criteria 1 and 2. The argument that made `create` and `archive` land
  // themselves holds word for word here: analyze writes markdown in the
  // specs repo and nothing else, so there is no diff for a person to
  // weigh and nothing that reaches the serving host.
  test.each(["analyze"])(
    "a finished %s step lands its own branch, with no press and no HTTP request",
    async (step) => {
      const dir = own(`aide-149-${step}-`);
      const paths = repos(dir);
      const git = gitFor();
      const { base } = serverWithHarness(dir, paths, git);

      const landed = await stepWithResult(base, dir, step, {
        branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
      });

      expect(landed.error).toBeFalsy();
      expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
      expect(git.calls.some((c) => c.dir === paths.specs && c.args[0] === "push")).toBe(true);
      // Landed, so the row stops advertising a branch at all.
      expect(landed.branchUrls).toEqual([]);
    },
  );

  // Criterion 3. The one step that deliberately does not land. The code
  // stays on `aide/<spec>`, which is where a person tests it — by
  // leaving `archive` unticked. The worktree is gone when the run ends,
  // so the branch on origin is what remains.
  test("a finished implement step merges nothing and leaves its branch open", async () => {
    const dir = own("aide-149-implement-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWithHarness(dir, paths, git);
    const marker = installs(paths.project);

    const branchUrls = [
      { root: paths.project, url: "https://example.test/aide" },
      { root: paths.specs, url: "https://example.test/aide-specs" },
    ];
    const done = await stepWithResult(base, dir, "implement", { branchUrls }, (j) => j.state === "done");

    expect(merges(git.calls)).toEqual([]);
    expect(done.landing).toBeFalsy();
    expect(done.branchUrls).toEqual(branchUrls);
    expect(existsSync(marker)).toBe(false);
  });

  // Criterion 4. The one landing that sends CODE to a default branch —
  // and the reason it cannot read its own outcome alone. The code branch
  // moved during IMPLEMENT; archive's own run may touch the project
  // checkout without moving its HEAD at all, so the project root need
  // never appear in archive's `branchUrls`. `queue.branchesFor` is the
  // record that still has it.
  test("archive lands the code branch an earlier implement left, and installs it", async () => {
    const dir = own("aide-149-archive-code-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWithHarness(dir, paths, git);
    const marker = installs(paths.project);

    // Implement first: it lands nothing, and its record is what carries
    // the project's branch forward.
    await stepWithResult(
      base,
      dir,
      "implement",
      {
        branchUrls: [
          { root: paths.project, url: "https://example.test/aide" },
          { root: paths.specs, url: "https://example.test/aide-specs" },
        ],
      },
      (j) => j.state === "done",
    );

    // Archive's own run reports the specs repo alone.
    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls, paths.project).length).toBeGreaterThan(0);
    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    // Merged is not deployed: for a tool that lives in `~/.local/bin`,
    // the default branch moving changes nothing on the machine until the
    // install runs. That is spec 92's bug, and the Merge button ran the
    // install for exactly this reason.
    for (let i = 0; i < 40 && !existsSync(marker); i++) await Bun.sleep(25);
    expect(existsSync(marker)).toBe(true);
  });

  // `aide-archive-spec` can refuse before any model runs (the spec has
  // not implemented, an acceptance row is unticked). That is ok and the
  // job is done — the row reads "archive held back" from 4-status.md —
  // but the landing used to run on `ok` and merged implement's code
  // branch into main with the spec still active (365 and 366,
  // 2026-09-03).
  test("an archive the gate refused is done, and nothing is merged", async () => {
    const dir = own("aide-archive-refused-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWithHarness(dir, paths, git);

    await stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
      (j) => j.state === "done",
    );
    const job = await stepWithResult(base, dir, "archive", {
      terminalReason: "acceptance-criteria-unticked",
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(job.state).toBe("done");
    expect(job.error).toBeFalsy();
    expect(merges(git.calls, paths.project)).toHaveLength(0);
    expect(merges(git.calls, paths.specs)).toHaveLength(0);
  });

  test("an archive that finds its spec already landed lands nothing again", async () => {
    const dir = own("aide-archive-already-landed-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWithHarness(dir, paths, git);

    const job = await stepWithResult(base, dir, "archive", { terminalReason: "already-landed" });

    expect(job.state).toBe("done");
    expect(merges(git.calls, paths.project)).toHaveLength(0);
    expect(merges(git.calls, paths.specs)).toHaveLength(0);
  });


  test("an archive landing that conflicts records errorReason and archives nothing", async () => {
    const dir = own("aide-149-archive-conflict-");
    const paths = repos(dir);
    // Plan first, code last: the specs merge lands the folder move, and
    // only then does the code merge conflict. So the spec IS archived on
    // disk by the time the row is asked for — which is the whole reason
    // the row needed spec 193 to survive at all.
    const git = gitFor({ conflicting: [paths.project], openOn: [paths.project] });
    const { base } = serverWithHarness(dir, paths, git);
    const marker = installs(paths.project);

    await stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
      (j) => j.state === "done",
    );
    const archiving = await runStep(base, "archive");
    paths.archiveSpec();
    writeFileSync(
      join(resultDir(dir), `${archiving.id}.json`),
      JSON.stringify(result({ branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] })),
    );
    const failed = await settle(base, archiving.id, (j) => !!j.error);

    expect(sentence(failed.error)).toContain(paths.project);
    expect(sentence(failed.error)).toContain("conflict");
    expect(failed.errorReason).toBe("conflict");
    expect(failed.landing).toBeFalsy();
    // REQ-2 (spec 327): the message names the failing step.
    expect(sentence(failed.landingError).startsWith("archive merge failed:")).toBe(true);
    // Nothing half-merged, and nothing deployed from a merge that never
    // happened.
    expect(git.calls.some((c) => c.dir === paths.project && c.args.join(" ") === "merge --abort")).toBe(true);
    expect(existsSync(marker)).toBe(false);
    // Still in the active list, with its branch, exactly as it was.
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(specHead(html, SPEC)).not.toBe("");
  }, 20000);

  // REQ-1, REQ-3, REQ-7 (spec 327). `analyze`'s landing fails to merge
  // the specs repo; `reset` runs next and its OWN landing succeeds
  // (a different repo). A later step's success must not erase the
  // earlier failure — clearing it belongs to whatever actually
  // resolves it, not to an unrelated step's own landing.
  test("an earlier step's landing failure survives a later step's successful landing (spec 327)", async () => {
    const dir = own("aide-327-survive-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);

    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze", "reset"] }),
      })
    ).json()) as { job: { id: string } };
    const id = made.job.id;

    writeFileSync(
      join(resultDir(dir), `${id}.json`),
      JSON.stringify(result({ branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] })),
    );
    // Wait for `reset` to actually be running — proof `analyze`'s
    // landing has fully settled, since `Runner.tick()` refuses to
    // start anything while any job carries `landing: true`. A larger
    // budget than `settle`'s default: this crosses TWO poll ticks (one
    // to notice `analyze`'s result, one to start `reset` once its
    // landing has cleared), on top of the landing's own retries.
    const running = await settle(base, id, (j) => j.stepIndex === 1 && j.state === "running", 300);
    expect(sentence(running.landingError)).toContain("analyze merge failed");

    writeFileSync(
      join(resultDir(dir), `${id}.json`),
      JSON.stringify(result({ branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] })),
    );
    const done = await settle(base, id, (j) => j.state === "done" && !j.landing);

    expect(done.error).toBeFalsy();
    expect(sentence(done.landingError)).toContain("analyze merge failed");
  }, 20000);

  // Criterion 6. A middle-of-the-workflow step lands what its OWN run
  // reports and nothing else; reading `branchesFor` history instead
  // would let a step that touched only the specs repo drag an
  // unarchived implement's code onto the default branch as a side
  // effect. (`resolve` was the step this was written for, until spec
  // 171 retired it, and `review-plan` was the other, until spec 181
  // folded it into analyze; the rule it proves belongs to
  // `landStepBranch`, which still lands `analyze`.)
  test("analyze lands the repos its own run reports, and installs a code root among them", async () => {
    const dir = own("aide-149-analyze-lands-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWithHarness(dir, paths, git);
    const marker = installs(paths.project);

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.project, url: "https://example.test/aide" }],
    });

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls, paths.project).length).toBeGreaterThan(0);
    expect(landed.branchUrls).toEqual([]);
    for (let i = 0; i < 40 && !existsSync(marker); i++) await Bun.sleep(25);
    expect(existsSync(marker)).toBe(true);
  });

  // The other half of criterion 6, and the whole of the risk this spec
  // accepted knowingly: a step that touched only the specs repo must
  // not reach back into the queue's history and land the code an
  // earlier implement left open.
  test("analyze does not land an unarchived implement's code branch", async () => {
    const dir = own("aide-149-analyze-scope-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWithHarness(dir, paths, git);

    await stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
      (j) => j.state === "done",
    );
    await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(merges(git.calls, paths.project)).toEqual([]);
  });

  // Criterion 7, as spec 171 leaves it. The reason is still stored on
  // the job and still read from there on any later request — a landing
  // has no browser to redirect a query string to. What is gone is the
  // control it used to draw: `archive` resolves a conflict itself now,
  // so a conflict that reaches the page is one no press would settle.
  test("a stored conflict draws no control on a fresh request (spec 171)", async () => {
    const dir = own("aide-171-conflict-offer-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);

    await stepWithResult(
      base,
      dir,
      "analyze",
      { branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] },
      (j) => !!j.error,
    );

    const url = `${base}/?${OPEN_81}`;
    const html = await (await fetch(url, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toContain("resolveform");
    expect(specControls(html, SPEC)).not.toContain('value="resolve"');
    // The failure itself is still on the row, and still names the repo
    // the reader has to go and look at.
    expect(specControls(html, SPEC)).not.toBe("");
  });

  // Criterion 8. Both routes are gone, not merely unreachable from the
  // page: the actions they offered are what this whole spec removes.
  test.each(["merge", "approve"])("POST /api/queue/<id>/%s is not a route any more", async (verb) => {
    const dir = own(`aide-149-route-${verb}-`);
    const paths = repos(dir);
    const { base } = serverWithHarness(dir, paths, gitFor());
    const job = await runStep(base, "analyze");

    const res = await fetch(`${base}/api/queue/${job.id}/${verb}`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(404);
    // Cancel is untouched — it is the one thing on that route that was
    // never about merging.
    const cancel = await fetch(`${base}/api/queue/${job.id}/cancel`, { method: "POST", headers: AUTH });
    expect(cancel.status).toBe(200);
  });

  // Criterion 9. No form on the page could ever set a gate, and the
  // three jobs that ever had one were posted as JSON by hand. A request
  // that still names it is accepted and the field ignored, like every
  // other unknown key — and no job can reach the state it produced.
  test("a POST naming gateAfter is accepted, and the job runs straight through", async () => {
    const dir = own("aide-149-gate-");
    const paths = repos(dir);
    const { base } = serverWithHarness(dir, paths, gitFor());
    const made = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({
        project: "aide",
        specFolder: SPEC,
        steps: ["analyze", "implement"],
        gateAfter: ["analyze"],
      }),
    });
    expect(made.status).toBe(200);
    const body = (await made.json()) as { job: Record<string, unknown> };
    expect("gateAfter" in body.job).toBe(false);
    expect(body.job.state).not.toBe("awaiting-approval");
  });
});
