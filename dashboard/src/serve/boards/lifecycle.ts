// Starting, polling and stopping a board (spec 388): a thin wrapper
// around `dashboard/test/round/run`, exactly as a person invokes it from
// a terminal today — see 3-solution.md's own "Approach A" for why this
// is a wrapper and not a second implementation of the round.

import { readFileSync, rmSync } from "node:fs";
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
  findFreePort: (reserved: number[]) => Promise<number | undefined>;
  /** What is listening on one of the pool's ports, if it is a test
   *  server: its process, and the directory that process was given.
   *  `recover.ts` asks this once per port after a restart; the real
   *  implementation reads the process table, and a test injects an
   *  answer. `undefined` for a free port, or one held by anything else. */
  boardOnPort: (port: number) => Promise<{ pid: number; workDir: string } | undefined>;
  /** The board's own log line — what a start spawned, and why one did
   *  not come up. Four presses of the start link left four empty work
   *  directories and no trace of what happened (2026-09-09), and the
   *  page's own "could not start" said only what the LAST attempt's
   *  round log had said. Optional so a test context need not supply
   *  one; the server passes `console.log`. */
  log?: (line: string) => void;
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
 *  reachable from the serving host and nowhere else — each port here is
 *  put behind `tailscale serve` once, by hand, on the serving host
 *  (`tailscale serve --bg --https <port> http://127.0.0.1:<port>`), so a
 *  board that takes one is reachable the moment it is up.
 *
 *  Six: room for more than the three branches a reader could look at
 *  before, without needing a config surface — one more line here, and
 *  the matching `tailscale serve` command run once by hand, is what a
 *  different number costs. */
export const BOARD_PORTS = [8801, 8802, 8803, 8804, 8805, 8806] as const;

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

export async function findFreePort(reserved: number[], canBind: PortProbe = bindable): Promise<number | undefined> {
  const taken = new Set(reserved);
  for (const port of BOARD_PORTS) {
    if (taken.has(port)) continue;
    if (canBind(port)) return port;
  }
  return undefined;
}

// Either of the round's two addresses-in-a-line. "board up" comes the
// moment its server answers, minutes before "left running" closes the
// round off — a reader gets in while the fixture specs are still being
// created, and watches the list fill.
const LEFT_RUNNING_RE = /(?:left running|board up): pid (\d+), (\S+)(?: — serving (\S+) @ (\S+))?/;

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

  // REQ-2 (spec 428): the pool being full is a refusal like any other in
  // this function — stating how many test servers are already running
  // and what the limit is, rather than a bare port list.
  const port = await ctx.findFreePort(ctx.reservedPorts());
  if (port === undefined) {
    const running = ctx.store.all().filter((e) => e.status !== "failed").length;
    return {
      ok: false,
      error:
        `${running} of ${BOARD_PORTS.length} test servers are already running — ` +
        `open Test servers (⋯ menu) and stop one before starting another`,
    };
  }
  const workDir = ctx.makeWorkDir();
  const logPath = join(workDir, "board.log");
  const cmd = [ctx.roundScript(project), aideCheckout, "--branch", branch, "--port", String(port), "--keep"];
  let proc: SpawnResult;
  try {
    proc = ctx.spawn(cmd, logPath);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    ctx.log?.(`boards: could not start ${branch} @ ${commit.slice(0, 7)} on :${port} — ${why} (${cmd.join(" ")})`);
    return { ok: false, error: `could not start the round: ${why}` };
  }
  ctx.log?.(`boards: starting ${branch} @ ${commit.slice(0, 7)} on :${port} — pid ${proc.pid}, log ${logPath}`);
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
  // REQ-2: a "running" entry is never re-examined below this point — the
  // early return just past this only ever revisits "starting". Once the
  // round has reported a board up, nothing asked again whether its
  // process was still there, so a board killed outside the Stop button
  // (crashed, a reboot) stayed "running" in the registry forever.
  // `entry.pid` is always set once `status` is "running" — both writers
  // of that status (this function's own "left running"/"board up" match
  // below, and `recover.ts`'s `recoverBoards`) set it in the same object
  // literal as the status itself. The type keeps `pid` optional
  // regardless (nothing enforces this invariant statically, only this
  // comment) — the same trade-off `store.ts`'s own doc comment on `pid`
  // already makes for the field itself.
  if (entry?.status === "running" && !ctx.isAlive(entry.pid!)) {
    stopBoard(ctx, project, specFolder);
    return undefined;
  }
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
      ctx.log?.(`boards: ${entry.branch} did not come up on :${entry.port} — ${failed.error} (log ${entry.logPath})`);
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
  // The log this server made for the round goes with the board
  // (2026-09-08). Nothing reads it once the entry is gone — the page
  // shows what it said while the board was starting, and that is over —
  // and a directory per start had piled up in the machine's temp.
  try {
    rmSync(entry.workDir, { recursive: true, force: true });
  } catch {
    // Best effort: a directory that will not go is not worth failing a
    // stop over.
  }
  try {
    // A recovered board (`recover.ts`) has no wrapper left to lead a
    // group: the signal goes to the board's own process instead, which
    // is what the round's own disowned watcher waits for before it
    // removes the worktree.
    process.kill(entry.recovered ? entry.wrapperPid : -entry.wrapperPid, "SIGTERM");
  } catch {
    // already gone
  }
  ctx.store.delete(project, specFolder);
}
