import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRootLock,
} from "../../src/serve/serve.ts";
import { type GitRunner } from "../../src/git/branch-status.ts";
import { statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  JOB,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});


// Spec 254: `Runner.complete()` writes `state: "done"` and `landing: true`
// in the same update — the merge into the default branch has not
// happened yet. This holds that merge open the way
// `cache-warmer.test.ts`'s `recordingGit({ hold })` holds `ls-remote`,
// long enough to observe the job mid-landing.
describe("a step reads busy for the whole landing window (spec 254)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPEC = "81-queue-and-runner";

  function own(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    return dir;
  }

  function repos(dir: string): { root: string; specs: string } {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    const specs = join(dir, "aide-specs");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(project, "specs", SPEC), { recursive: true });
    writeFileSync(join(project, "specs", SPEC, "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", SPEC, "4-status.md"), statusSaying(["create", "analyze"]));
    mkdirSync(specs, { recursive: true });
    return { root: projectsRoot, specs };
  }

  /** A git whose merge does not return until `release()` is called — the
   *  window between a step's own result arriving and the merge that
   *  lands it actually resolving, held open long enough to observe it. */
  function heldGit() {
    const calls: { dir: string; args: string[] }[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) {
        await gate;
        return { code: 0, stdout: "" };
      }
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls, release: () => release() };
  }

  async function runStep(base: string, specFolder: string, step: string): Promise<{ id: string }> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder, steps: [step] }),
      })
    ).json()) as { job: { id: string } };
    return made.job;
  }

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 100; n++) {
      const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
        job: Record<string, unknown>;
      };
      if (done(body.job)) return body.job;
      await Bun.sleep(50);
    }
    throw new Error("the job never settled");
  }

  function serverWithHeldMerge(dir: string, paths: { root: string }, git: { run: GitRunner }) {
    const results = join(dir, "jobs");
    mkdirSync(results, { recursive: true });
    return { ...harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        gitRun: git.run,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
      },
    }), results };
  }

  const ANALYZE_RESULT = (specs: string) => ({
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: `aide/${SPEC}`,
    repos: [],
    branchUrls: [{ root: specs, url: "https://example.test/aide-specs" }],
  });

  // Criteria 1 and 2. `job.landing` is already true the instant the
  // step's own result arrives — well before the merge below returns.
  test("mid-landing the job reads landing:true and a same-spec enqueue is refused", async () => {
    const dir = own("aide-254-landing-");
    const paths = repos(dir);
    const git = heldGit();
    const { base, results } = serverWithHeldMerge(dir, paths, git);

    const job = await runStep(base, SPEC, "analyze");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ANALYZE_RESULT(paths.specs)));

    const midLanding = await settle(base, job.id, (j) => j.state === "done");
    expect(midLanding.landing).toBe(true);

    const refused = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["implement"] }),
    });
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error?: string };
    expect(String(body.error ?? "")).toContain(SPEC);

    git.release();
    await settle(base, job.id, (j) => !j.landing);
  });

  // Criterion 5. A newer job that has already settled (cancelled, in
  // this case) must not push a still-landing job out of the lead slot
  // by coincidence of sort order.
  test("the single-spec page picks the still-landing job as lead, not a newer settled one", async () => {
    const dir = own("aide-254-lead-");
    const paths = repos(dir);
    const git = heldGit();
    const { base, results } = serverWithHeldMerge(dir, paths, git);

    const job = await runStep(base, SPEC, "analyze");
    // Wait for the analyze job to actually start, so the decoy below is
    // enqueued — and therefore timestamped — after it.
    await settle(base, job.id, (j) => j.state === "running");
    const decoy = await runStep(base, SPEC, "implement");
    const cancelled = await fetch(`${base}/api/queue/${decoy.id}/cancel`, { method: "POST", headers: AUTH });
    expect(cancelled.status).toBe(200);
    await settle(base, decoy.id, (j) => j.state === "cancelled");

    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ANALYZE_RESULT(paths.specs)));
    await settle(base, job.id, (j) => j.state === "done");

    const html = await (await fetch(`${base}/specs/aide/${SPEC}`, { headers: AUTH })).text();
    const banner = html.match(/<div class="pagehead">([\s\S]*?)<span class="row">/)?.[1] ?? "";
    expect(banner).toContain('class="badge b-done">');
    expect(banner).not.toContain('b-idle">cancelled');

    git.release();
    await settle(base, job.id, (j) => !j.landing);
  });
});
// --- spec 99: one merge at a time, the view survives, a refusal is seen -----

