// What the test-server route tests build again and again: a fake spawn
// that stands a real, self-owned `sleep` in for the round, a fake `git`
// that reports the spec's branch open on origin, a real branch on a bare
// "origin", and a finished step whose result carries `branchUrls`.
import { join } from "node:path";

export const folder = "81-queue-and-runner";

/** A JSON POST with an empty body, the way the board's own forms send it. */
export function postEmpty(url: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}",
  });
}

/** The spawn the harness takes in place of the round script. Each call
 *  starts a detached `sleep`, so `stopTestServer`'s real
 *  `process.kill(-pid, ...)` reaches a process group this test owns;
 *  `killAll` ends them all. */
export function fakeSpawn() {
  const calls: { cmd: string[] }[] = [];
  const spawned: number[] = [];
  let boardLog = "";
  const spawn = (cmd: string[], logPath: string) => {
    calls.push({ cmd });
    boardLog = logPath;
    const proc = Bun.spawn({ cmd: ["sleep", "60"], stdio: ["ignore", "ignore", "ignore"], detached: true });
    proc.unref();
    spawned.push(proc.pid);
    return { pid: proc.pid };
  };
  const killAll = () => {
    for (const pid of spawned) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // already gone, which is the outcome either way
      }
    }
  };
  return { calls, spawned, spawn, killAll, boardLog: () => boardLog };
}

/** A `git` where every call succeeds trivially, except
 *  `ls-remote --heads origin aide/<folder>`, which answers a real SHA so
 *  `startTestServer()`'s `headCommit()` finds the branch, and the merge,
 *  held open for the life of the test: a landing that finished would
 *  merge the branch and clear the `branchUrls` the board start needs. */
export async function branchOpenGit(_dir: string, args: string[]) {
  const a = args.join(" ");
  if (a.startsWith(`ls-remote --heads origin aide/${folder}`)) {
    return { code: 0, stdout: `abc123deadbeef1234567890abcdef123456789\trefs/heads/aide/${folder}\n` };
  }
  if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
  if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
  if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
  if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) {
    return new Promise<never>(() => {
      // Never resolves.
    });
  }
  return { code: 0, stdout: "" };
}

/** Gives the fixture's project root an `aide/<folder>` branch on a real
 *  bare "origin", since `startTestServer`'s `headCommit` reads
 *  `git ls-remote --heads origin`. */
export function branchOnOrigin(dir: string): void {
  const root = `${dir}/root/aide`;
  Bun.spawnSync({ cmd: ["git", "-C", root, "init", "-q", "-b", "main"] });
  Bun.spawnSync({ cmd: ["git", "-C", root, "add", "-A"] });
  Bun.spawnSync({
    cmd: ["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "baseline"],
  });
  Bun.spawnSync({ cmd: ["git", "-C", root, "checkout", "-q", "-b", `aide/${folder}`] });
  const bare = `${dir}/origin.git`;
  Bun.spawnSync({ cmd: ["git", "init", "-q", "--bare", "-b", "main", bare] });
  Bun.spawnSync({ cmd: ["git", "-C", root, "remote", "add", "origin", bare] });
  Bun.spawnSync({ cmd: ["git", "-C", root, "push", "-q", "origin", "main", `aide/${folder}`] });
}

/** The job's own record, polled until `done` holds — `branchUrls` only
 *  reaches `ctx.queue.branchesFor()` once the step's result has landed
 *  on the job. */
async function settleDone(base: string, id: string): Promise<void> {
  for (let n = 0; n < 100; n++) {
    const body = (await (await fetch(`${base}/api/queue/${id}`)).json()) as {
      job: { state: string };
    };
    if (body.job.state === "done") return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the job never settled");
}

/** A real step run straight through the waiting runner, its result
 *  written where the runner reads it and naming the branch open on
 *  `<dir>/root/aide` — the display checkout `aideCheckout("aide")` falls
 *  back to — so the spec page's capability check passes. */
export async function settledBranchJob(base: string, dir: string, results: string): Promise<void> {
  const root = join(dir, "root", "aide");
  const made = (await (
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: folder, steps: ["analyze"] }),
    })
  ).json()) as { job: { id: string } };
  await Bun.write(
    join(results, `${made.job.id}.json`),
    JSON.stringify({
      ok: true,
      exitCode: 0,
      costUsd: 0.1,
      costMeasured: true,
      terminalReason: "completed",
      branch: `aide/${folder}`,
      branchUrls: [{ root, url: "https://example.test/aide" }],
      repos: [],
    }),
  );
  await settleDone(base, made.job.id);
}
