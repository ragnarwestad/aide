import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TOKEN,
  JOB,
  specControls,
  OPEN_81,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});


// Spec 118: the token count is recorded by the run, stored on the job,
// and has to survive every hop between the mirror on disk and the cell
// in the page. The render tests prove the cell; this one proves the
// hops — a field the server forgets to forward renders a dash forever,
// and nothing else would notice.
describe("a job's token count reaches the page", () => {
  async function seeded(): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "done";
    job.spentUsd = 0.54;
    job.spentTokens = 1_234_000;
    job.results = [
      {
        step: "analyze", ok: true, costUsd: 0.54, costMeasured: true,
        terminalReason: "completed", at: "2026-08-16T10:01:00Z",
        tokens: { input: 100, output: 900, cacheRead: 1_000_000, cacheCreation: 233_000, total: 1_234_000 },
      },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  test("the spec list shows both figures, and the model dropdown stays in dollars", async () => {
    const { mirror } = await seeded();
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain('<span class="u-usd">$0.54</span>');
    expect(html).toContain('<span class="u-tok">1.2M tok</span>');
  });

  test("the job page shows both figures for the step and the job", async () => {
    const { mirror, id } = await seeded();
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const html = await (
      await fetch(`${base}/specs/${id}?tab=steps`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(html).toContain('<span class="u-usd">$0.54</span>');
    expect(html).toContain('<span class="u-tok">1.2M tok</span>');
  });
});

// --- spec 122: a queued step waits for its dependency, it does not fail -----
//
// Before this, a queued implement whose dependency was still unmerged
// started, was refused by `aide-run-spec`, and landed in `failed` — a
// state nothing retries. The queue now asks the same question the script
// asks (is the dependency's branch merged on origin?) BEFORE spawning
// anything, and leaves the job queued with the reason on its row until
// the answer changes.
describe("a job parked on an unmerged dependency (spec 122)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const DEPENDENT = "# Queue - Description\n\n## Tracking info\n\n- **Depends on:** `80-dependency`\n";

  /** A projects root this suite owns, so the paths git is asked about
   *  are the paths the test names. The shared harness makes its own and
   *  leaves `queueProjectRoot` unset, which resolves the project's
   *  checkout to a bare relative name — fine for a suite that never
   *  looks at it, useless for one that is entirely about which repo was
   *  asked. */
  function root(dir: string): { root: string; project: string; specs: string } {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    const specs = join(project, "specs");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(specs, "81-queue-and-runner"), { recursive: true });
    writeFileSync(join(specs, "81-queue-and-runner", "1-description.md"), DEPENDENT);
    mkdirSync(join(specs, "80-dependency"), { recursive: true });
    writeFileSync(join(specs, "80-dependency", "1-description.md"), "# 80-dependency\n");
    return { root: projectsRoot, project, specs };
  }

  /** A stub runner that records the argv it was called with — the same
   *  shape "the runner invocation" uses. The proof that nothing was
   *  spawned is that this file never appears. */
  function stub(dir: string): { bin: string; argvFile: string } {
    const argvFile = join(dir, "runner-argv.txt");
    const bin = join(dir, "fake-run-spec");
    writeFileSync(bin, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${argvFile}\n`, { mode: 0o755 });
    return { bin, argvFile };
  }

  /** A git that answers `isMerged` per repo root. `unmerged` names the
   *  roots where the dependency's branch still has commits of its own;
   *  everywhere else it is an ancestor of the default branch. Read
   *  through a function, so one test can watch the answer change under a
   *  live server. */
  function gitFor(unmerged: () => string[]) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      // The branch IS on origin — absence is the other way a dependency
      // counts as merged, and this suite is about the ancestry answer.
      if (a.startsWith("ls-remote")) return { code: 0, stdout: "abc123\trefs/heads/x\n" };
      if (a.startsWith("merge-base --is-ancestor")) {
        return { code: unmerged().includes(dir) ? 1 : 0, stdout: "" };
      }
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  const queueImplement = (base: string) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });

  /** Long enough for a spawn to have written its file: the runner ticks
   *  on the enqueue itself, so a job that was going to start has started
   *  well before this returns. */
  const settle = () => Bun.sleep(400);

  function own(prefix: string) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    return dir;
  }

  test("an implement job whose dependency is unmerged never invokes the runner", async () => {
    const dir = own("aide-queue-parked-");
    const { bin, argvFile } = stub(dir);
    const paths = root(dir);
    const git = gitFor(() => [paths.project, paths.specs]);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: git.run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    expect(existsSync(argvFile)).toBe(false);

    const listed = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as {
      jobs: { state: string; error?: string }[];
    };
    expect(listed.jobs[0].state).toBe("queued");
    expect(listed.jobs[0].error).toContain("80-dependency");
  });

  test("a dependency merged in one root but not the other still parks the job", async () => {
    const dir = own("aide-queue-parked-two-");
    const { bin, argvFile } = stub(dir);
    const paths = root(dir);
    // Merged in the project checkout, still open in the specs repo.
    const git = gitFor(() => [paths.specs]);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: git.run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    expect(existsSync(argvFile)).toBe(false);
    // Both roots were actually asked — a check that stopped at the
    // project would have started this job.
    expect(git.calls.some((c) => c.dir === paths.project)).toBe(true);
    expect(git.calls.some((c) => c.dir === paths.specs)).toBe(true);
  });

  // Spec 213. The two tests above and the three-server test below both
  // read ONE answer; this one is about how old that answer may be. Two
  // jobs were released roughly half a minute before their dependency
  // finished archiving: the gate ran fresh every 2 s, but the merge
  // answer under it stood for 30 s, so a "merged" taken before the
  // dependency landed was handed out for the rest of that window.
  //
  // One server across several real ticks, deliberately — the point is
  // the same `BranchStatusChecker` instance being asked again inside
  // its own TTL, which is exactly what the three-server test below was
  // built to avoid needing.
  test("the gate re-asks origin on every tick, and releases the job the tick its dependency lands", async () => {
    const dir = own("aide-queue-gate-fresh-");
    const { bin, argvFile } = stub(dir);
    const paths = root(dir);
    let unmerged = [paths.project, paths.specs];
    const git = gitFor(() => unmerged);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: git.run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    const asked = () => git.calls.filter((c) => c.args[0] === "merge-base").length;
    const first = asked();
    expect(first).toBeGreaterThan(0);

    // One 2 s tick interval plus margin, well inside the 30 s TTL: the
    // question has to have been put to git again. Cached, this count
    // would not move for another 28 seconds.
    await Bun.sleep(2500);
    expect(asked()).toBeGreaterThan(first);
    expect(existsSync(argvFile)).toBe(false);

    // The dependency lands. The job starts on the next tick — not when
    // a cache happens to expire.
    unmerged = [];
    for (let i = 0; i < 50 && !existsSync(argvFile); i++) await Bun.sleep(100);
    expect(existsSync(argvFile)).toBe(true);
  }, 20000);
  // Criterion 10 (spec 149). The gate's code is unchanged, but what
  // satisfies it has moved: a dependency's ANALYZE lands itself now, so
  // its specs-repo branch merges early — and that must not read as "the
  // dependency is done". Only the ARCHIVE that lands its code releases a
  // dependent, because since spec 149 that is the only point a spec's
  // code branch reaches a default branch at all.
  //
  // Three servers over one mirror, rather than one server watching the
  // answer change: each merge answer is cached for 30 s, and this test
  // is about which ANSWER releases the job, not about when a cache
  // expires.
  test("only the dependency's archive releases the parked job — its analyze does not", async () => {
    const dir = own("aide-queue-release-");
    const paths = root(dir);
    const mirror = join(dir, "queue.json");
    const common = {
      queueToken: TOKEN,
      projectRoot: paths.root,
      queueProjectRoot: paths.root,
      queueMirrorPath: mirror,
    };

    // The dependency's own finished job, recorded through a server with
    // no runner: it must leave a branch behind without ever running.
    const { base: seeder } = harness.start({
      extra: { ...common, gitRun: gitFor(() => [paths.project, paths.specs]).run },
    });
    const dep = (await (
      await fetch(`${seeder}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: "80-dependency", steps: ["analyze"] }),
      })
    ).json()) as { job: { id: string } };
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const stored = jobs.find((j) => j.id === dep.job.id)!;
    stored.state = "done";
    stored.branchUrls = [
      { root: paths.project, url: "https://example.test/aide" },
      { root: paths.specs, url: "https://example.test/aide-specs" },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));

    /** One server's answer to "does this dependent start?", with the
     *  dependency's branch merged in exactly the named roots. `waitMs`
     *  is how long to give it: a refused enqueue does not tick the
     *  runner, so a job already in the mirror waits for the server's own
     *  2 s interval — worth waiting out when a start is expected, worth
     *  not waiting out three times over when one is not. */
    async function startsWith(unmerged: string[], prefix: string, waitMs = 800): Promise<boolean> {
      const runDir = own(prefix);
      const { bin, argvFile } = stub(runDir);
      const { base } = harness.start({
        extra: {
          ...common,
          queueRunnerBin: bin,
          queueResultDir: join(runDir, "jobs"),
          gitRun: gitFor(() => unmerged).run,
        },
      });
      const posted = await queueImplement(base);
      // The dependent's own job is enqueued once and lives in the shared
      // mirror; a later server finds it already there and refuses a
      // second copy, which is not what this test is asking about.
      expect([200, 400]).toContain(posted.status);
      for (let i = 0; i * 100 < waitMs && !existsSync(argvFile); i++) await Bun.sleep(100);
      return existsSync(argvFile);
    }

    // Nothing landed: parked, as spec 122 already had it.
    expect(await startsWith([paths.project, paths.specs], "aide-queue-release-none-")).toBe(false);
    // The dependency's analyze self-landed — the specs repo is merged
    // and the code is not. Still parked.
    expect(await startsWith([paths.project], "aide-queue-release-analyzed-")).toBe(false);
    // Archived: the code landed too, and the dependent starts.
    expect(await startsWith([], "aide-queue-release-archived-", 6000)).toBe(true);
  }, 20000);

  test("a parked job's row shows the queued badge and the reason it is held back", async () => {
    const dir = own("aide-queue-parked-row-");
    const { bin } = stub(dir);
    const paths = root(dir);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: gitFor(() => [paths.project, paths.specs]).run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    // The ordinary queued badge, with the reason underneath it — no
    // seventh badge variant and no new job state were introduced.
    expect(html).toContain('badge b-idle">queued');
    expect(html).toContain("held back: depends on 80-dependency");
  });

  test("cancelling a parked job cancels it like any other queued job", async () => {
    const dir = own("aide-queue-parked-cancel-");
    const { bin } = stub(dir);
    const paths = root(dir);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: gitFor(() => [paths.project, paths.specs]).run,
      },
    });
    const made = (await (await queueImplement(base)).json()) as { job: { id: string } };
    await settle();
    expect((await fetch(`${base}/api/queue/${made.job.id}/cancel`, { method: "POST", headers: AUTH })).status)
      .toBe(200);
    const after = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as {
      jobs: { id: string; state: string }[];
    };
    expect(after.jobs.find((j) => j.id === made.job.id)?.state).toBe("cancelled");
  });
});
// --- spec 160: a later phase can be added while the job runs ------------------

