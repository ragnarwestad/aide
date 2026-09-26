// The Deploy button one request per step (`serve/routes/deploy-steps.ts`):
// what each step refuses and answers, that it refuses like the combined
// route, and what the finished deploy leaves on the pages — the origin
// count `check` fills and the message a faulty service leaves at the top.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setDeployFaultNotice } from "../../../src/render/ui/faults/deploy-fault.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { AUTH, createOwnDirs, gitFor, installs, repos, runStep, serverWith, settle } from "../landing/every-step-lands-fixtures.ts";

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
}

/** A checkout on `branch`, level with origin, that is also the repo this
 *  process runs from: the bare `rev-parse HEAD` is the boot read the
 *  first time it is asked and the checkout's own after that. */
function deployGit(project: string, repo: Repo) {
  let headCalls = 0;
  const inner = gitFor();
  const calls: { dir: string; args: string[] }[] = [];
  const run = async (dir: string, args: string[]) => {
    calls.push({ dir, args });
    const a = args.join(" ");
    if (a === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: `${repo.branch}\n` };
    if (a === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo.top ?? project}\n` };
    if (a === "rev-parse HEAD") {
      headCalls += 1;
      return { code: 0, stdout: `${headCalls === 1 ? repo.bootSha : repo.headSha}\n` };
    }
    if (a.startsWith("rev-list --count")) return { code: 0, stdout: "0\n" };
    return inner.run(dir, args);
  };
  return { run, calls };
}

const SAME = { bootSha: "abc1234deadbeef", headSha: "abc1234deadbeef", branch: "master" };
const OLDER = { bootSha: "abc1234deadbeef", headSha: "9999999cafefeed", branch: "master" };

function installFails(project: string): void {
  writeFileSync(join(project, ".aide", "config"), "AIDE_INSTALL_CMD=/bin/false\n");
}

/** A server whose checkout is the dashboard's own, drift poll off so the
 *  origin count is only ever what a step filled. */
async function deployServer(repo: Repo, restart: { registered: () => Promise<boolean>; fire: () => void }, extra = {}) {
  const dir = own("aide-deploy-steps-");
  const paths = repos(dir);
  const git = deployGit(paths.project, repo);
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

describe("POST .../deploy/fetch", () => {
  test("on another branch it refuses with the branch sentence and moves nothing (AC-5)", async () => {
    const { base, git, paths } = await deployServer({ ...SAME, branch: "feature-x" }, noRestart);
    const marker = installs(paths.project);
    const res = await post(base, "aide/deploy/fetch");
    expect(res.status).toBe(400);
    const body = await answer(res);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("feature-x");
    expect(git.calls.some((c) => c.args[0] === "merge")).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  test("on the default branch it fast-forwards and runs no install", async () => {
    const { base, git, paths } = await deployServer(SAME, noRestart);
    const marker = installs(paths.project);
    const res = await post(base, "aide/deploy/fetch");
    expect(res.status).toBe(200);
    expect(await answer(res)).toEqual({ ok: true });
    expect(git.calls.some((c) => c.args.join(" ") === "merge -q --ff-only origin/master")).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  test("only POST", async () => {
    const { base } = await deployServer(SAME, noRestart);
    expect((await fetch(`${base}/api/queue/projects/aide/deploy/fetch`, { headers: AUTH })).status).toBe(405);
  });
});

describe("POST .../deploy/install", () => {
  test("a failing install answers 400 with its sentence, fires no restart and still refreshes the origin count (AC-5)", async () => {
    let fired = 0;
    const { base, git, paths } = await deployServer(SAME, { registered: async () => true, fire: () => void fired++ });
    installFails(paths.project);
    const res = await post(base, "aide/deploy/install");
    expect(res.status).toBe(400);
    expect(String((await answer(res)).error)).toContain("install");
    expect(fired).toBe(0);
    expect(git.calls.some((c) => c.args[0] === "rev-list" && c.dir === paths.project)).toBe(true);
  });

  test("a process that is not restarted has an answered origin count once install has answered (AC-6)", async () => {
    const { base, paths } = await deployServer(SAME, noRestart);
    installs(paths.project);
    expect(await page(base, "/projects/aide?tab=deploy")).toContain("has not been checked yet");
    expect((await post(base, "aide/deploy/install")).status).toBe(200);
    expect(await page(base, "/projects/aide?tab=deploy")).not.toContain("has not been checked yet");
  });
});

describe("the step routes refuse like the combined route (AC-5)", () => {
  test("an unknown project, no install command and another branch say the same thing in both", async () => {
    const other = await deployServer({ ...SAME, branch: "feature-x" }, noRestart);
    for (const project of ["nosuch", "aide"]) {
      const combined = await answer(await post(other.base, `${project}/deploy`));
      const step = await answer(await post(other.base, `${project}/deploy/fetch`));
      expect(step.error).toBe(combined.error);
      expect(combined.ok).toBe(false);
    }
    installs(other.paths.project);
    const combined = await answer(await post(other.base, "aide/deploy"));
    const step = await answer(await post(other.base, "aide/deploy/fetch"));
    expect(String(combined.error)).toContain("feature-x");
    expect(step.error).toBe(combined.error);
  });

  test("a browser with no script still posts the combined route and follows its redirect", async () => {
    const { base, paths } = await deployServer(SAME, noRestart);
    installs(paths.project);
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=deploy");
  });
});

/** What the Deploy tab draws for a failure a step kept, one per load. */
const KEPT = /class="refusal deploy-error rowmsg failed"/g;
const kept = (html: string): string[] => html.match(KEPT) ?? [];
const keptText = (html: string): string =>
  html.match(/<p class="refusal deploy-error rowmsg failed">([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]*>/g, "") ?? "";

describe("a refused step is kept for the Deploy tab until the next deploy starts (AC-6)", () => {
  test("a refused fetch names the step and the reason, load after load and with no cookie (AC-6)", async () => {
    const { base, paths } = await deployServer({ ...SAME, branch: "feature-x" }, noRestart);
    installs(paths.project);
    expect((await post(base, "aide/deploy/fetch")).status).toBe(400);
    for (let load = 0; load < 2; load++) {
      const html = await page(base, "/projects/aide?tab=deploy");
      expect(kept(html).length).toBe(1);
      expect(keptText(html)).toContain("Fetch from origin failed:");
      expect(keptText(html)).toContain("feature-x");
    }
  });

  test("a failed install and a failed check are kept the same way (AC-6)", async () => {
    const install = await deployServer(SAME, noRestart);
    installFails(install.paths.project);
    await post(install.base, "aide/deploy/install");
    expect(keptText(await page(install.base, "/projects/aide?tab=deploy"))).toContain("Install failed:");

    const check = await deployServer(OLDER, noRestart);
    installs(check.paths.project);
    expect((await post(check.base, "aide/deploy/check")).status).toBe(400);
    expect(keptText(await page(check.base, "/projects/aide?tab=deploy"))).toContain("Check that the service runs the newest commit failed:");
  });

  test("the next fetch clears it, and a deploy that then fails elsewhere shows only that one (AC-6)", async () => {
    const { base, paths } = await deployServer(SAME, noRestart);
    installFails(paths.project);
    await post(base, "aide/deploy/install");
    expect(kept(await page(base, "/projects/aide?tab=deploy")).length).toBe(1);
    expect((await post(base, "aide/deploy/fetch")).status).toBe(200);
    expect(kept(await page(base, "/projects/aide?tab=deploy")).length).toBe(0);
    await post(base, "aide/deploy/install");
    const html = await page(base, "/projects/aide?tab=deploy");
    expect(kept(html).length).toBe(1);
    expect(keptText(html)).toContain("Install failed:");
  });

  test("a kept failure beats a ?deployError= address, which still shows when nothing is kept (AC-6)", async () => {
    const { base, paths } = await deployServer({ ...SAME, branch: "feature-x" }, noRestart);
    installs(paths.project);
    const url = `/projects/aide?tab=deploy&deployError=${encodeURIComponent("from the address")}`;
    expect(keptText(await page(base, url))).toBe("From the address");
    await post(base, "aide/deploy/fetch");
    const html = await page(base, url);
    expect(html).not.toContain("From the address");
    expect(keptText(html)).toContain("Fetch from origin failed:");
  });
});

describe("POST .../deploy/restart", () => {
  test("with nothing running it answers fired with the old process's startedAt, then fires (AC-2)", async () => {
    let fired = 0;
    const { base, paths } = await deployServer(SAME, { registered: async () => true, fire: () => void fired++ });
    installs(paths.project);
    const version = (await (await fetch(`${base}/api/version`)).json()) as { startedAt: string };
    const body = await answer(await post(base, "aide/deploy/restart"));
    expect(body).toEqual({ ok: true, restart: "fired", startedAt: version.startedAt });
    for (let i = 0; i < 60 && fired === 0; i++) await Bun.sleep(25);
    expect(fired).toBe(1);
  });

  test("with a job running it answers held and does not fire (AC-2)", async () => {
    const dir = own("aide-deploy-held-");
    const paths = repos(dir);
    const goFile = join(dir, "go");
    const fakeRunner = join(dir, "fake-run-spec");
    writeFileSync(
      fakeRunner,
      `#!/bin/sh\nn=0\nwhile [ ! -f ${goFile} ] && [ $n -lt 400 ]; do sleep 0.05; n=$((n+1)); done\n`,
      { mode: 0o755 },
    );
    const git = deployGit(paths.project, SAME);
    let fired = 0;
    const { base } = serverWith(harness, dir, paths, git, {
      dashboardRoot: paths.project,
      driftPollMs: 0,
      queueRunnerBin: fakeRunner,
      restart: { registered: async () => true, fire: () => void fired++ },
    });
    installs(paths.project);
    try {
      const job = await runStep(base, "analyze");
      await settle(base, job.id, (j) => j.state === "running");
      expect(await answer(await post(base, "aide/deploy/restart"))).toEqual({ ok: true, restart: "held" });
      expect(fired).toBe(0);
    } finally {
      writeFileSync(goFile, "");
    }
  });

  test("with nothing to restart it, on an older service, answers none and faulty and stores the message (AC-7)", async () => {
    const { base, paths } = await deployServer(OLDER, noRestart);
    installs(paths.project);
    const body = await answer(await post(base, "aide/deploy/restart"));
    expect(body).toEqual({ ok: true, restart: "none", faulty: true });
    expect(await page(base, "/projects")).toMatch(FAULT);
  });

  test("with nothing to restart it, on a service that is current, answers none and stores nothing", async () => {
    const { base, paths } = await deployServer(SAME, noRestart);
    installs(paths.project);
    expect(await answer(await post(base, "aide/deploy/restart"))).toEqual({ ok: true, restart: "none" });
    expect(await page(base, "/projects")).not.toMatch(FAULT);
  });
});

