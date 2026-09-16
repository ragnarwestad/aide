// The PATH anything this server spawns is given.
//
// A skill like `/aide-analyze` runs INSIDE a CLI the person started
// themselves, with their own shell's environment. The board is the other
// way round: it starts the CLI, from outside, under launchd - and
// launchd's PATH carries neither `~/.local/bin` (aide's own scripts, and
// Claude Code itself) nor mise's shims (Codex, Copilot, OpenCode). So
// the board has to put those directories back before it spawns anything,
// or it cannot find the very tools it exists to run.
//
// One function rather than one line per caller: a step's spawn and a
// tool check that disagree about PATH is a check that reports a CLI as
// missing while a real run finds it - which is exactly what happened
// when the two were written separately.
//
// Prepended, never replacing: an operator running the server from a
// shell keeps their own PATH, and a directory already on it is left
// where it is rather than moved to the front.

import { existsSync } from "node:fs";

/** Where mise puts the shims that stand in for the tools it manages.
 *  One stable path whatever version is current, which is why a shim can
 *  be named directly. `MISE_DATA_DIR` is mise's own override; the
 *  fallback is its default. */
function miseShims(env: NodeJS.ProcessEnv): string {
  const data = env.MISE_DATA_DIR || `${env.HOME ?? ""}/.local/share/mise`;
  return `${data}/shims`;
}

/** The directories a spawned process needs beyond whatever the server
 *  itself was given. Only directories that EXIST are added: a machine
 *  with no mise gains nothing from a path that is not there, and an
 *  entry resolving to nothing is one more thing to explain the day
 *  something cannot be found. */
export function extraPathDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME ?? "";
  if (!home) return [];
  return [`${home}/.local/bin`, miseShims(env)].filter((dir) => existsSync(dir));
}

/** The server's own PATH with those directories in front of it. */
export function pathWithToolDirs(env: NodeJS.ProcessEnv = process.env): string {
  const path = env.PATH ?? "";
  const present = new Set(path.split(":"));
  const missing = extraPathDirs(env).filter((dir) => !present.has(dir));
  return missing.length === 0 ? path : `${missing.join(":")}:${path}`;
}

/** The whole environment for a spawn, which is the server's own plus
 *  that one PATH change. */
export function spawnEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  return { ...env, PATH: pathWithToolDirs(env) };
}
