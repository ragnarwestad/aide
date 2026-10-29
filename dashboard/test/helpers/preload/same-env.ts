// The environment every `bun test` process runs in, made the same
// wherever it is started: in a session on a laptop, in a step the board
// starts, or in the board's landing. Each hands it a different one — the
// board gives every step its own `AIDE_*` paths and a URL to report runs
// to, a session adds the AI tool's `CLAUDE*` variables, and Aide's test
// command puts mise's shims first on PATH, where a shim refuses to run
// under the HOME a test makes up. `core/tests/same_env.py` does the same
// for pytest, with the same rule.
import { basename, dirname } from "node:path";

const DROPPED_PREFIXES = ["AIDE_", "CLAUDE", "GIT_"];

function isShimsDir(entry: string): boolean {
  return basename(entry) === "shims" && basename(dirname(entry)) === "mise";
}

/** `env` without the caller's own variables, with every mise shims
 *  directory on PATH replaced by `toolDirs`. */
export function sameEnv(env: Record<string, string | undefined>, toolDirs: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!DROPPED_PREFIXES.some((p) => key.startsWith(p))) out[key] = value;
  }
  if (env.PATH !== undefined) {
    out.PATH = env.PATH.split(":")
      .flatMap((entry) => (isShimsDir(entry) && toolDirs.length > 0 ? toolDirs : [entry]))
      .join(":");
  }
  return out;
}

/** The directories mise's shims point to, or none when mise cannot say. */
export function miseToolDirs(env: Record<string, string | undefined>): string[] {
  if (!(env.PATH ?? "").split(":").some(isShimsDir)) return [];
  try {
    const r = Bun.spawnSync(["mise", "bin-paths"], { env, timeout: 30_000 });
    return r.exitCode === 0 ? r.stdout.toString().split(/\s+/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const clean = sameEnv(process.env, miseToolDirs(process.env));
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, clean);
