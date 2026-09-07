// Starting, polling and stopping a board (spec 388): a thin wrapper
// around `dashboard/test/round/run`, exactly as a person invokes it from
// a terminal today — see 3-solution.md's own "Approach A" for why this
// is a wrapper and not a second implementation of the round.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import type { BoardStore, BoardEntry } from "./store.ts";

export interface SpawnResult {
  pid: number;
}

/** Starts the round script detached, its stdout/stderr redirected to
 *  `logPath`. The real implementation is `Bun.spawn` + `.unref()`; tests
 *  inject a fake that never touches a real process. */
export type Spawner = (cmd: string[], logPath: string) => SpawnResult;

export interface BoardsContext {
  store: BoardStore;
  /** The checkout the round runs FROM for this project — the same
   *  checkout `machineryProjectDir(project)` already resolves to
   *  everywhere else on this server. */
  aideCheckout: (project: string) => string;
  /** Path to `dashboard/test/round/run` for this project's checkout. */
  roundScript: (project: string) => string;
  /** Whether the round is even present on this host for this project —
   *  a capability check (REQ-1), never a hardcoded project name. */
  roundAvailable: (project: string) => boolean;
  gitRun: GitRunner;
  spawn: Spawner;
  isAlive: (pid: number) => boolean;
  now: () => string;
  /** A fresh directory for this board's own log file. */
  makeWorkDir: () => string;
  /** The served board's own port, and any other tracked board's port
   *  (REQ-10) — reserved before probing for a free one. */
  reservedPorts: () => number[];
  findFreePort: (reserved: number[]) => Promise<number>;
}

/** `git ls-remote --heads origin <branch>`'s own SHA — never a local
 *  `rev-parse`, which would fail on exactly REQ-9's own motivating case
 *  (a branch the checkout has not fetched yet; this runs BEFORE the
 *  round script's own fetch fallback). `undefined` when the branch does
 *  not exist on origin at all. */
export async function headCommit(gitRun: GitRunner, aideCheckout: string, branch: string): Promise<string | undefined> {
  const result = await gitRun(aideCheckout, ["ls-remote", "--heads", "origin", branch]);
  if (result.code !== 0) return undefined;
  const sha = result.stdout.trim().split("\n")[0]?.split(/\s+/)[0];
  return sha || undefined;
}

/** Bind port 0, read back what the OS gave, close it, and skip anything
 *  already reserved (REQ-10) — the same `port: 0` idiom every real
 *  server and test in this codebase already uses; there is no dedicated
 *  free-port utility to reuse. */
export async function findFreePort(reserved: number[]): Promise<number> {
  const taken = new Set(reserved);
  for (let attempt = 0; attempt < 20; attempt++) {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = probe.port;
    probe.stop(true);
    if (typeof port === "number" && !taken.has(port)) return port;
  }
  throw new Error("could not find a free port for a board after 20 attempts");
}

const LEFT_RUNNING_RE = /left running: pid (\d+), (\S+)(?: — serving (\S+) @ (\S+))?/;

function tailLine(logPath: string): string {
  try {
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    return lines[lines.length - 1] ?? "the round exited with no output";
  } catch {
    return "the round exited with no output";
  }
}

export async function startBoard(
  ctx: BoardsContext,
  project: string,
  specFolder: string,
): Promise<{ ok: true; entry: BoardEntry } | { ok: false; error: string }> {
  if (!ctx.roundAvailable(project)) {
    return { ok: false, error: "the round is not available on this host" };
  }
  const branch = `aide/${specFolder}`;
  const aideCheckout = ctx.aideCheckout(project);
  const commit = await headCommit(ctx.gitRun, aideCheckout, branch);
  if (!commit) return { ok: false, error: `no such branch on origin: ${branch}` };

  // REQ-6: the same branch AND commit already up (or starting) — hand
  // back that entry rather than spawning a second round.
  const existing = ctx.store.get(project, specFolder);
  if (
    existing &&
    existing.branch === branch &&
    existing.commit === commit &&
    existing.status !== "failed" &&
    ctx.isAlive(existing.wrapperPid)
  ) {
    return { ok: true, entry: existing };
  }

  const port = await ctx.findFreePort(ctx.reservedPorts());
  const workDir = ctx.makeWorkDir();
  const logPath = join(workDir, "board.log");
  const proc = ctx.spawn(
    [ctx.roundScript(project), aideCheckout, "--branch", branch, "--port", String(port), "--keep"],
    logPath,
  );
  const entry: BoardEntry = {
    branch,
    commit,
    port,
    wrapperPid: proc.pid,
    workDir,
    logPath,
    status: "starting",
    startedAt: ctx.now(),
  };
  ctx.store.set(project, specFolder, entry);
  return { ok: true, entry };
}

/** Tails the board's own log to learn whether it has come up or failed.
 *  Called on read (the spec page's own render), not on a timer of its
 *  own — the page already polls every ten seconds. */
export function refreshBoardStatus(ctx: BoardsContext, project: string, specFolder: string): BoardEntry | undefined {
  const entry = ctx.store.get(project, specFolder);
  if (entry?.status !== "starting") return entry;
  if (!ctx.isAlive(entry.wrapperPid)) {
    const failed: BoardEntry = { ...entry, status: "failed", error: tailLine(entry.logPath) };
    ctx.store.set(project, specFolder, failed);
    return failed;
  }
  let log: string;
  try {
    log = readFileSync(entry.logPath, "utf-8");
  } catch {
    return entry;
  }
  const m = LEFT_RUNNING_RE.exec(log);
  if (!m) return entry;
  const running: BoardEntry = { ...entry, status: "running", pid: Number(m[1]), url: m[2] };
  ctx.store.set(project, specFolder, running);
  return running;
}

/** `SIGTERM` to the NEGATED wrapper pid — the whole process group,
 *  exactly `job-actions.ts`'s own cancel route reaches a job's group.
 *  Works whether the round is still executing (no inner pid known yet)
 *  or long past "left running" (the group still holds the backgrounded
 *  bun-serve process — see 3-solution.md's Risk analysis for the
 *  measured process-group fact this depends on). The round's own
 *  disowned watcher removes the worktree once that process dies. */
export function stopBoard(ctx: BoardsContext, project: string, specFolder: string): void {
  const entry = ctx.store.get(project, specFolder);
  if (!entry) return;
  try {
    process.kill(-entry.wrapperPid, "SIGTERM");
  } catch {
    // already gone
  }
  ctx.store.delete(project, specFolder);
}
