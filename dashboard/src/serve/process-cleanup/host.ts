import { homedir } from "node:os";
import { join } from "node:path";
import type { Job } from "../../queue/queue.ts";
import { signalProcess } from "../serve-helpers/signal-group.ts";
import { TEST_SERVER_PORTS } from "../test-servers/lifecycle.ts";
import { portHolder } from "../test-servers/port-owner.ts";
import type { TestServerStore } from "../test-servers/store.ts";
import { landingProcessGroups } from "../land-branch/cancel-landing.ts";
import { cleanupProcesses, type CleanupDependencies, type CleanupProcess } from "./engine.ts";

const output = (cmd: string[]): string => {
  const result = Bun.spawnSync({ cmd, stdout: "pipe", stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString() : "";
};

export function parseHostProcessLine(line: string, cwd?: string): CleanupProcess | undefined {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/.exec(line);
  if (!match) return undefined;
  const startedAt = Date.parse(match[4]!);
  if (!Number.isFinite(startedAt)) return undefined;
  return { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), startedAt, command: match[5]!, cwd };
}

export function hostProcesses(): CleanupProcess[] {
  return output(["ps", "-axo", "pid=,ppid=,pgid=,lstart=,command="]).split("\n").flatMap((line) => {
    const pid = Number(/^\s*(\d+)/.exec(line)?.[1]);
    if (!pid) return [];
    const cwd = output(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"])
      .split("\n").find((item) => item.startsWith("n"))?.slice(1);
    const parsed = parseHostProcessLine(line, cwd);
    return parsed ? [parsed] : [];
  });
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

export function hostCleanupDependencies(jobs: () => Job[], store: TestServerStore): CleanupDependencies {
  return {
    now: Date.now,
    processes: async () => hostProcesses(),
    portOwner: async (port) => portHolder(port)?.pid,
    registeredPids: () => new Set(store.all().flatMap((entry) => [entry.wrapperPid, entry.pid].filter((pid): pid is number => pid !== undefined))),
    protectedPids: () => new Set([
      ...landingProcessGroups(),
      ...jobs().filter((job) => job.state === "running" || job.landing).flatMap((job) => [job.pid, job.pgid].filter((pid): pid is number => typeof pid === "number")),
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