describe("POST .../deploy/check", () => {
  test("fills the origin count the reload reads: the Deploy tab no longer says it is unchecked (AC-6)", async () => {
    const { base, paths } = await deployServer(SAME, noRestart);
    installs(paths.project);
    expect(await page(base, "/projects/aide?tab=deploy")).toContain("has not been checked yet");
    expect((await post(base, "aide/deploy/check")).status).toBe(200);
    expect(await page(base, "/projects/aide?tab=deploy")).not.toContain("has not been checked yet");
  });

  test("a service on an older commit answers 400 faulty, and every page carries the message in the page's language (AC-7)", async () => {
    const { base, paths } = await deployServer(OLDER, noRestart);
    installs(paths.project);
    const res = await post(base, "aide/deploy/check");
    expect(res.status).toBe(400);
    const body = await answer(res);
    expect(body.faulty).toBe(true);
    expect(String(body.error)).toContain("abc1234");
    expect(String(body.error)).toContain("9999999");
    for (const path of ["/", "/projects", "/projects/aide"]) {
      const html = await page(base, path);
      expect(html).toMatch(FAULT);
      expect(html.search(FAULT)).toBeLessThan(html.indexOf("<main>"));
    }
    const norwegian = await page(base, "/projects?lang=nb");
    expect(norwegian).toMatch(FAULT);
    expect(norwegian).toContain("Tjenesten kjører commit abc1234");
  });

  test("an install that fails after the checkout moved past the served commit leaves the same message (AC-7)", async () => {
    const { base, paths } = await deployServer(OLDER, noRestart);
    installFails(paths.project);
    const res = await post(base, "aide/deploy/install");
    expect(res.status).toBe(400);
    expect((await answer(res)).faulty).toBe(true);
    for (const path of ["/", "/projects", "/projects/aide"]) expect(await page(base, path)).toMatch(FAULT);
  });

  test("a later check that finds them equal clears it, and a server started fresh has none (AC-7)", async () => {
    const repo = { ...OLDER };
    const first = await deployServer(repo, noRestart);
    installs(first.paths.project);
    await post(first.base, "aide/deploy/check");
    expect(await page(first.base, "/projects")).toMatch(FAULT);
    repo.headSha = repo.bootSha;
    expect((await post(first.base, "aide/deploy/check")).status).toBe(200);
    expect(await page(first.base, "/projects")).not.toMatch(FAULT);

    repo.headSha = OLDER.headSha;
    await post(first.base, "aide/deploy/check");
    expect(await page(first.base, "/projects")).toMatch(FAULT);
    const fresh = await deployServer(SAME, noRestart);
    expect(await page(fresh.base, "/projects")).not.toMatch(FAULT);
  });

  test("a project that is not the one this process runs from passes after the origin count and stores nothing (AC-7)", async () => {
    const { base, paths } = await deployServer({ ...OLDER, top: "/somewhere/else" }, noRestart);
    installs(paths.project);
    const res = await post(base, "aide/deploy/check");
    expect(res.status).toBe(200);
    expect(await answer(res)).toEqual({ ok: true });
    expect(await page(base, "/projects")).not.toMatch(FAULT);
  });

  test("makes no claim while the served commit is not known yet (AC-7)", async () => {
    const dir = own("aide-deploy-unknown-");
    const paths = repos(dir);
    const inner = deployGit(paths.project, OLDER);
    const run = async (d: string, args: string[]) =>
      args.join(" ") === "rev-parse HEAD" && d !== paths.project ? { code: 1, stdout: "" } : inner.run(d, args);
    const { base } = serverWith(harness, dir, paths, { run }, { dashboardRoot: paths.project, driftPollMs: 0, restart: noRestart });
    installs(paths.project);
    mkdirSync(join(paths.project, ".aide"), { recursive: true });
    expect((await post(base, "aide/deploy/check")).status).toBe(200);
  });
});
