import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
  parseArgs,
  runnerArgv,
} from "../../src/serve/serve.ts";
import { createGitRunner, type GitRunner } from "../../src/git/branch-status.ts";
import { ensureDashboardCheckout } from "../../src/git/dashboard-checkout.ts";
import { failFetch, ran, statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});


// Spec 205: the dashboard works in checkouts of its own.
//
// A run was cut from the same checkout a person edits, and the two
// collided — on 2026-08-23 three specs were archived with their code
// stranded on a branch. Everything that MUTATES a checkout now resolves
// to a clone the dashboard owns; the person's own checkout at
// `<projectsRoot>/<project>` is what the display reads and nothing else.
//
// Real git here, unlike the rest of this suite: what is under test is
// which working tree a commit lands in, and a fake that ignores the
// directory it was handed could not tell the two apart.
describe("the dashboard works in checkouts of its own (spec 205)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  function git(cwd: string, ...args: string[]): string {
    const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
    return out.stdout.toString();
  }

  /** A projects root holding ONE real project — a bare origin, and a
   *  clone of it standing in for the checkout a person edits. The
   *  harness's own fixture is a plain directory, and this suite needs a
   *  repository with a remote to clone from. */
  function realProject(): { projectsRoot: string; person: string; owned: string; site: string } {
    const where = mkdtempSync(join(tmpdir(), "aide-205-"));
    ownDirs.push(where);
    const seed = join(where, "seed");
    mkdirSync(join(seed, ".aide"), { recursive: true });
    writeFileSync(join(seed, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(seed, "specs", "81-queue-and-runner"), { recursive: true });
    writeFileSync(join(seed, "specs", "81-queue-and-runner", "1-description.md"), "# Queue - Description\n\nAs it was.\n");
    writeFileSync(join(seed, "specs", "81-queue-and-runner", "4-status.md"), statusSaying(["create"]));
    git(seed, "init", "-q", "-b", "main");
    git(seed, "config", "user.name", "Test");
    git(seed, "config", "user.email", "test@example.com");
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", "first");
    const origin = join(where, "aide.git");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", seed, origin] });
    const projectsRoot = join(where, "root");
    mkdirSync(projectsRoot, { recursive: true });
    const person = join(projectsRoot, "aide");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, person] });
    git(person, "config", "user.name", "Test");
    git(person, "config", "user.email", "test@example.com");
    const site = join(where, "site");
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, "projects.html"), "<p>overview</p>");
    return { projectsRoot, person, owned: join(where, "owned"), site };
  }

  /** The real runner, wrapped so a test can say which directories the
   *  server ran git in. */
  function recording(): { run: GitRunner; calls: { dir: string; args: string[] }[] } {
    const real = createGitRunner();
    const calls: { dir: string; args: string[] }[] = [];
    return {
      calls,
      run: async (dir, args) => {
        calls.push({ dir, args });
        return real(dir, args);
      },
    };
  }

  // Criterion 6, and the whole point: `--project-dir` is what decides
  // which checkout a run branches, switches and cuts its worktree from.
  test("the runner is pointed at the dashboard's own checkout, never the person's", () => {
    const job = {
      id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
      budgetUsd: 5, model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide-dashboard-checkouts/aide/code",
      push: "branch",
    });
    expect(argv[argv.indexOf("--project-dir") + 1]).toBe("/home/dev/aide-dashboard-checkouts/aide/code");
  });

  // Named on the command line, because the serving host is where these
  // clones actually take up disk and the default is a directory under
  // $HOME.
  test("the checkout root is a flag, and defaults to nothing the server invents", () => {
    expect(parseArgs(["--site", "/s", "--dashboard-checkouts", "/data/owned"]).dashboardCheckoutRoot).toBe(
      "/data/owned",
    );
    expect(parseArgs(["--site", "/s"]).dashboardCheckoutRoot).toBeUndefined();
  });

  // Criterion 8: eagerly, so no project ever pays a full clone inside
  // the request that first needs it.
  test("Add makes the dashboard's own checkout before anything asks for one", async () => {
    const { projectsRoot, site, owned } = realProject();
    const originOfSecond = join(projectsRoot, "..", "aide.git");
    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name: "second", gitUrl: originOfSecond }),
      });
      expect(res.status).toBe(200);
      expect(existsSync(join(owned, "second", "code", ".git"))).toBe(true);
    } finally {
      server.stop();
    }
  });

  // Criteria 1, 2 and 4, in the shape of the incident itself: the
  // person is mid-edit on a branch of their own when the dashboard
  // writes.
  test("a Save writes in the dashboard's own checkout and leaves the person's alone", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    // Exactly what a run used to refuse over, and used to trample.
    git(person, "switch", "-q", "-c", "wip");
    writeFileSync(join(person, "specs", "81-queue-and-runner", "1-description.md"), "# Mine, half-written\n");
    const before = git(person, "status", "--porcelain=v1", "--branch");
    const recorded = recording();
    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, gitRun: recorded.run,
    });
    try {
      // Through the form, not around it: the hidden `baseSha` is the
      // commit the save compares against, and reading it off the page
      // proves the form and the save agree about WHICH checkout that
      // commit came out of.
      const form = await (
        await fetch(`http://127.0.0.1:${server.port}/specs/aide/81-queue-and-runner?tab=description`, {
          headers: { "x-aide-token": TOKEN },
        })
      ).text();
      const baseSha = /name="baseSha" value="([^"]*)"/.exec(form)?.[1] ?? "";
      expect(baseSha).not.toBe("");
      const res = await fetch(
        `http://127.0.0.1:${server.port}/api/queue/specs/aide/81-queue-and-runner/save`,
        {
          method: "POST",
          headers: { "x-aide-token": TOKEN, "content-type": "application/json" },
          redirect: "manual",
          body: JSON.stringify({
            text: "# Queue - Description\n\n## Description\n\nSaved by the dashboard.\n",
            baseSha,
          }),
        },
      );
      expect(res.status).toBe(303);
      // The dashboard's own copy carries the edit...
      const saved = join(owned, "aide", "code", "specs", "81-queue-and-runner", "1-description.md");
      expect(readFileSync(saved, "utf-8")).toContain("Saved by the dashboard");
      // ...and the person's half-written file is still theirs, on their
      // own branch, with nothing committed under them.
      expect(readFileSync(join(person, "specs", "81-queue-and-runner", "1-description.md"), "utf-8")).toBe(
        "# Mine, half-written\n",
      );
      expect(git(person, "status", "--porcelain=v1", "--branch")).toBe(before);
      // And nothing their directory was ever asked can CHANGE it.
      //
      // The one question this design rests on is still there — which
      // origin to clone the dashboard's own checkout from — and since
      // spec 208 the cache schedule asks the person's spec folders the
      // same read-only questions the page render used to ask them
      // inside a request. That is the same reading, on a clock; what
      // spec 205 exists to prevent is a WRITE, and the list below is
      // every verb that would be one.
      const asked = recorded.calls
        .filter((c) => c.dir === person || c.dir.startsWith(`${person}/`))
        .map((c) => c.args.join(" "));
      expect(asked).toContain("remote get-url origin");
      const writes = ["checkout", "switch", "merge", "commit", "push", "add", "fetch", "reset", "clean"];
      expect(asked.filter((a) => writes.includes(a.split(" ")[0]!))).toEqual([]);
    } finally {
      server.stop();
    }
  });

  /** Poll until `check` says yes, or give up. Nothing here can be
   *  awaited directly: what is under test is a background tick. */
  async function until(check: () => boolean, budgetMs = 5000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return check();
  }

  // Spec 216: a run starts from a checkout that is current.
  //
  // `ensureCheckout` handed a caller the bring-up-to-date already in
  // flight for that project, and a fetch that began before a push
  // answers with the picture from before it. Spec 215 was pushed,
  // queued, and refused as `unknown spec` (2026-08-23).
  //
  // This is about the WIRING, not the primitive: `get` and `fresh` are
  // two methods on one object, so `tickRunner` calling the wrong one
  // type-checks and every `CheckoutEnsurer` unit test goes on passing.
  // What is asserted is what the spawned STEP actually saw on disk.
  test("a step is not started from a checkout older than the job (spec 216)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const ownedCode = join(owned, "aide", "code");

    // Made before the server starts, so the boot-time warm is a FETCH
    // rather than a clone — that fetch is the one held open below.
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);

    let releaseFetch = (): void => {};
    const held = new Promise<void>((r) => (releaseFetch = r));
    let holding = false;
    let heldOnce = false;
    const real = createGitRunner();
    // The answer is TAKEN before the push and delivered after it.
    // Delaying the call instead would fetch the push itself, which is
    // the one thing this race is not.
    const gated: GitRunner = async (dir, args, timeoutMs) => {
      const result = await real(dir, args, timeoutMs);
      if (args[0] === "fetch" && dir === ownedCode && !heldOnce) {
        heldOnce = true;
        holding = true;
        await held;
        holding = false;
      }
      return result;
    };

    // The step itself, standing in for `aide-run-spec`: it records
    // whether the checkout it was pointed at had the pushed commit.
    const record = join(site, "what-the-step-saw.txt");
    const bin = join(site, "fake-run-spec");
    writeFileSync(
      bin,
      `#!/bin/sh\nif [ -f "$2/pushed.md" ]; then echo current > ${record}; else echo stale > ${record}; fi\n`,
      { mode: 0o755 },
    );

    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, gitRun: gated,
      queueRunnerBin: bin, queueResultDir: join(site, "jobs"),
    });
    try {
      // The boot-time warm's bring-up-to-date, in flight and going
      // nowhere: the "unrelated caller" of the incident.
      expect(await until(() => holding)).toBe(true);

      // Somebody pushes — after that fetch took its picture.
      writeFileSync(join(person, "pushed.md"), "on origin before the job was queued\n");
      git(person, "add", "-A");
      git(person, "commit", "-qm", "pushed");
      git(person, "push", "-q", "origin", "main");

      // Not awaited: enqueueing ticks the runner in the request itself,
      // and that tick is the caller this spec is about — it is still
      // holding on the stale fetch, which is exactly the state the fix
      // has to survive.
      const posted = fetch(`http://127.0.0.1:${server.port}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }),
      });
      await new Promise((r) => setTimeout(r, 500));
      releaseFetch();
      expect((await posted).status).toBe(200);

      expect(await until(() => existsSync(record), 25000)).toBe(true);
      expect(readFileSync(record, "utf-8").trim()).toBe("current");
    } finally {
      releaseFetch();
      server.stop();
    }
  }, 45000);

  // Spec 218: what the list SHOWS and what a run can actually resolve
  // were two different directories.
  //
  // `aide-run-spec` resolves `--spec` against the clone the dashboard
  // owns; the walk that enumerated spec folders read the checkout a
  // person edits. A folder committed there and never pushed therefore
  // got a row, with every step on it offered — and every one of them
  // refused with `unknown spec: <folder> (not under
  // <dashboard-checkout>/specs/<project>)`.
  //
  // Real git again, and for the same reason as the rest of this block:
  // what is under test is which working tree the FOLDERS were read
  // from, and a fake that ignores its directory cannot tell two
  // checkouts apart.

  /** A page's HTML, through the token like a reader's browser. */
  const page = async (base: string, path: string): Promise<string> =>
    await (await fetch(`${base}${path}`, { headers: { "x-aide-token": TOKEN } })).text();

  /** Fetch a page until it says what is expected, and hand back the
   *  last thing it said either way.
   *
   *  Polling rather than one request, because the answer moves twice on
   *  purpose: the dashboard's own checkout is resolved by a background
   *  ensure (spec 205), and a page rendered before it settles falls
   *  back to the person's own list — which is criterion 3, not a
   *  failure. What is asserted is where it ARRIVES. */
  async function untilPage(
    base: string,
    path: string,
    says: (html: string) => boolean,
    budgetMs = 15000,
  ): Promise<string> {
    const deadline = Date.now() + budgetMs;
    let last = "";
    while (Date.now() < deadline) {
      last = await page(base, path);
      if (says(last)) return last;
      await new Promise((r) => setTimeout(r, 50));
    }
    return last;
  }

  /** Wait until the recorded git calls stop arriving, so a count taken
   *  afterwards is the REQUEST's own and not a tick's tail. */
  async function quiet(calls: unknown[], stillMs = 300, budgetMs = 20000): Promise<void> {
    const deadline = Date.now() + budgetMs;
    let seen = -1;
    let since = Date.now();
    while (Date.now() < deadline) {
      if (calls.length !== seen) {
        seen = calls.length;
        since = Date.now();
      } else if (Date.now() - since >= stillMs) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** A spec folder pushed to origin from a clone of its own, so the
   *  person's checkout never has it: a spec somebody else pushed, which
   *  is the only way to tell "listed from origin" apart from "listed
   *  from the person's disk". */
  function pushSpecToOrigin(projectsRoot: string, folder: string): void {
    const scratch = mkdtempSync(join(tmpdir(), "aide-218-push-"));
    ownDirs.push(scratch);
    const clone = join(scratch, "aide");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", join(projectsRoot, "..", "aide.git"), clone] });
    git(clone, "config", "user.name", "Somebody Else");
    git(clone, "config", "user.email", "else@example.com");
    mkdirSync(join(clone, "specs", folder), { recursive: true });
    writeFileSync(join(clone, "specs", folder, "1-description.md"), `# ${folder} - Description\n\nPushed.\n`);
    writeFileSync(join(clone, "specs", folder, "4-status.md"), statusSaying(["create"]));
    git(clone, "add", "-A");
    git(clone, "commit", "-qm", `add ${folder}`);
    git(clone, "push", "-q", "origin", "main");
  }

  /** Committed where a person works and pushed nowhere — the spec the
   *  list used to offer and every step used to refuse. */
  function commitSpecUnpushed(person: string, folder: string): void {
    mkdirSync(join(person, "specs", folder), { recursive: true });
    writeFileSync(join(person, "specs", folder, "1-description.md"), `# ${folder} - Description\n\nMine only.\n`);
    writeFileSync(join(person, "specs", folder, "4-status.md"), statusSaying(["create"]));
    git(person, "add", "-A");
    git(person, "commit", "-qm", `add ${folder}`);
  }

  // Criteria 1, 2 and 6: the unpushed folder is hidden and the pushed
  // one is listed, on the page a reader actually reads a spec list from.
  test("a spec only the person has is not listed, and one the dashboard has is (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);
    commitSpecUnpushed(person, "990-only-in-my-checkout");

    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const html = await untilPage(base, "/", (h) => !h.includes("990-only-in-my-checkout"));
      expect(html).not.toContain("990-only-in-my-checkout");
      expect(html).toContain("81-queue-and-runner");
    } finally {
      server.stop();
    }
  }, 30000);

  // The same walk feeds the overview's counts, so they move with it: a
  // project's row said two specs while only one of them could be run.
  test("the projects overview counts what the dashboard has, not what the person has (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);
    commitSpecUnpushed(person, "991-only-in-my-checkout");

    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const html = await untilPage(base, "/projects", (h) => h.includes("1 active · 0 archived"));
      expect(html).toContain("1 active · 0 archived");
      expect(html).not.toContain("991-only-in-my-checkout");
    } finally {
      server.stop();
    }
  }, 30000);

  // Criterion 3: a project whose own checkout CANNOT be made keeps
  // working exactly as it did before spec 205 — the same fallback
  // `machinerySpecDir` and `peekMachinerySpecDir` already take.
  test("a project with no checkout of its own is listed from the person's, as before (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    commitSpecUnpushed(person, "992-only-in-my-checkout");
    // The one question the clone rests on, refused: there is nothing to
    // clone from, so no checkout of the dashboard's own is ever
    // resolved. Nothing else is touched.
    const real = createGitRunner();
    const noOrigin: GitRunner = async (dir, args, timeoutMs) =>
      args.join(" ") === "remote get-url origin" ? { code: 1, stdout: "" } : await real(dir, args, timeoutMs);

    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0, gitRun: noOrigin,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      expect(existsSync(join(owned, "aide", "code", ".git"))).toBe(false);
      const html = await page(base, "/");
      expect(html).toContain("81-queue-and-runner");
      // Not hidden, and not an empty list either: the person's own
      // checkout is all there is to read here.
      expect(html).toContain("992-only-in-my-checkout");
    } finally {
      server.stop();
    }
  }, 30000);

  // Criterion 4: a project with NOTHING queued. `tickRunner`'s own
  // per-project refresh (spec 216) never fires for one, so before this
  // spec its checkout was fetched once at boot and never again — a spec
  // pushed from another machine would have sat unlisted for as long as
  // the server ran.
  test("a spec pushed with no job queued is listed within one poll (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);

    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0, specCachePollMs: 250,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      // The boot-time ensure has settled and the page is answering.
      expect(await untilPage(base, "/", (h) => h.includes("81-queue-and-runner"))).toContain(
        "81-queue-and-runner",
      );
      // Somebody else pushes. The person's own checkout never hears
      // about it, so the person's list cannot be where this comes from.
      pushSpecToOrigin(projectsRoot, "993-pushed-by-somebody-else");
      expect(existsSync(join(person, "specs", "993-pushed-by-somebody-else"))).toBe(false);

      const html = await untilPage(base, "/", (h) => h.includes("993-pushed-by-somebody-else"), 25000);
      expect(html).toContain("993-pushed-by-somebody-else");
    } finally {
      server.stop();
    }
  }, 45000);

  // Criterion 5, and spec 208's rule kept: the fetch that made the row
  // appear happened on the schedule. The request that shows it spawns
  // no git of its own.
  test("the request that lists the dashboard's own specs spawns no git (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);
    pushSpecToOrigin(projectsRoot, "994-pushed-by-somebody-else");
    const recorded = recording();

    // One tick and then nothing for a hundred seconds, exactly as spec
    // 208's own suite does it: the schedule cannot fire again while the
    // request is in flight, so the count taken across it is the
    // request's.
    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0, specCachePollMs: 100_000, gitRun: recorded.run,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      expect(await untilPage(base, "/", (h) => h.includes("994-pushed-by-somebody-else"))).toContain(
        "994-pushed-by-somebody-else",
      );
      await quiet(recorded.calls);
      const before = recorded.calls.length;
      const html = await page(base, "/");
      expect(html).toContain("994-pushed-by-somebody-else");
      expect(recorded.calls.length).toBe(before);
    } finally {
      server.stop();
    }
  }, 45000);
});

