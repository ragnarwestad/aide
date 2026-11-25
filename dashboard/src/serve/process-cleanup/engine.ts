import { resolve } from "node:path";
import { TEMP_PREFIXES } from "./temp-prefixes.generated.ts";
import type { TranslationKey } from "../../i18n";

export interface CleanupProcess {
  pid: number;
  ppid: number;
  pgid: number;
  startedAt: number;
  command: string;
  cwd?: string;
}

export const CLEANUP_OPERATIONS = [
  { step: "protect", label: "cleanup.stepProtect" },
  { step: "ports", label: "cleanup.stepPorts" },
  { step: "orphans", label: "cleanup.stepOrphans" },
  { step: "stop", label: "cleanup.stepStop" },
  { step: "temp", label: "cleanup.stepTemp" },
] as const;

void (CLEANUP_OPERATIONS satisfies readonly { step: string; label: TranslationKey }[]);

export type CleanupOperation = (typeof CLEANUP_OPERATIONS)[number]["step"];
type CleanupTerminalState = "started" | "done" | "skipped";
type CleanupTextState = "detail" | "stopped";
export type CleanupProgress =
  | { step: CleanupOperation; state: CleanupTerminalState }
  | { step: CleanupOperation; state: CleanupTextState; text: string };

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
  progress?: (event: CleanupProgress) => void;
  /** The test suites' temp folders, with when each last changed. */
  tempDirs?: () => Promise<{ path: string; modifiedAt: number }[]>;
  removeDir?: (path: string) => Promise<void>;
}

/** The folders a test suite makes for itself and removes when it ends; one
 *  left behind belongs to a suite that was stopped before it could. */
export const TEST_SUITE_TEMP_PREFIXES = ["aide-pytest-", "aide-bun-test-"] as const;

const ORPHAN_AGE_MS = 6 * 60 * 60_000;
const temporaryRoot = (text: string): boolean => TEMP_PREFIXES.some((prefix) => text.split("/").some((part) => part.startsWith(prefix)));
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
const DONE_PROGRESS = "done" as const;
const STOPPED_PROGRESS = "stopped" as const;

/** Every process the cleanup must leave alone: the registered and
 *  protected pids, what runs under a protected root, and their children. */
function protectedProcesses(deps: CleanupDependencies, snapshot: CleanupProcess[], registered: Set<number>): Set<number> {
  const protectedPids = protectedTree(snapshot, new Set([...registered, ...deps.protectedPids()]));
  for (const process of snapshot) {
    if (deps.protectedRoots().some((root) => under(process.cwd, root))) protectedPids.add(process.pid);
  }
  const result = protectedTree(snapshot, protectedPids);
  deps.progress?.({ step: "protect", state: DONE_PROGRESS });
  return result;
}

/** The processes holding one of the dashboard's ports that no registered
 *  job owns. */
async function portOwnerPids(deps: CleanupDependencies, registered: Set<number>): Promise<Set<number>> {
  deps.progress?.({ step: "ports", state: "started" });
  const portPids = new Set<number>();
  for (const port of deps.ports) {
    const pid = await deps.portOwner(port);
    if (pid !== undefined && !registered.has(pid)) portPids.add(pid);
  }
  deps.progress?.({ step: "ports", state: DONE_PROGRESS });
  return portPids;
}

/** The unprotected processes to stop: port owners, and old orphans
 *  working in or naming a temporary root. */
function selectCandidates(deps: CleanupDependencies, snapshot: CleanupProcess[], protectedPids: Set<number>, portPids: Set<number>): CleanupProcess[] {
  deps.progress?.({ step: "orphans", state: "started" });
  const selected = snapshot.filter((process) => {
    if (protectedPids.has(process.pid)) return false;
    if (portPids.has(process.pid)) return true;
    const temporary = temporaryRoot(process.cwd ?? "") || temporaryRoot(process.command);
    return process.ppid === 1 && deps.now() - process.startedAt > ORPHAN_AGE_MS && temporary;
  });
  deps.progress?.({ step: "orphans", state: DONE_PROGRESS });
  return selected;
}

/** Stops each candidate still running as the same process, SIGTERM then
 *  SIGKILL, and answers which stopped. */
async function stopCandidates(
  deps: CleanupDependencies,
  selected: CleanupProcess[],
  byPid: Map<number, CleanupProcess>,
): Promise<CleanupProcess[]> {
  deps.progress?.({ step: "stop", state: "started" });
  const stopped: CleanupProcess[] = [];
  const survivors: CleanupProcess[] = [];
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
    if (!deps.alive(candidate.pid)) {
      const process = byPid.get(candidate.pid) ?? candidate;
      stopped.push(process);
      deps.progress?.({ step: "stop", state: "detail", text: `Stopped PID ${process.pid}, age ${ageText(deps.now() - process.startedAt)}, ${process.command}` });
    } else {
      survivors.push(candidate);
    }
  }
  if (!deps.cancelled?.()) {
    if (survivors.length) deps.progress?.({ step: "stop", state: STOPPED_PROGRESS, text: `PID ${survivors.map(({ pid }) => pid).join(", ")} is still running` });
    else deps.progress?.({ step: "stop", state: stopped.length ? DONE_PROGRESS : "skipped" });
  }
  return stopped;
}

export async function cleanupProcesses(deps: CleanupDependencies): Promise<{ stopped: number[]; log: string }> {
  deps.progress?.({ step: "protect", state: "started" });
  const snapshot = await deps.processes();
  const byPid = new Map(snapshot.map((process) => [process.pid, process]));
  const registered = deps.registeredPids();
  const protectedPids = protectedProcesses(deps, snapshot, registered);
  const portPids = await portOwnerPids(deps, registered);
  const selected = selectCandidates(deps, snapshot, protectedPids, portPids);
  const stopped = await stopCandidates(deps, selected, byPid);
  const removed = deps.cancelled?.() ? [] : await removeStaleTempDirs(deps);
  return {
    stopped: stopped.map((process) => process.pid),
    log: (stopped.length
      ? stopped.map((process) => `Stopped PID ${process.pid}, age ${ageText(deps.now() - process.startedAt)}, ${process.command}`).join("\n") + "\n"
      : "Nothing to stop.\n") + removed.map((line) => `${line}\n`).join(""),
  };
}

/** Test-suite temp folders older than the orphan age that no running
 *  process works in or names: no suite runs that long. */
async function removeStaleTempDirs(deps: CleanupDependencies): Promise<string[]> {
  deps.progress?.({ step: "temp", state: "started" });
  const lines: string[] = [];
  if (deps.tempDirs && deps.removeDir) {
    const processes = await deps.processes();
    const inUse = (path: string) => processes.some((process) => under(process.cwd, path) || process.command.includes(path));
    for (const dir of await deps.tempDirs()) {
      if (deps.cancelled?.()) return lines;
      const name = dir.path.split("/").pop() ?? "";
      if (!TEST_SUITE_TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      if (deps.now() - dir.modifiedAt <= ORPHAN_AGE_MS || inUse(dir.path)) continue;
      await deps.removeDir(dir.path);
      const line = `Removed ${dir.path}, age ${ageText(deps.now() - dir.modifiedAt)}`;
      lines.push(line);
      deps.progress?.({ step: "temp", state: "detail", text: line });
    }
  }
  deps.progress?.({ step: "temp", state: lines.length ? DONE_PROGRESS : "skipped" });
  return lines;
}
