// Running one of aide's own installed scripts from inside a landing
// worktree, and finding it on disk — shared by the landing's test gate
// and its create-finalize step, neither of which can rely on the
// installer's own shell PATH (launchd does not reach ~/.local/bin).

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnEnv } from "../tool-path.ts";
import { scriptArgv } from "../../integrations/script-argv.ts";
import { signalGroup } from "../serve-helpers/signal-group.ts";
import { trackLandingProcess, untrackLandingProcess } from "./cancel-landing.ts";

/** Where the installer puts the scripts; launchd's PATH does not reach
 *  ~/.local/bin (the same resolution run-aide-write-spec.ts uses). */
/** Which copy of an aide script the landing runs. BESIDE THE RUNNER
 *  first: the board is started with `--runner-bin`, and the scripts in
 *  that same directory are the ones written together with this server's
 *  own code — a test board started from a branch serves that branch's
 *  TypeScript and must call that branch's bash, or a flag the branch
 *  added is "unknown" to the copy installed from main (2026-09-14).
 *  Then the installed copy under ~/.local/bin, then the bare name. An
 *  explicit override (a test's fake) wins over all three. */
export function scriptFor(name: string, opts: { beside?: string; override?: string } = {}): string {
  if (opts.override) return opts.override;
  if (opts.beside) {
    const sibling = join(opts.beside, name);
    if (existsSync(sibling)) return sibling;
  }
  const path = join(process.env.HOME || homedir(), ".local", "bin", name);
  return existsSync(path) ? path : name;
}

export async function runScript(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  /** The job this script runs for, so Cancel can reach it. */
  owner?: string,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  // The same PATH a step's own spawn gets (`tool-path.ts`). Without it
  // this server, under launchd, cannot see `~/.local/bin` — where aide's
  // scripts and Claude Code itself live — so a script run from here
  // would report a CLI missing that a real run finds.
  const env = spawnEnv();
  // A group of its own, so what it leaves running when it ends — a test
  // suite's board, a decoy server — can be stopped with it without
  // touching this server. Left alive, those held the output pipes open
  // and ports taken, and the next landing's suite timed out on them
  // (498, 2026-09-19).
  const proc = Bun.spawn({ cmd: scriptArgv(argv, env.PATH), cwd, env, stdout: "pipe", stderr: "pipe", detached: true });
  if (owner) trackLandingProcess(owner, proc.pid);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    signalGroup(proc.pid);
  }, timeoutMs);
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const code = await proc.exited;
  clearTimeout(timer);
  if (owner) untrackLandingProcess(owner, proc.pid);
  // The script is done; anything of its group still running is left
  // over. TERM first, and KILL for whatever is still holding the pipes a
  // few seconds on — the reads below end only once every holder is gone.
  signalGroup(proc.pid);
  const hard = setTimeout(() => signalGroup(proc.pid, "SIGKILL"), 3_000);
  const out = { code, stdout: await stdout, stderr: await stderr, timedOut };
  clearTimeout(hard);
  return out;
}
