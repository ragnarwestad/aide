// The Deploy routes (`serve/routes/deploy-steps.ts`): that the per-step
// routes are gone, the origin check a Deploy tab makes when it is opened,
// and the board's own deploy queued as a job.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { setDeployFaultNotice } from "../../../src/render/ui/faults/deploy-fault.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { AUTH, createOwnDirs, gitFor, installs, repos, serverWith, settle } from "../landing/every-step-lands-fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const { own, cleanup: cleanupOwnDirs } = createOwnDirs();

afterEach(() => {
  harness.cleanup();
  cleanupOwnDirs();
  // The message is process-lifetime state: it must not reach the pages
  // another file renders in this process.
  setDeployFaultNotice(null);
});

interface Repo {
  bootSha: string;
  headSha: string;
  branch: string;
  /** Where `--show-toplevel` says this process runs from. */
  top?: string;
  /** How many commits origin is ahead; 0 when absent. */
  behind?: number;
  /** A fetch that fails: origin cannot be reached. */
  fetchFails?: boolean;
}

/** A checkout on `branch`, level with origin, that is also the repo this
 *  process runs from: the bare `rev-parse HEAD` is the boot read the
 *  first time it is asked and the checkout's own after that. */
function deployGit(project: string, repo: Repo, fetchGate?: Promise<void>) {
  let headCalls = 0;
  const inner = gitFor();
  const calls: { dir: string; args: string[] }[] = [];
  const run = async (dir: string, args: string[]) => {
    calls.push({ dir, args });
    // Held here, a fetch keeps the checkout's merge lock the way a
    // landing running its tests does.
    if (fetchGate && args[0] === "fetch") await fetchGate;
    const a = args.join(" ");
    if (a === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: `${repo.branch}\n` };
    if (a === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo.top ?? project}\n` };
    if (a === "rev-parse HEAD") {
      headCalls += 1;
      return { code: 0, stdout: `${headCalls === 1 ? repo.bootSha : repo.headSha}\n` };
    }
    if (a.startsWith("rev-list --count")) return { code: 0, stdout: `${repo.behind ?? 0}\n` };
    if (repo.fetchFails && args[0] === "fetch") return { code: 128, stdout: "" };
    return inner.run(dir, args);
  };
  return { run, calls };
}

const SAME = { bootSha: "abc1234deadbeef", headSha: "abc1234deadbeef", branch: "master" };

/** A server whose checkout is the dashboard's own, drift poll off so the
 *  origin count is only ever what a step filled. */
async function deployServer(
  repo: Repo,
  restart: { registered: () => Promise<boolean>; fire: () => void },
  extra = {},
  fetchGate?: Promise<void>,
) {
  const dir = own("aide-deploy-steps-");
  const paths = repos(dir);
  const git = deployGit(paths.project, repo, fetchGate);
  const { base } = serverWith(harness, dir, paths, git, {
    dashboardRoot: paths.project,
    driftPollMs: 0,
    restart,
    ...extra,
  });
  // The served commit is read once, asynchronously, after boot.
  await fetch(`${base}/api/version`);
  return { base, dir, paths, git };
}

const noRestart = { registered: async () => false, fire: () => {} };
const post = (base: string, path: string, headers: Record<string, string> = AUTH) =>
  fetch(`${base}/api/queue/projects/${path}`, { method: "POST", headers });
const answer = async (res: Response) => (await res.json()) as Record<string, unknown>;
const page = async (base: string, path: string) => await (await fetch(`${base}${path}`)).text();
const FAULT = /<p class="deploy-fault rowmsg failed">/;

/** What the Deploy tab draws for a kept failure, one per load. */
const KEPT = /class="refusal deploy-error rowmsg failed"/g;
const kept = (html: string): string[] => html.match(KEPT) ?? [];

describe("the per-step deploy routes are gone", () => {
  test("a POST to deploy/fetch, deploy/install, deploy/restart or deploy/check answers 404 and runs nothing, on the board and on another project (AC-6)", async () => {
    for (const extra of [{}, { dashboardRoot: "/somewhere/else" }]) {
      let fired = 0;
      const { base, git, paths } = await deployServer({ ...SAME, behind: 2 }, { registered: async () => true, fire: () => void fired++ }, extra);
      const marker = installs(paths.project);
      for (const step of ["fetch", "install", "restart", "check"]) {
        expect((await post(base, `aide/deploy/${step}`)).status).toBe(404);
      }
      // A fetch is not checked: the harness's own cache refresh may run one.
      for (const forbidden of ["merge", "reset"]) {
        expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
      }
      expect(existsSync(marker)).toBe(false);
      await Bun.sleep(100);
      expect(fired).toBe(0);
    }
  });
});

describe("POST .../drift", () => {
  const tab = "/projects/aide?tab=deploy";

  test("asks origin afresh with the poll off and answers the count, which the next Deploy tab says (AC-1)", async () => {
    const repo = { ...SAME, behind: 2 };
    const { base, git, paths } = await deployServer(repo, noRestart);
    installs(paths.project);
    expect(await page(base, tab)).toContain("has not been checked yet");
    const res = await post(base, "aide/drift");
    expect(res.status).toBe(200);
    expect(await answer(res)).toEqual({ ok: true, behind: 2 });
    expect(git.calls.some((c) => c.args.join(" ") === "fetch --quiet origin master")).toBe(true);
    expect(await page(base, tab)).toContain("2 commits behind origin");
  });

  test("asks git again inside the 30-second TTL rather than answering from the cache (AC-1)", async () => {
    const repo = { ...SAME, behind: 1 };
    const { base, git, paths } = await deployServer(repo, noRestart);
    installs(paths.project);
    expect((await answer(await post(base, "aide/drift"))).behind).toBe(1);
    repo.behind = 3;
    const fetches = git.calls.filter((c) => c.args[0] === "fetch").length;
    expect((await answer(await post(base, "aide/drift"))).behind).toBe(3);
    expect(git.calls.filter((c) => c.args[0] === "fetch").length).toBe(fetches + 1);
  });

  test("a project that is not the board's, with no install command, answers the count, which its Deploy tab then says (AC-4)", async () => {
    const { base, git } = await deployServer({ ...SAME, behind: 3 }, noRestart, { dashboardRoot: "/somewhere/else" });
    const res = await post(base, "aide/drift");
    expect(res.status).toBe(200);
    expect(await answer(res)).toEqual({ ok: true, behind: 3 });
    expect(git.calls.some((c) => c.args[0] === "fetch")).toBe(true);
    expect(await page(base, tab)).toContain("3 commits behind origin");
  });

  test("an origin that cannot be reached answers 400, and the tab keeps the earlier answer with no failed deploy (AC-4)", async () => {
    const repo: Repo = { ...SAME, behind: 1 };
    const { base, paths } = await deployServer(repo, noRestart);
    installs(paths.project);
    expect((await post(base, "aide/drift")).status).toBe(200);
    repo.fetchFails = true;
    repo.behind = 5;
    const res = await post(base, "aide/drift");
    expect(res.status).toBe(400);
    expect(String((await answer(res)).error)).toContain("origin could not be checked");
    const html = await page(base, tab);
    expect(html).toContain("1 commit behind origin");
    expect(kept(html).length).toBe(0);
    expect(await page(base, "/projects")).not.toMatch(FAULT);
  });

  test("a project this dashboard does not know answers 400 and keeps no failed deploy (AC-4)", async () => {
    const { base, paths } = await deployServer(SAME, noRestart);
    installs(paths.project);
    const res = await post(base, "nosuch/drift");
    expect(res.status).toBe(400);
    expect(String((await answer(res)).error)).toContain('"nosuch" is not a project this dashboard knows');
    expect(kept(await page(base, tab)).length).toBe(0);
  });

  test("only POST (AC-4)", async () => {
    const { base } = await deployServer(SAME, noRestart);
    expect((await fetch(`${base}/api/queue/projects/aide/drift`, { headers: AUTH })).status).toBe(405);
  });

  test("it only reads: no merge, pull, reset, checkout or clean, no install, no restart (AC-5)", async () => {
    let fired = 0;
    const { base, git, paths } = await deployServer({ ...SAME, behind: 4 }, { registered: async () => true, fire: () => void fired++ });
    const marker = installs(paths.project);
    expect((await post(base, "aide/drift")).status).toBe(200);
    for (const forbidden of ["merge", "pull", "reset", "checkout", "clean"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
    expect(existsSync(marker)).toBe(false);
    await Bun.sleep(100);
    expect(fired).toBe(0);
  });
});

/** The queue, as the board lists it. */
const queued = async (base: string): Promise<{ id: string; specFolder: string; steps: string[]; state: string }[]> =>
  ((await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as { jobs: { id: string; specFolder: string; steps: string[]; state: string }[] }).jobs;

describe("POST .../deploy queues the board's own deploy as a job", () => {
  test("it answers the job and the queue holds it (AC-1)", async () => {
    const { base, paths } = await deployServer(SAME, noRestart, {}, new Promise<void>(() => {}));
    installs(paths.project);
    const res = await post(base, "aide/deploy");
    expect(res.status).toBe(200);
    const body = await answer(res);
    expect(body.ok).toBe(true);
    expect(body.job).toMatchObject({ project: "aide", specFolder: "deploy", steps: ["deploy"] });
    expect((await queued(base)).filter((j) => j.specFolder === "deploy")).toHaveLength(1);
  });

  test("it refuses a project with no install command, a project that is not the board's, and a board with no runner, and queues nothing (AC-1)", async () => {
    const noInstall = await deployServer(SAME, noRestart);
    const refused = await post(noInstall.base, "aide/deploy");
    expect(refused.status).toBe(400);
    expect(String((await answer(refused)).error)).toContain("install command");
    expect(await queued(noInstall.base)).toEqual([]);

    const elsewhere = await deployServer(SAME, noRestart, { dashboardRoot: "/somewhere/else" });
    installs(elsewhere.paths.project);
    const notBoard = await post(elsewhere.base, "aide/deploy");
    expect(notBoard.status).toBe(400);
    expect(String((await answer(notBoard)).error)).toContain("only the board itself");
    expect(await queued(elsewhere.base)).toEqual([]);

    const noRunner = await deployServer(SAME, noRestart, { queueRunnerBin: undefined });
    installs(noRunner.paths.project);
    expect((await post(noRunner.base, "aide/deploy")).status).toBe(400);
    expect(await queued(noRunner.base)).toEqual([]);
  });

  test("a second deploy is refused while one is queued or running, and queued again once it has ended (AC-7)", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const { base, paths } = await deployServer(SAME, noRestart, {}, gate);
    installs(paths.project);
    const first = (await answer(await post(base, "aide/deploy"))).job as { id: string };

    const second = await post(base, "aide/deploy");
    expect(second.status).toBe(400);
    expect(String((await answer(second)).error)).toContain("already");
    expect((await queued(base)).filter((j) => j.specFolder === "deploy")).toHaveLength(1);

    release();
    await settle(base, first.id, (j) => j.state === "done");
    const third = await post(base, "aide/deploy");
    expect(third.status).toBe(200);
    expect((await queued(base)).filter((j) => j.specFolder === "deploy")).toHaveLength(2);
  });
});
