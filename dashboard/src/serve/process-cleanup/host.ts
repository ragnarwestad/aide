import { homedir } from "node:os";
import { join } from "node:path";
import { writing, type Job } from "../../queue/queue.ts";
import { signalProcess } from "../serve-helpers/signal-group.ts";
import { TEST_SERVER_PORTS } from "../test-servers/lifecycle.ts";
import { portHolder } from "../test-servers/port-owner.ts";
import type { TestServerStore } from "../test-servers/store.ts";
import { landingProcessGroups } from "../land-branch/cancel-landing.ts";
import { cleanupProcesses, type CleanupDependencies, type CleanupProcess } from "./engine.ts";

// Started without waiting on it: the serving process answers every page,
// and a command it waited for would hold every one of them.
const output = async (cmd: string[], anyExit = false): Promise<string> => {
  const child = Bun.spawn({ cmd, stdout: "pipe", stderr: "ignore" });
  const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return code === 0 || anyExit ? text : "";
};

export function parseHostProcessLine(line: string, cwd?: string): CleanupProcess | undefined {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/.exec(line);
  if (!match) return undefined;
  const startedAt = Date.parse(match[4]!);
  if (!Number.isFinite(startedAt)) return undefined;
  return { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), startedAt, command: match[5]!, cwd };
}

/** Each process's working directory from one `lsof -d cwd -Fpn` answer:
 *  a `p<pid>` line, then that process's `n<path>`. */
export function parseLsofCwds(text: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** Every process on the host with its working directory, read by one `ps`
 *  and one `lsof` for all of them. */
export async function hostProcesses(): Promise<CleanupProcess[]> {
  const [list, open] = await Promise.all([
    output(["ps", "-axo", "pid=,ppid=,pgid=,lstart=,command="]),
    // lsof exits 1 when some process could not be read; the rest still holds.
    output(["lsof", "-d", "cwd", "-Fpn"], true),
  ]);
  const cwds = parseLsofCwds(open);
  return list.split("\n").flatMap((line) => {
    const pid = Number(/^\s*(\d+)/.exec(line)?.[1]);
    if (!pid) return [];
    const parsed = parseHostProcessLine(line, cwds.get(pid));
    return parsed ? [parsed] : [];
  });
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

export function hostCleanupDependencies(jobs: () => Job[], store: TestServerStore): CleanupDependencies {
  return {
    now: Date.now,
    processes: hostProcesses,
    portOwner: async (port) => portHolder(port)?.pid,
    registeredPids: () => new Set(store.all().flatMap((entry) => [entry.wrapperPid, entry.pid].filter((pid): pid is number => pid !== undefined))),
    protectedPids: () => new Set([
      ...landingProcessGroups(),
      ...jobs().filter(writing).flatMap((job) => [job.pid, job.pgid].filter((pid): pid is number => typeof pid === "number")),
    ]),
    protectedRoots: () => jobs().filter((job) => job.state === "queued").map((job) => join(homedir(), ".aide", "dashboard", "worktrees", job.project, job.specFolder)),
    signal: signalProcess,
    alive,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ports: TEST_SERVER_PORTS,
    graceMs: 2_000,
  };
}

export { cleanupProcesses };
