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

/** The ports a test server may use. A board on a port nobody exposed is
 *  reachable from the serving host and nowhere else — and the reader
 *  who wants to look at a branch is usually not sitting at it. These
 *  three are put behind `tailscale serve` once, by hand, so a board
 *  that takes one is reachable the moment it is up.
 *
 *  Three, not more: each is a standing exposure on the tailnet, and a
 *  reader is not looking at four branches at once. A fourth request
 *  says so rather than starting a board nobody can open. */
export const BOARD_PORTS = [8801, 8802, 8803] as const;

/** The first port in the pool that nothing is using. `reserved` is what
 *  this server and its other boards already hold (REQ-10); the probe is
 *  for anything else on the machine that took one meanwhile.
 *
 *  It used to ask the OS for any free port at all — reachable on the
 *  host, and nowhere else, since nothing exposes a port picked at
 *  random. */
/** Whether a port can be bound right now. Injectable so a test can ask
 *  the question without binding anything — the real one binds, and a
 *  board running on this machine would otherwise decide the test. */
export type PortProbe = (port: number) => boolean;

const bindable: PortProbe = (port) => {
  try {
    // `hostname` matters: a board listens on loopback, and
    // `tailscale serve` has a listener of its own on the tailnet
    // address for these very ports. Probing on every address would
    // collide with that and report a free port as taken.
    const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("") });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
};

export async function findFreePort(reserved: number[], canBind: PortProbe = bindable): Promise<number> {
  const taken = new Set(reserved);
  for (const port of BOARD_PORTS) {
    if (taken.has(port)) continue;
    if (canBind(port)) return port;
  }
  throw new Error(
    `every test-server port is in use (${BOARD_PORTS.join(", ")}) — stop a board before starting another`,
  );
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
  // The LOG first, and the wrapper's own life second. The round leaves
  // the board running and detached, and its wrapper then exits — so a
  // dead wrapper is what SUCCESS looks like from here. Asked in the
  // other order, every board that came up was reported as "could not
  // start", with its own "left running: … http://…" line quoted
  // underneath as the reason.
  let log: string;
  try {
    log = readFileSync(entry.logPath, "utf-8");
  } catch {
    log = "";
  }
  const m = LEFT_RUNNING_RE.exec(log);
  if (!m) {
    if (!ctx.isAlive(entry.wrapperPid)) {
      const failed: BoardEntry = { ...entry, status: "failed", error: tailLine(entry.logPath) };
      ctx.store.set(project, specFolder, failed);
      return failed;
    }
    return entry;
  }
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
