// The PATH anything this server spawns is given.
//
// This server runs under launchd, whose PATH carries neither
// `~/.local/bin` nor mise's shims. `~/.local/bin` is where the installer
// puts aide's own scripts AND where Claude Code itself lives, so a
// process spawned with the server's own PATH cannot see either.
//
// One function rather than one line per caller: a step's spawn and a
// tool check that disagree about PATH is a check that reports a CLI as
// missing while a real run finds it - which is exactly what happened
// when the two were written separately.

/** `~/.local/bin` prepended, unless it is already there. Prepended to
 *  whatever is present and never replacing it: an operator running the
 *  server from a shell keeps their own PATH. */
export function pathWithLocalBin(env: NodeJS.ProcessEnv = process.env): string {
  const localBin = `${env.HOME ?? ""}/.local/bin`;
  const path = env.PATH ?? "";
  return path.split(":").includes(localBin) ? path : `${localBin}:${path}`;
}

/** The whole environment for a spawn, which is the server's own plus
 *  that one PATH change. */
export function spawnEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  return { ...env, PATH: pathWithLocalBin(env) };
}
