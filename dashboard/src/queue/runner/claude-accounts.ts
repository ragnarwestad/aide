// The Claude logins a job can run on. The default account is Claude Code's
// own `~/.claude`; another one is a directory of its own, handed to Claude
// Code as `CLAUDE_CONFIG_DIR`. Which accounts a stopped step may be moved
// to, the key a login's usage-limit hold goes by, and how `~/` is read are
// worked out here from the jobs and the config alone.

import type { Job } from "../queue.ts";

export const DEFAULT_ACCOUNT = "Default";

/** The default account's own directory, as it is written for a person. */
export const DEFAULT_CONFIG_DIR = "~/.claude";

/** `~/…` read against the home directory; any other path is kept. */
export function expandConfigDir(dir: string, home: string): string {
  if (dir === "~") return home;
  return dir.startsWith("~/") ? `${home}/${dir.slice(2)}` : dir;
}

/** The accounts a stopped step may be moved to: every account but its own,
 *  Default included when it is on another one. Empty unless the job stopped
 *  on a usage limit and `tool`, the step's AI as `stepTool` names it (never
 *  the hold key), is claude. Directories are compared expanded. */
export function runOnAccounts(
  job: Job,
  tool: string,
  accounts: Record<string, { configDir: string }> | undefined,
  home: string,
): string[] {
  if (tool !== "claude" || job.state !== "stopped" || job.stopReason !== "provider-limit") return [];
  const own = job.claudeAccount?.configDir ?? expandConfigDir(DEFAULT_CONFIG_DIR, home);
  const others = [
    { name: DEFAULT_ACCOUNT, dir: expandConfigDir(DEFAULT_CONFIG_DIR, home) },
    ...Object.entries(accounts ?? {}).map(([name, a]) => ({ name, dir: expandConfigDir(a.configDir, home) })),
  ].filter((a) => a.dir !== own);
  // Nothing to move to while no account besides Default is configured,
  // unless the job sits on one that has been removed since.
  return Object.keys(accounts ?? {}).length === 0 && !job.claudeAccount ? [] : others.map((a) => a.name);
}

/** The login a job's step uses, as the usage-limit hold keys it: the AI
 *  alone for every AI but Claude and for the default account,
 *  `claude:<configDir>` for a Claude step of a job on another account. */
export function holdKey(job: Job, tool: string): string {
  return tool === "claude" && job.claudeAccount ? `claude:${job.claudeAccount.configDir}` : tool;
}

/** The AI a hold key is for: everything before the first `:`. */
export const keyTool = (key: string): string => key.split(":", 1)[0]!;

/** Every configured account's directory, expanded, one per line: what the
 *  runner's sandbox is told to protect. Undefined when none is configured. */
export function configDirsList(accounts: Record<string, { configDir: string }> | undefined, home: string): string | undefined {
  const dirs = Object.values(accounts ?? {}).map((a) => expandConfigDir(a.configDir, home));
  return dirs.length ? dirs.join("\n") : undefined;
}
