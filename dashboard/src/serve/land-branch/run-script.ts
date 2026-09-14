// Running one of aide's own installed scripts from inside a landing
// worktree, and finding it on disk — shared by the landing's test gate
// and its create-finalize step, neither of which can rely on the
// installer's own shell PATH (launchd does not reach ~/.local/bin).

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the installer puts the scripts; launchd's PATH does not reach
 *  ~/.local/bin (the same resolution run-aide-write-spec.ts uses). */
export function installed(name: string, override: string | undefined): string {
  if (override) return override;
  const path = join(process.env.HOME || homedir(), ".local", "bin", name);
  return existsSync(path) ? path : name;
}

export async function runScript(
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn({ cmd: argv, cwd, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}
