import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { scriptArgv } from "../../integrations/script-argv.ts";
import { spawnEnv } from "../tool-path.ts";
import { signalGroup } from "../serve-helpers/signal-group.ts";

export interface ProcessHooks {
  started?: (pid: number) => void;
  ended?: (pid: number) => void;
}

export function scriptFor(name: string, opts: { beside?: string; override?: string } = {}): string {
  if (opts.override) return opts.override;
  if (opts.beside) {
    const sibling = join(opts.beside, name);
    if (existsSync(sibling)) return sibling;
  }
  const path = join(process.env.HOME || homedir(), ".local", "bin", name);
  return existsSync(path) ? path : name;
}

export async function runProcess(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  extraEnv: Record<string, string> = {},
  hooks: ProcessHooks = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const env = { ...spawnEnv(), ...extraEnv };
  const proc = Bun.spawn({ cmd: scriptArgv(argv, env.PATH), cwd, env, stdout: "pipe", stderr: "pipe", detached: true });
  hooks.started?.(proc.pid);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    signalGroup(proc.pid);
  }, timeoutMs);
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const code = await proc.exited;
  clearTimeout(timer);
  hooks.ended?.(proc.pid);
  signalGroup(proc.pid);
  const hard = setTimeout(() => signalGroup(proc.pid, "SIGKILL"), 3_000);
  const out = { code, stdout: await stdout, stderr: await stderr, timedOut };
  clearTimeout(hard);
  return out;
}

export function runScript(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  _owner?: string,
  extraEnv: Record<string, string> = {},
) {
  return runProcess(argv, cwd, timeoutMs, extraEnv);
}
