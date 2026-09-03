import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOKEN, specHead, specControls, OPEN_81, mergeEventSink, setupQueueRoutesHarness } from "./fixtures.ts";
import {
  SPEC, BRANCH, AUTH, createOwnDirs, gitFor, repos, installs, serverWith, resultDir,
  runStep, settle, merges, result, stepWithResult,
} from "./every-step-lands-fixtures.ts";

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

  // The restart is what killed this process, and it used to fire from
  // inside the per-repo loop the moment the code root's install was
  // through — with archive's specs root, which carries the folder move
  // to `archive/`, still ahead in that loop. The spec then stayed on
  // the active list with no error anywhere, because the code that would
  // have written one was killed too. So: every repo merges BEFORE the
  // restart is allowed to fire.
  test("a landing into the dashboard's own checkout installs, logs, and never restarts", async () => {
    // A restart mid-run kills every job's process (four of them,
    // 2026-09-03 00:13), and no rule for a safe moment held up. The
    // person restarts with Deploy when it suits; the landing only says
    // the served page is behind.
    const dir = own("aide-restart-order-");
    const paths = repos(dir);
    const git = gitFor();
    let fired = 0;
    const logged: string[] = [];
    const realError = console.error;
    console.error = (msg: unknown) => {
      logged.push(String(msg));
      realError(msg);
    };
    const { base } = serverWithHarness(dir, paths, git, {
      dashboardRoot: paths.project,
      restart: {
        registered: async () => true,
        fire: () => {
          fired += 1;
        },
      },
    });
    installs(paths.project);

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
    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    const marker = join(paths.project, "installed");
    for (let i = 0; i < 80 && !existsSync(marker); i++) await Bun.sleep(25);
    await Bun.sleep(200);
    console.error = realError;
    expect(existsSync(marker)).toBe(true);
    expect(fired).toBe(0);
    expect(logged.some((l) => l.includes("restart it with Deploy"))).toBe(true);
  });

  // Criterion 5. A code merge that cannot be made stops the step: nothing
  // is left half-merged, the reason names the repo, and the spec stays in
  // the active list. `errorReason` is what makes the way out survive —
  // there is no browser attached to an automatic landing, so the one-shot
  // redirect the Merge button used cannot carry it.
  // The Deploy button's restart used to be awaited inside the route: the
  // kickstart landed before the answer went out, and the page read "the
  // request failed" for a deploy that had succeeded (2026-09-03).
  test("Deploy answers before its restart fires, and says the service is restarting", async () => {
    const dir = own("aide-deploy-answers-first-");
    const paths = repos(dir);
    // The landing fixture's git never answers which branch the checkout
    // is on; the deploy route asks, so answer it here.
    const inner = gitFor();
    const git = {
      calls: inner.calls,
      run: async (d: string, args: string[]) =>
        args.join(" ") === "rev-parse --abbrev-ref HEAD" ? { code: 0, stdout: "master\n" } : inner.run(d, args),
    };
    let fired = 0;
    let firedAt = 0;
    const { base } = serverWithHarness(dir, paths, git, {
      dashboardRoot: paths.project,
      restart: {
        // Slow on purpose: an answer that waited for this gate would
        // take at least this long.
        registered: () => new Promise<boolean>((r) => setTimeout(() => r(true), 400)),
        fire: () => {
          fired += 1;
          firedAt = Date.now();
        },
      },
    });
    installs(paths.project);
    const t0 = Date.now();
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { method: "POST", headers: AUTH });
    const answeredAt = Date.now();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; restarting?: boolean };
    expect(body.ok).toBe(true);
    expect(body.restarting).toBe(true);
    expect(answeredAt - t0).toBeLessThan(400);
    for (let i = 0; i < 60 && fired === 0; i++) await Bun.sleep(25);
    expect(fired).toBe(1);
    expect(firedAt).toBeGreaterThanOrEqual(answeredAt);
  });

  test("a landing into a project that is not the dashboard's own never restarts it", async () => {
    // The install is that project's business — PaceUp's install restarts
    // PaceUp, if anything. Only a landing into the checkout this dashboard
    // runs from restarts the dashboard.
    const dir = own("aide-restart-other-project-");
    const paths = repos(dir);
    const git = gitFor();
    let fired = 0;
    const { base } = serverWithHarness(dir, paths, git, {
      dashboardRoot: join(dir, "somewhere-else"),
      restart: {
        registered: async () => true,
        fire: () => {
          fired += 1;
        },
      },
    });
    const marker = installs(paths.project);
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
    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });
    expect(landed.error).toBeFalsy();
    for (let i = 0; i < 80 && !existsSync(marker); i++) await Bun.sleep(25);
    expect(existsSync(marker)).toBe(true);
    await Bun.sleep(200);
    expect(fired).toBe(0);
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

    expect(String(failed.error)).toContain(paths.project);
    expect(String(failed.error)).toContain("conflict");
    expect(failed.errorReason).toBe("conflict");
    expect(failed.landing).toBeFalsy();
    // REQ-2 (spec 327): the message names the failing step.
    expect(String(failed.landingError).startsWith("archive landing failed:")).toBe(true);
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
    expect(String(running.landingError)).toContain("analyze landing failed");

    writeFileSync(
      join(resultDir(dir), `${id}.json`),
      JSON.stringify(result({ branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] })),
    );
    const done = await settle(base, id, (j) => j.state === "done" && !j.landing);

    expect(done.error).toBeFalsy();
    expect(String(done.landingError)).toContain("analyze landing failed");
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

  // --- spec 158: a merge is an event claude-usage can see ---------------
  //
  // The dashboard merges in its own Bun process, so nothing writes a
  // transcript for claude-usage to read a merge out of. It has to say
  // what it did — for EVERY repo it lands, not only the code roots
  // `installAfterMerge` cares about, because the spec-markdown merges
  // an `analyze` makes are exactly the ones the ledger
  // is missing today.

  // Criterion 1. Every other test in this file is the other half of this
  // proof: none of them configures a URL, and none of them would issue a
  // request even with a live fetch in the harness.
  test("no url configured means no request, whatever lands", async () => {
    const dir = own("aide-158-inert-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink();
    const { base } = serverWithHarness(dir, paths, git, { mergeEventFetch: sink.mergeEventFetch });

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted).toEqual([]);
  });

  // Criteria 2, 5 and 7 at once. The step name is threaded through from
  // the call site rather than stubbed — `archive` says "archive" — and
  // the specs repo is not a code root, so an event for it proves the
  // report is not gated the way the install is.
  test.each(["analyze", "archive"])(
    "a landed %s step reports the merge of a specs-only repo",
    async (step) => {
      const dir = own(`aide-158-${step}-`);
      const paths = repos(dir);
      const git = gitFor();
      const sink = mergeEventSink();
      const { base } = serverWithHarness(dir, paths, git, sink);
      // A code root that is never landed here: an event for it would
      // mean the report followed the install's gate after all.
      installs(paths.project);

      const landed = await stepWithResult(base, dir, step, {
        branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
      });

      expect(landed.error).toBeFalsy();
      expect(sink.posted.length).toBe(1);
      expect(sink.posted[0]).toEqual({
        project: "aide",
        specFolder: SPEC,
        branch: BRANCH,
        repoRoot: paths.specs,
        step,
        jobId: landed.id,
        timestamp: expect.any(String),
      });
      const stamp = sink.posted[0].timestamp as string;
      expect(new Date(stamp).toISOString()).toBe(stamp);
    },
  );

  // Criterion 4. One run, two repos, two events — each naming its own
  // root. A single event per landing would leave the code merge, the
  // one that matters most, unreported whenever a specs merge preceded it.
  test("a landing that merges two repos reports both, each by its own root", async () => {
    const dir = own("aide-158-two-repos-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink();
    const { base } = serverWithHarness(dir, paths, git, sink);

    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [
        { root: paths.project, url: "https://example.test/aide" },
        { root: paths.specs, url: "https://example.test/aide-specs" },
      ],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted.map((e) => e.repoRoot).sort()).toEqual([paths.project, paths.specs].sort());
    expect(sink.posted.every((e) => e.step === "archive" && e.branch === BRANCH)).toBe(true);
  });

  // Criterion 3. The same rule `installAfterMerge` already keeps: the
  // merge happened, so a report that cannot be delivered is noted beside
  // it and never turns a completed merge into a failed one.
  test("a report that throws leaves the landing successful", async () => {
    const dir = own("aide-158-report-fails-");
    const paths = repos(dir);
    const git = gitFor();
    const thrower = (async () => {
      throw new Error("claude-usage is down");
    }) as unknown as typeof fetch;
    const { base } = serverWithHarness(dir, paths, git, {
      mergeEventUrl: "http://claude-usage.test/api/merge-event",
      mergeEventFetch: thrower,
    });

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(landed.branchUrls).toEqual([]);
  });

  // And the same for a sink that answers but refuses.
  test("a report the sink refuses leaves the landing successful", async () => {
    const dir = own("aide-158-report-refused-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink(() => new Response("no", { status: 500 }));
    const { base } = serverWithHarness(dir, paths, git, sink);

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted.length).toBe(1);
  });

  // A merge that never happened is not an event. The ledger's whole
  // question is "was this merge reviewed?" — a refused merge reported as
  // one would be an answer about work that is not on the default branch.
  test("a landing that conflicts reports nothing for the repo it could not merge", async () => {
    const dir = own("aide-158-conflict-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const sink = mergeEventSink();
    const { base } = serverWithHarness(dir, paths, git, sink);

    const failed = await stepWithResult(
      base,
      dir,
      "analyze",
      { branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] },
      (j) => !!j.error,
    );

    expect(String(failed.error)).toContain(paths.specs);
    expect(sink.posted).toEqual([]);
  }, 20000);
});