// Pressing Merge on two specs one after the other, with nothing else
// running, answered "cannot fast-forward main in …/aide-specs — merge
// it by hand" between the clicks: both requests share one checkout and
// fought over its index.lock. Both went through on a retry, which is
// what says it was a race and not a divergence.
//
// Spec 149 removed the button and made the collision likelier, not
// rarer: four steps land themselves now, and two specs sharing one
// specs repo can finish within seconds of each other under queue
// concurrency. So the same measurement is taken over two LANDINGS.
describe("two landings against one repo run one at a time (criteria 6, 10)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SHARED_REPO = "/repos/aide-specs";
  const SECOND_SPEC = "82-second-spec";

  /** A git slow enough to overlap, that counts how many mutating calls
   *  are in flight against one root at once. `switch`, `pull`, `merge`
   *  and `push` are the four that touch the checkout — a second one
   *  arriving while the first is unfinished is precisely the collision. */
  function gitCounting() {
    const MUTATING = new Set(["switch", "pull", "merge", "push"]);
    let inFlight = 0;
    let peak = 0;
    const run = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      const mutating = MUTATING.has(args[0]!);
      if (mutating) {
        inFlight++;
        peak = Math.max(peak, inFlight);
      }
      await new Promise((r) => setTimeout(r, 5));
      if (mutating) inFlight--;
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, peak: () => peak };
  }

  test("neither landing ever sees the other mid-merge, and both go through (criterion 6)", async () => {
    const results = mkdtempSync(join(tmpdir(), "aide-lock-results-"));
    ownDirs.push(results);
    const git = gitCounting();
    const { base } = start(
      {
        queueToken: TOKEN,
        gitRun: git.run,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
        queueConcurrency: 2,
      },
      [],
      [SECOND_SPEC],
    );

    // Two analyze steps on two specs, both landing in the SAME specs
    // repo — which every spec shares, because every spec's plan lives
    // in the specs root.
    const settled = await Promise.all(
      ["81-queue-and-runner", SECOND_SPEC].map(async (specFolder) => {
        const made = (await (
          await fetch(`${base}/api/queue`, {
            method: "POST",
            headers: AUTH,
            body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
          })
        ).json()) as { job: { id: string } };
        writeFileSync(
          join(results, `${made.job.id}.json`),
          JSON.stringify({
            ok: true,
            exitCode: 0,
            costUsd: 0.1,
            costMeasured: true,
            terminalReason: "completed",
            branch: `aide/${specFolder}`,
            branchUrls: [{ root: SHARED_REPO, url: "https://example.test/aide-specs" }],
            repos: [],
          }),
        );
        for (let n = 0; n < 100; n++) {
          const body = (await (await fetch(`${base}/api/queue/${made.job.id}`, { headers: AUTH })).json()) as {
            job: Record<string, unknown>;
          };
          if (body.job.state === "done" && !body.job.landing) return body.job;
          await Bun.sleep(50);
        }
        throw new Error("the job never settled");
      }),
    );

    for (const job of settled) expect(job.error).toBeFalsy();
    // Both landed: the branch each job advertised is gone from its row.
    for (const job of settled) expect(job.branchUrls).toEqual([]);
    expect(git.peak()).toBe(1);
  });
});

