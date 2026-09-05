// What a landing into the dashboard's OWN checkout does: install, log,
// and ask for a restart rather than firing one — and what it does for
// every other project, which is neither.
//
// Split out of every-step-basic-landing.test.ts 2026-09-04; the tests
// are unchanged and keep their names.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pickRefusal } from "../../../src/serve/land-branch/merge.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";


import { AUTH, createOwnDirs, gitFor, repos, installs, runStep, serverWith, settle, merges, stepWithResult } from "./every-step-lands-fixtures.ts";

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

describe("a landing that installs and asks for a restart", () => {
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
  // A retry that merely refused again used to overwrite the first
  // refusal ("main moved on origin under this landing twice") with its
  // own ("cannot fast-forward main") — the words that said what
  // happened were gone (364, 2026-09-03).
  test("pickRefusal keeps the first refusal's words unless a retry reached a verdict", () => {
    const first = { root: "/r", ok: false, error: "main moved on origin under this landing twice", detail: "rejected" };
    const again = { root: "/r", ok: false, error: "cannot fast-forward main" };
    expect(pickRefusal(first, again)).toEqual({ ...again, error: first.error, detail: "rejected", reason: undefined });
    const conflict = { root: "/r", ok: false, error: "cannot merge — conflict", reason: "conflict" as const };
    expect(pickRefusal(first, conflict)).toBe(conflict);
    const fine = { root: "/r", ok: true };
    expect(pickRefusal(fine, again)).toBe(again);
  });

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

  // Spec 385 (REQ-1, REQ-2, REQ-3): a Deploy press whose install succeeds
  // while another job is running must not claim the dashboard is
  // restarting — it names the job the restart is waiting for instead,
  // both in the press's own answer and, for as long as the wait lasts,
  // on the project's own Deploy tab.
  test("Deploy waits for a running job, says so in its answer and on the tab (REQ-1, REQ-2, REQ-3)", async () => {
    const dir = own("aide-deploy-waiting-");
    const paths = repos(dir);
    const goFile = join(dir, "go");
    const fakeRunner = join(dir, "fake-run-spec");
    writeFileSync(fakeRunner, `#!/bin/sh\nwhile [ ! -f ${goFile} ]; do sleep 0.05; done\n`, { mode: 0o755 });
    let headCalls = 0;
    const inner = gitFor();
    const git = {
      calls: inner.calls,
      run: async (d: string, args: string[]) => {
        const a = args.join(" ");
        if (a === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "master\n" };
        if (a === "rev-parse --show-toplevel") return { code: 0, stdout: `${paths.project}\n` };
        if (a === "rev-parse HEAD") {
          headCalls += 1;
          return { code: 0, stdout: `${headCalls === 1 ? "abc1234deadbeef" : "9999999cafefeed"}\n` };
        }
        // Level with origin: the deploy tab's "stale" sentence (the one
        // REQ-3 changes) is only reached once `behind` is a real 0, not
        // the unanswerable-null gitFor()'s own fallback would otherwise
        // leave it at.
        if (a.startsWith("rev-list --count")) return { code: 0, stdout: "0\n" };
        return inner.run(d, args);
      },
    };
    let fired = 0;
    const { base } = serverWithHarness(dir, paths, git, {
      dashboardRoot: paths.project,
      queueRunnerBin: fakeRunner,
      restart: {
        registered: async () => true,
        fire: () => {
          fired += 1;
        },
      },
    });
    installs(paths.project);

    try {
      const job = await runStep(base, "analyze");
      await settle(base, job.id, (j) => j.state === "running");

      const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { method: "POST", headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; restarting?: boolean; restartWaiting?: string[] };
      expect(body.ok).toBe(true);
      expect(body.restarting).toBe(false);
      // Named by its spec, not its id: the sentence this lands in is read
      // by a person, and a short id names nothing to them.
      expect(body.restartWaiting).toEqual([`${job.project}:${job.specFolder}`]);
      // The restart hook never fires within this test's own window — the
      // wait is bounded by RESTART_JOBS_DEFER_MS (two hours) by default.
      expect(fired).toBe(0);

      const deadline = Date.now() + 2000;
      let html = await (await fetch(`${base}/projects/aide?tab=deploy`, { headers: AUTH })).text();
      while (!html.includes("the restart is waiting for running jobs") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
        html = await (await fetch(`${base}/projects/aide?tab=deploy`, { headers: AUTH })).text();
      }
      expect(html).toContain(`the restart is waiting for running jobs: ${job.project}:${job.specFolder}`);
      expect(html).not.toContain("Deploy restarts it on commit");
      // Spec 392 (REQ-9): the button stays live (a press still retries
      // the install), but its title says a press will not restart the
      // service sooner.
      const form = html.match(/<form[^>]*class="deployform"[\s\S]*?<\/form>/)?.[0] ?? "";
      expect(form).not.toMatch(/<button[^>]*\bdisabled\b/);
      expect(form).toContain(
        'title="Pressing again only repeats the pull and install — it does not restart the service sooner."',
      );
    } finally {
      writeFileSync(goFile, "");
    }
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
});