// Not a second job for the same spec — the clash check refuses that,
// and rightly. This is an edit to the job that exists, so it has a
// route of its own, and every decision it makes is against the job as
// it stands at that instant rather than against whatever the page
// believed when the box was ticked.
describe("POST /api/queue/:id/steps (spec 160)", () => {
  const JSON_HEADERS = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  /** One job in the mirror, RUNNING the step at `stepIndex`, served by
   *  a second server started on that mirror. No runner is configured,
   *  so nothing reconciles the seeded state out from under the test —
   *  the same trick the view-carrying suite above uses for Cancel. */
  async function running(
    steps: string[],
    stepIndex = 0,
    opts: { description?: string; alsoSpecs?: string[] } = {},
  ): Promise<{ base: string; id: string }> {
    const first = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${first.base}/api/queue`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...JOB, steps }),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(first.dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "running";
    job.stepIndex = stepIndex;
    writeFileSync(mirror, JSON.stringify(jobs));
    const second = harness.start({
      extra: { queueToken: TOKEN, queueMirrorPath: mirror },
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.alsoSpecs ? { alsoSpecs: opts.alsoSpecs } : {}),
    });
    return { base: second.base, id: made.job.id };
  }

  const edit = (base: string, id: string, step: string, checked: boolean, body?: BodyInit) =>
    fetch(`${base}/api/queue/${id}/steps`, {
      method: "POST",
      headers: body
        ? { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "x-aide-token": TOKEN }
        : JSON_HEADERS,
      body: body ?? JSON.stringify({ step, checked }),
    });

  const stepsOf = async (base: string, id: string): Promise<string[]> => {
    const listed = (await (await fetch(`${base}/api/queue`, { headers: JSON_HEADERS })).json()) as {
      jobs: { id: string; steps: string[] }[];
    };
    return listed.jobs.find((j) => j.id === id)!.steps;
  };

  test("a later step is added, in workflow order (criterion 1)", async () => {
    const { base, id } = await running(["analyze"]);
    const res = await edit(base, id, "archive", true);
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean; job: { steps: string[] } };
    expect(answer.ok).toBe(true);
    expect(answer.job.steps).toEqual(["analyze", "archive"]);
    expect((await edit(base, id, "implement", true)).status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "implement", "archive"]);
  });

  test("a not-yet-started step is removed (criterion 2)", async () => {
    const { base, id } = await running(["analyze", "implement", "archive"]);
    expect((await edit(base, id, "implement", false)).status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  test("the form encoding the page posts is understood too", async () => {
    const { base, id } = await running(["analyze"]);
    const res = await edit(base, id, "", false, new URLSearchParams({ step: "archive", checked: "1" }));
    expect(res.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
    const off = await edit(base, id, "", false, new URLSearchParams({ step: "archive", checked: "0" }));
    expect(off.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze"]);
  });

  test("the running step is refused, by name (criterion 3)", async () => {
    const { base, id } = await running(["analyze", "archive"], 1);
    const res = await edit(base, id, "archive", false);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("archive");
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  // The page drew `implement` as a live box; by the time the tick
  // arrived the runner had walked onto it. The server answers about the
  // job it has, not about the one the page remembers.
  test("a step the runner has walked past since the page drew it is refused (criterion 4)", async () => {
    const { base, id } = await running(["analyze", "implement"], 1);
    const res = await edit(base, id, "implement", false);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("implement");
    expect(await stepsOf(base, id)).toEqual(["analyze", "implement"]);
  });

  test("a job that is not running is refused (criterion 6)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await edit(base, made.job.id, "implement", true);
    expect(res.status).toBe(400);
    expect(await stepsOf(base, made.job.id)).toEqual(["analyze"]);
  });

  test("a step earlier than the one running is refused (criterion 9)", async () => {
    const { base, id } = await running(["implement", "archive"]);
    const res = await edit(base, id, "analyze", true);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("analyze");
    expect(await stepsOf(base, id)).toEqual(["implement", "archive"]);
  });

  test("an unknown job is a 404, and GET is not a way in", async () => {
    const { base, id } = await running(["analyze"]);
    expect((await edit(base, "nope", "archive", true)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/queue/${id}/steps`, { headers: JSON_HEADERS })).status,
    ).toBe(405);
  });

  // Criterion 5. The gate is not the route's question: a gated step
  // added to a tail is accepted the same way one named at job creation
  // is, and is held back only once it becomes the job's current step —
  // which is what `runner.test.ts` pins from the other side.
  test("a gated step is accepted even though the spec's dependency has not landed", async () => {
    const { base, id } = await running(["analyze"], 0, {
      description: "# Queue - Description\n\n## Tracking info\n\n- **Depends on:** `80-dependency`\n",
      alsoSpecs: ["80-dependency"],
    });
    const res = await edit(base, id, "archive", true);
    expect(res.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  // The other half of the wiring: the row the reader is looking at has
  // to draw those boxes live, and point them at this route.
  test("the row draws the live boxes and points them here", async () => {
    const { base, id } = await running(["analyze"]);
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    const group = specControls(html, "81-queue-and-runner");
    expect(group).toContain(`data-post-to="/api/queue/${id}/steps"`);
    const live = (step: string) =>
      (group.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "");
    expect(live("archive")).toContain("data-post-to");
    expect(live("archive")).not.toContain("disabled");
    expect(live("analyze")).toContain("disabled");
  });
});
// --- spec 225: a phase still ahead takes a model too --------------------------

// The sibling of the route above, and named after the one thing it
// does. A box tick and a select change are two different events at two
// different moments; folding them into one body would make `/steps`
// branch on which fields it was handed, and `checked`'s absence would
// have to mean something other than `false`.
describe("POST /api/queue/:id/model (spec 225)", () => {
  const JSON_HEADERS = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const DEFAULTS = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  /** One job in the mirror, RUNNING the step at `stepIndex`, served by
   *  a second server started on that mirror — the same trick the
   *  `/steps` suite above uses, so no runner reconciles the seeded
   *  state out from under the test. */
  async function running(steps: string[], stepIndex = 0): Promise<{ base: string; id: string }> {
    const first = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const made = (await (
      await fetch(`${first.base}/api/queue`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...JOB, steps }),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(first.dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "running";
    job.stepIndex = stepIndex;
    writeFileSync(mirror, JSON.stringify(jobs));
    const second = harness.start({
      extra: { queueToken: TOKEN, queueMirrorPath: mirror, queueDefaults: DEFAULTS },
    });
    return { base: second.base, id: made.job.id };
  }

  const pick = (base: string, id: string, step: string, model: string, body?: BodyInit) =>
    fetch(`${base}/api/queue/${id}/model`, {
      method: "POST",
      headers: body
        ? { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "x-aide-token": TOKEN }
        : JSON_HEADERS,
      body: body ?? JSON.stringify({ step, model }),
    });

  const modelOf = async (base: string, id: string): Promise<Record<string, string>> => {
    const listed = (await (await fetch(`${base}/api/queue`, { headers: JSON_HEADERS })).json()) as {
      jobs: { id: string; model: Record<string, string> }[];
    };
    return listed.jobs.find((j) => j.id === id)!.model;
  };

  test("a step still ahead takes the model (criterion 4)", async () => {
    const { base, id } = await running(["analyze", "implement"]);
    const res = await pick(base, id, "implement", "fable");
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean; job: { model: Record<string, string> } };
    expect(answer.ok).toBe(true);
    expect(answer.job.model.implement).toBe("fable");
    expect((await modelOf(base, id)).implement).toBe("fable");
  });

  test("the form encoding the page posts is understood too (criterion 4)", async () => {
    const { base, id } = await running(["analyze", "implement"]);
    const res = await pick(base, id, "", "", new URLSearchParams({ step: "implement", model: "fable" }));
    expect(res.status).toBe(200);
    expect((await modelOf(base, id)).implement).toBe("fable");
  });

  test("the running step is refused, by name (criterion 3)", async () => {
    const { base, id } = await running(["analyze", "implement"], 1);
    const res = await pick(base, id, "implement", "fable");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("implement");
    expect((await modelOf(base, id)).implement).toBe("opus");
  });

  test("a model the server does not offer is refused (criterion 7)", async () => {
    const { base, id } = await running(["analyze", "implement"]);
    const res = await pick(base, id, "implement", "haiku");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("haiku");
    expect((await modelOf(base, id)).implement).toBe("opus");
  });

  test("a job that is not running is refused (criterion 8)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await pick(base, made.job.id, "analyze", "fable");
    expect(res.status).toBe(400);
    expect((await modelOf(base, made.job.id)).analyze).toBe("sonnet");
  });

  test("an unknown job is a 404, and GET is not a way in", async () => {
    const { base, id } = await running(["analyze"]);
    expect((await pick(base, "nope", "archive", "fable")).status).toBe(404);
    expect((await fetch(`${base}/api/queue/${id}/model`, { headers: JSON_HEADERS })).status).toBe(405);
  });

  // The other half of the wiring: the row the reader is looking at has
  // to draw those selects live, and point them at this route.
  test("the row draws the live model select and points it here (criteria 1-3)", async () => {
    const { base, id } = await running(["analyze"]);
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    const group = specControls(html, "81-queue-and-runner");
    const select = (step: string) =>
      group.match(new RegExp(`<select name="model\\.${step}"[^>]*>`))?.[0] ?? "";
    expect(select("implement")).toContain(`data-post-to="/api/queue/${id}/model"`);
    expect(select("implement")).not.toContain("disabled");
    expect(select("analyze")).toContain("disabled");
    expect(select("analyze")).not.toContain("data-post-to");
  });
});