// The lock is a map of chained promises, and a map a long-running
// server never empties is a map that grows for as long as it is up.
describe("the per-repo lock lets go once its chain has settled (criterion 10)", () => {
  test("work for one root is serialized, in the order it was asked for", async () => {
    const lock = createRootLock();
    const order: string[] = [];
    const slow = (name: string, ms: number) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      return name;
    };
    const both = Promise.all([lock.run("/repo", slow("a", 20)), lock.run("/repo", slow("b", 1))]);
    expect(await both).toEqual(["a", "b"]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  test("two different roots do not wait for each other", async () => {
    const lock = createRootLock();
    let peak = 0;
    let inFlight = 0;
    const job = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    };
    await Promise.all([lock.run("/a", job), lock.run("/b", job)]);
    expect(peak).toBe(2);
  });

  test("the map holds nothing once the last request for a root is done", async () => {
    const lock = createRootLock();
    await Promise.all([
      lock.run("/repo", async () => new Promise((r) => setTimeout(r, 5))),
      lock.run("/repo", async () => new Promise((r) => setTimeout(r, 5))),
      lock.run("/other", async () => new Promise((r) => setTimeout(r, 5))),
    ]);
    // One turn of the microtask queue for the cleanup that runs after
    // the last chain settles.
    await new Promise((r) => setTimeout(r, 0));
    expect(lock.size).toBe(0);
  });

  test("one turn throwing does not poison the next", async () => {
    const lock = createRootLock();
    const failed = lock.run("/repo", async () => {
      throw new Error("git blew up");
    });
    await expect(failed).rejects.toThrow("git blew up");
    expect(await lock.run("/repo", async () => "fine")).toBe("fine");
  });
});

// "All" + "Spec, descending" survived the five-second refresh but not an
// action: every POST answered 303 to the bare list address, so pressing any
// button dropped the reader back into the default view.
describe("an action keeps the page's view (criterion 7)", () => {
  const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
  const VIEW = { "view.state": "active", "view.sort": "cost", "view.dir": "desc" };

  const post = (base: string, path: string, fields: Record<string, string>) =>
    fetch(`${base}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams(fields),
    });

  /** One job in the mirror, in the state the test needs it. */
  async function seededJob(state: string): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
        body: JSON.stringify(JOB),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    jobs.find((j) => j.id === made.job.id)!.state = state;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  test("Run carries the view forward on success", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await post(base, "/api/queue", {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "analyze",
      ...VIEW,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?state=active&sort=cost&dir=desc");
  });

  test("Run carries the view forward on a refusal too", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await post(base, "/api/queue", { project: "nope", specFolder: "x", steps: "analyze", ...VIEW });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/?state=active&sort=cost&dir=desc&error=")).toBe(true);
  });

  test("Cancel carries the view forward", async () => {
    const { mirror, id } = await seededJob("running");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const res = await post(base, `/api/queue/${id}/cancel`, VIEW);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?state=active&sort=cost&dir=desc");
  });

  // The exact assertion spec 81 wrote: with nothing to carry, the
  // redirect is `/` and not `/?`.
  test("with no view submitted the redirect stays exactly /", async () => {
    const { mirror, id } = await seededJob("running");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const res = await post(base, `/api/queue/${id}/cancel`, {});
    expect(res.headers.get("location")).toBe("/");
  });
});

// A refusal landed on the page that followed the redirect, at the top,
// belonging to no row — and serve.log had no line for any refusal at
// all on the day this was written.
describe("a refusal names its spec and reaches the log (criteria 8, 9, 11)", () => {
  const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
  const SPEC = "aide/81-queue-and-runner";

  /** `console.error` for the duration of one test. serve.log is both
   *  streams of the same launchd job, so the call IS the log line. */
  async function capturingLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      return { result: await fn(), lines };
    } finally {
      console.error = original;
    }
  }

  // Spec 106's own chain — git says "conflict", and the row ends up
  // showing it — used to run through this redirect, and was
  // tested here. Since spec 149 the reason is stored on the JOB instead,
  // because a landing has no browser to redirect; the chain is covered
  // end to end in "every step lands its own work" above.

  test("an enqueue refusal names the spec it was for (criterion 9)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const { result: res, lines } = await capturingLog(() =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: FORM,
        body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "nonsense" }),
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(`errorSpec=${encodeURIComponent(SPEC)}`);
    expect(lines.join("\n")).toContain(SPEC);
  });

  // Spec 101: the page stopped navigating on a refusal, so the row it
  // belongs to is now picked out from the JSON body rather than from a
  // redirect the server built. Merge already said which spec; Run and
  // approve said only why, which left three of the four actions with no
  // row to land on.
  test("a refused Run says which spec it was for, to a JSON caller too", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ ...JOB, steps: ["nonsense"] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ spec: SPEC });
  });

  // Criterion 9: the script above these forms is an enhancement, never
  // the mechanism. A browser with JavaScript off posts the form itself
  // and must still get the 303 back to the list.
  test("a form post with no JSON accept header still gets its 303", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const run = await fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
    });
    expect(run.status).toBe(303);
    const id = (JSON.parse(readFileSync(join(dir, "queue.json"), "utf-8")) as { id: string }[])[0]!.id;
    const cancelled = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ "view.state": "active" }),
    });
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.get("location")).toContain("state=active");
    const created = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ project: "aide", title: "", description: "" }),
    });
    expect(created.status).toBe(303);
  });

});
