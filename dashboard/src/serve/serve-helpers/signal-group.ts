// The one way this server signals a process group. `process.kill(-pid)`
// reaches every process in the group led by `pid` — and `-1` reaches
// EVERY process the user owns: the served dashboard, the terminal, the
// browser, the whole login session. A pid of 1 (or 0, or a value that
// never was a pid) therefore must never be negated and sent, whatever
// a caller's record says. Measured twice on 2026-09-12, when a test
// fixture's `wrapperPid: 1` reached a real kill.

/** The smallest pid this server will ever signal a group for: 1 is
 *  launchd, and -1 is everyone. */
const FIRST_SIGNALLABLE_PID = 2;

export function isSignallablePid(pid: unknown): pid is number {
  return typeof pid === "number" && Number.isInteger(pid) && pid >= FIRST_SIGNALLABLE_PID;
}

/** SIGTERM (or `signal`) to the whole group `pid` leads. Returns whether
 *  a signal was sent: `false` for a pid that is not a real process id,
 *  and for a group that is already gone. Never throws. */
export function signalGroup(pid: unknown, signal: NodeJS.Signals = "SIGTERM"): boolean {
  if (!isSignallablePid(pid)) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false; // already gone
  }
}

/** The same guard for a single process — a recovered board whose group
 *  leader is gone. */
export function signalProcess(pid: unknown, signal: NodeJS.Signals = "SIGTERM"): boolean {
  if (!isSignallablePid(pid)) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}
