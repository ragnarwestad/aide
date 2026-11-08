import { resolve } from "node:path";

export interface CleanupProcess {
  pid: number;
  ppid: number;
  pgid: number;
  startedAt: number;
  command: string;
  cwd?: string;
}

export interface CleanupDependencies {
  now: () => number;
  processes: () => Promise<CleanupProcess[]>;
  portOwner: (port: number) => Promise<number | undefined>;
  registeredPids: () => Set<number>;
  protectedPids: () => Set<number>;
  protectedRoots: () => string[];
  signal: (pid: number, signal: NodeJS.Signals) => boolean;
  alive: (pid: number) => boolean;
  wait: (ms: number) => Promise<void>;
  ports: readonly number[];
  graceMs: number;
  cancelled?: () => boolean;
}

const ORPHAN_AGE_MS = 6 * 60 * 60_000;
const TEMP_ROOT = /(?:^|\/)(?:aide-pytest-|aide-bun-test-|aide-landing-gate-tree-|aide-test-server-|aide-board-)/;
const under = (path: string | undefined, root: string): boolean => {
  if (!path) return false;
  const target = resolve(path);
  const base = resolve(root);
  return target === base || target.startsWith(`${base}/`);
};
const sameIdentity = (left: CleanupProcess, right: CleanupProcess): boolean =>
  left.pid === right.pid && left.startedAt === right.startedAt && left.command === right.command;

function protectedTree(processes: CleanupProcess[], roots: Set<number>): Set<number> {
  const protectedSet = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if ((protectedSet.has(process.ppid) || protectedSet.has(process.pgid)) && !protectedSet.has(process.pid)) {
        protectedSet.add(process.pid);
        changed = true;
      }
    }
  }
  return protectedSet;
}

const ageText = (ms: number): string => `${Math.floor(ms / 3_600_000)}h`;

export async function cleanupProcesses(deps: CleanupDependencies): Promise<{ stopped: number[]; log: string }> {
  const snapshot = await deps.processes();
  const byPid = new Map(snapshot.map((process) => [process.pid, process]));
  const registered = deps.registeredPids();
  let protectedPids = protectedTree(snapshot, new Set([...registered, ...deps.protectedPids()]));
  for (const process of snapshot) {
    if (deps.protectedRoots().some((root) => under(process.cwd, root))) protectedPids.add(process.pid);
  }
  protectedPids = protectedTree(snapshot, protectedPids);
  const portPids = new Set<number>();
  for (const port of deps.ports) {
    const pid = await deps.portOwner(port);
    if (pid !== undefined && !registered.has(pid)) portPids.add(pid);
  }
  const selected = snapshot.filter((process) => {
    if (protectedPids.has(process.pid)) return false;
    if (portPids.has(process.pid)) return true;
    const temporary = TEMP_ROOT.test(process.cwd ?? "") || TEMP_ROOT.test(process.command);
    return process.ppid === 1 && deps.now() - process.startedAt > ORPHAN_AGE_MS && temporary;
  });
  const stopped: CleanupProcess[] = [];
  for (const candidate of selected) {
    if (deps.cancelled?.()) break;
    const current = new Map((await deps.processes()).map((process) => [process.pid, process])).get(candidate.pid);
    if (!current || !sameIdentity(candidate, current)) continue;
    deps.signal(candidate.pid, "SIGTERM");
    await deps.wait(deps.graceMs);
    if (deps.cancelled?.()) break;
    if (deps.alive(candidate.pid)) {
      deps.signal(candidate.pid, "SIGKILL");
      await deps.wait(deps.graceMs);
    }
    if (!deps.alive(candidate.pid)) stopped.push(byPid.get(candidate.pid) ?? candidate);
  }
  return {
    stopped: stopped.map((process) => process.pid),
    log: stopped.length
      ? stopped.map((process) => `Stopped PID ${process.pid}, age ${ageText(deps.now() - process.startedAt)}, ${process.command}`).join("\n") + "\n"
      : "Nothing to stop.\n",
  };
}
