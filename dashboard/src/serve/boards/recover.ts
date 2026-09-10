// Finding the test servers that are still running, after this server
// has restarted and forgotten them.
//
// The registry lives in memory, and every deploy restarts the process —
// so a test server started before a deploy was still up, still holding
// its port and still holding its branch checked out in a worktree,
// while the dashboard believed there was none. The next click on the
// spec's own link then tried to start a SECOND one on the same branch,
// and git refused: "it may already be checked out there, or in a
// leftover worktree".
//
// The ports are what is asked, not a file this server wrote before it
// died: a file says what was true when it was written, and the answer
// wanted here is what is true now.

import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { BOARD_PORTS, type BoardsContext } from "./lifecycle.ts";
import type { BoardEntry } from "./store.ts";

/** One worktree of a project's checkout, as `git worktree list
 *  --porcelain` describes it. A detached one has no branch and is
 *  skipped — the round always checks its branch OUT. */
export interface WorktreeLine {
  path: string;
  branch: string;
  commit: string;
}

export function parseWorktrees(porcelain: string): WorktreeLine[] {
  const out: WorktreeLine[] = [];
  let path: string | undefined;
  let commit = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length).trim();
      commit = "";
      continue;
    }
    if (line.startsWith("HEAD ")) {
      commit = line.slice("HEAD ".length).trim();
      continue;
    }
    if (line.startsWith("branch ") && path) {
      out.push({ path, branch: line.slice("branch ".length).trim().replace(/^refs\/heads\//, ""), commit });
      path = undefined;
    }
  }
  return out;
}

/** The same path, however it is spelled. `git worktree list` prints the
 *  resolved path (`/private/var/folders/…` on macOS) and a process's own
 *  command line carries the one it was given (`/var/folders/…`); the two
 *  name one directory and compare unequal. */
function resolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A worktree the round made: its own branch, checked out in a
 *  `checkout` directory inside a `mktemp -d` one. Both halves are
 *  checked before anything is removed — a run's own worktree
 *  (`~/aide-dashboard/worktrees/<project>/<spec>/code`) matches neither. */
function isRoundWorktree(wt: WorktreeLine): boolean {
  const dir = wt.path.split("/");
  return (
    wt.branch.startsWith("aide/") &&
    dir[dir.length - 1] === "checkout" &&
    (dir[dir.length - 2] ?? "").startsWith("tmp.")
  );
}

/** Every test server still listening on the pool's ports, put back in
 *  the registry. Returns what it found, for the caller's own log line.
 *
 *  A port answers with the process holding it and the directory that
 *  process was given; the project's own worktree list says which branch
 *  is checked out there, and the branch says which spec. A port held by
 *  something that is not a test server matches no worktree and is left
 *  alone. */
export async function recoverBoards(ctx: BoardsContext, projects: string[]): Promise<BoardEntry[]> {
  const known = new Map<string, { project: string } & WorktreeLine>();
  for (const project of projects) {
    // A project the round cannot run on has never had a test server, so
    // there is nothing to find and no reason to ask git anything.
    if (!ctx.roundAvailable(project)) continue;
    const listed = await ctx.gitRun(ctx.aideCheckout(project), ["worktree", "list", "--porcelain"]);
    if (listed.code !== 0) continue;
    for (const wt of parseWorktrees(listed.stdout)) {
      // The round's own shape, and nothing else. A project with none of
      // those has no test server running, and the ports are not worth
      // asking about.
      if (!isRoundWorktree(wt)) continue;
      known.set(resolved(wt.path), { project, ...wt });
    }
  }
  if (known.size === 0) return [];

  const held = new Set(ctx.store.all().map((e) => e.port));
  const found: BoardEntry[] = [];
  for (const port of BOARD_PORTS) {
    if (held.has(port)) continue;
    const live = await ctx.boardOnPort(port);
    if (!live) continue;
    const wt = known.get(resolved(join(live.workDir, "checkout")));
    if (!wt || !wt.branch.startsWith("aide/")) continue;
    const specFolder = wt.branch.slice("aide/".length);
    if (!specFolder) continue;
    // The round keeps its token beside the board's own files, and the
    // address is no use without it.
    let token = "";
    try {
      token = readFileSync(join(live.workDir, "token"), "utf-8").trim();
    } catch {
      token = "";
    }
    const entry: BoardEntry = {
      branch: wt.branch,
      commit: wt.commit,
      port,
      // The round's wrapper is long gone: what is left is the board
      // itself, and `recovered` is what tells `stopBoard` to send its
      // signal to that process rather than to a process GROUP the
      // wrapper no longer leads.
      wrapperPid: live.pid,
      pid: live.pid,
      recovered: true,
      workDir: live.workDir,
      logPath: join(live.workDir, "serve.log"),
      status: "running",
      url: `http://127.0.0.1:${port}/${token ? `?token=${token}` : ""}`,
      startedAt: ctx.now(),
    };
    ctx.store.set(wt.project, specFolder, entry);
    found.push(entry);
  }
  return found;
}

/** The worktrees left behind by test servers that are gone.
 *
 *  The round leaves a watcher that removes its worktree once the board
 *  dies — but the watcher is the board's own sibling, and a restart
 *  that takes the board takes the watcher with it. What is left is a
 *  registration in `.git/worktrees/` that refuses the next checkout of
 *  that branch: "it may already be checked out there, or in a leftover
 *  worktree", which is what the next click on the spec's link met.
 *
 *  Run after `recoverBoards`, so a worktree whose board IS still up has
 *  already been matched to a live port and is not in `keep`. A board
 *  that is starting binds its port within seconds of making the
 *  worktree, so the window where one exists with nothing listening is
 *  that gap alone. */
export async function sweepDeadBoards(
  ctx: BoardsContext,
  projects: string[],
): Promise<string[]> {
  const live = new Set(ctx.store.all().map((e) => resolved(join(e.workDir, "checkout"))));
  const removed: string[] = [];
  for (const project of projects) {
    if (!ctx.roundAvailable(project)) continue;
    const root = ctx.aideCheckout(project);
    const listed = await ctx.gitRun(root, ["worktree", "list", "--porcelain"]);
    if (listed.code !== 0) continue;
    for (const wt of parseWorktrees(listed.stdout)) {
      if (!isRoundWorktree(wt) || live.has(resolved(wt.path))) continue;
      const gone = await ctx.gitRun(root, ["worktree", "remove", "--force", wt.path]);
      if (gone.code === 0) removed.push(wt.path);
    }
  }
  if (removed.length) {
    for (const project of projects) await ctx.gitRun(ctx.aideCheckout(project), ["worktree", "prune"]);
  }
  return removed;
}
