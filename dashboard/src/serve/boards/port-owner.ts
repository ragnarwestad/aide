// What holds one of the test-server ports, asked of the machine itself.
//
// `boards/recover.ts` needs two facts about a port that is in use: the
// process holding it, and the directory that process was started with.
// The first comes from `lsof`, the second from the process's own command
// line — the round starts its board with `--root <work>/root`, and that
// work directory is what says which branch the board is serving.

/** Runs a command and returns its stdout, empty when it could not run
 *  at all — neither tool being present is an answer of "nothing found",
 *  not a reason to fail a restart. */
function output(cmd: string[]): string {
  try {
    const proc = Bun.spawnSync(cmd);
    return new TextDecoder().decode(proc.stdout);
  } catch {
    return "";
  }
}

/** The `--root` a board was started with, out of a whole command line.
 *  `<work>/root` is the round's own shape: anything else holding the
 *  port — this dashboard itself included, whose own `--root` is a
 *  projects directory — is not a board. */
export function workDirOf(command: string): string | undefined {
  const m = /--root (\S+)\/root(?:\s|$)/.exec(command);
  return m?.[1];
}

export async function boardOnPort(port: number): Promise<{ pid: number; workDir: string } | undefined> {
  const listening = output(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).trim().split("\n")[0];
  const pid = Number(listening);
  if (!pid) return undefined;
  // `-ww`: without it the command line is cut to the terminal's width,
  // and the `--root` this reads for sits at the end of a long one.
  const workDir = workDirOf(output(["ps", "-ww", "-o", "command=", "-p", String(pid)]));
  return workDir ? { pid, workDir } : undefined;
}