// Spec 208: a render reads memory and disk, and nothing else.
//
// This has been introduced three times — spec 178 wrote the rule and
// was never merged, spec 203 fixed `/projects`, and spec 193 put a
// network `ls-remote` back on `/` the next day. So it is asserted here
// rather than left to care: the request path spawns NO git, warm or
// cold, and a cold page says what it does not know instead of holding
// the reader.
describe("no render path runs git or a network command (spec 208)", () => {
  /** Everything the render could conceivably ask git, recorded. The
   *  checkout the dashboard makes for itself is a background job of its
   *  own (spec 205) and is started at boot, not by a request — so the
   *  count is taken across a request rather than over the process. */
  function recording() {
    const calls: { dir: string; args: string[] }[] = [];
    const run: GitRunner = async (dir, args) => {
      calls.push({ dir, args });
      const line = args.join(" ");
      if (args[0] === "ls-remote") return { code: 0, stdout: "" };
      if (line.startsWith("log --format=%aI")) return { code: 0, stdout: "2026-08-17T09:00:00+02:00\n" };
      if (line.startsWith("log -1 --format=%H")) {
        return { code: 0, stdout: "deadbee\t2026-08-18T09:10:36+02:00\n" };
      }
      if (line.startsWith("log --all")) return { code: 0, stdout: "" };
      return { code: 1, stdout: "" };
    };
    return { run, calls };
  }

  const get = async (base: string, path: string): Promise<Response> =>
    await fetch(`${base}${path}`, { headers: { "x-aide-token": TOKEN } });

  async function until(check: () => boolean, budgetMs = 2000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return check();
  }

  // Criterion 5: the schedule is off, so nothing has ever been warmed —
  // and the pages still answer, with no git spawned by the request.
  test("cold, GET / and GET /?rows=1 spawn nothing and say what they do not know", async () => {
    const git = recording();
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
      archivedSpecs: { "77-old-thing": {} },
    });
    const before = git.calls.length;
    const html = await (await get(base, "/")).text();
    expect(git.calls.length).toBe(before);
    // Not a false "nothing has run": the row says the answer is not in
    // yet. This is the shape spec 178's own plan review flagged.
    expect(html).toContain("checking…");
    const rows = await (await get(base, "/?rows=1")).text();
    expect(git.calls.length).toBe(before);
    expect(rows).toContain("checking…");
  });

  // Criterion 6.
  test("warm, GET / spawns nothing of its own and shows the warmed answers", async () => {
    const git = recording();
    // One tick and then nothing for a hundred seconds: the schedule
    // cannot fire again while the request is in flight, so the count
    // taken across it is the REQUEST's own and nobody else's.
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 100_000 },
    });
    await until(() => git.calls.some((c) => c.args.join(" ").startsWith("log --format=%aI")));
    await new Promise((r) => setTimeout(r, 100));
    const before = git.calls.length;
    const html = await (await get(base, "/")).text();
    expect(git.calls.length).toBe(before);
    expect(html).not.toContain("checking…");
  });

  // Criterion 8. It asked `/archive` until spec 221 retired that page;
  // the rows are on the Specs list now, behind the chip that shows
  // them, and the rule they have to keep is the same one — peek, never
  // take, on the request path.
  test("cold, an archived row renders with a checking date rather than blocking on git", async () => {
    const git = recording();
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
      // No `Archived:` stamp on disk, so the date is git's to answer —
      // which is exactly the row that used to reach `lastCommitOf`.
      archivedSpecs: { "77-old-thing": { status: "# Status\n" } },
    });
    const before = git.calls.length;
    const res = await get(base, "/?state=archived");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(git.calls.length).toBe(before);
    expect(html).toContain("checking…");
  });

  // Criterion 9: the dashboard's own clone (spec 205) is started at
  // boot and takes seconds. A spec page opened before it lands falls
  // back to the person's own checkout instead of waiting for it.
  test("a spec page does not wait for the dashboard's own clone", async () => {
    let releaseClone = (): void => {};
    const held = new Promise<void>((r) => (releaseClone = r));
    const git = recording();
    const slowClone: GitRunner = async (dir, args) => {
      if (args[0] === "clone") await held;
      return git.run(dir, args);
    };
    const { base } = harness.start({
      extra: { gitRun: slowClone, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
    });
    const started = Date.now();
    const res = await get(base, "/specs/aide/81-queue-and-runner");
    const took = Date.now() - started;
    releaseClone();
    expect(res.status).toBe(200);
    // Well under a real clone, which measured 4.3 s for this very repo.
    expect(took).toBeLessThan(1500);
    expect(await res.text()).toContain("81-queue-and-runner");
  });

  // Criterion 10: the one cache a sweep over the live list cannot fill —
  // an archived spec's page is a real render path too. It fills itself
  // from the request, without the request ever waiting on it.
  test("a spec page's file stamps fill in behind the request, never during it", async () => {
    const git = recording();
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
    });
    const before = git.calls.length;
    // A document tab since spec 212: Overview carries no file text, so
    // the stamps this is about are on the tabs that do.
    const first = await (await get(base, "/specs/aide/81-queue-and-runner?tab=analysis")).text();
    // The stamps are not known yet, and the page says so rather than
    // holding for four `git log`s.
    expect(first).toContain("checking…");
    expect(first).not.toContain("deadbee");
    // The fire-and-forget fill did run — it was simply never awaited.
    expect(await until(() => git.calls.length > before)).toBe(true);
    let second = "";
    for (let i = 0; i < 40 && !second.includes("deadbee"); i += 1) {
      second = await (await get(base, "/specs/aide/81-queue-and-runner?tab=analysis")).text();
      if (!second.includes("deadbee")) await new Promise((r) => setTimeout(r, 25));
    }
    expect(second).toContain("deadbee");
  });

  const pipKind = (html: string, step: string): string =>
    html.match(new RegExp(`<span class="pip ([a-z]+)"[^>]* title="${step}">`))?.[1] ?? "";

  // Spec 241, criterion 5: `targets()` deliberately excludes an archived
  // spec (spec 150), so `specPageView()`'s old `done: target?.done ?? []`
  // always collapsed to `[]` for one — every phase but `create` (which is
  // coloured from `phases` alone) read `todo` regardless of what the
  // spec's own `4-status.md` claims. The fix trusts that file's claim for
  // an archived spec, the same source `archivedSteps()` already trusts
  // for the front page's archived rows (spec 224).
  test("an archived spec's Overview tab shows all four phases as past, not just create (criterion 5)", async () => {
    const { base } = harness.start({
      extra: { queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
      archivedSpecs: {
        "77-old-thing": { status: statusSaying(["create", "analyze", "implement", "archive"]) },
      },
    });
    const html = await (await get(base, "/specs/aide/77-old-thing")).text();
    expect(pipKind(html, "create")).toBe("past");
    expect(pipKind(html, "analyze")).toBe("past");
    expect(pipKind(html, "implement")).toBe("past");
    expect(pipKind(html, "archive")).toBe("past");
  });

  // Spec 241, criterion 6: a regression guard for the branch above — a
  // LIVE spec must keep reading `done` from `target?.done` (the
  // git-verified `workflowHistory`), never from the file's own claim.
  // Not expected to be RED on its own: the live branch of the new `done:`
  // line is byte-for-byte unchanged, but nothing before this task fetched
  // ANY spec's Overview tab through a real route and inspected its pips —
  // so a broken conditional (e.g. an inverted `ref?.archived` check) would
  // otherwise pass unnoticed.
  test("a live spec's Overview tab still reads its pips from its own git-verified history (criterion 6)", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 40 },
      status: statusSaying(["create", "analyze", "implement", "archive"]),
    });
    ran(dir, ["create", "analyze"]);
    await new Promise((r) => setTimeout(r, 100));
    const html = await (await get(base, "/specs/aide/81-queue-and-runner")).text();
    expect(pipKind(html, "create")).toBe("past");
    expect(pipKind(html, "analyze")).toBe("past");
    expect(pipKind(html, "implement")).toBe("todo");
    expect(pipKind(html, "archive")).toBe("todo");
  });
});
