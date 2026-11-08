// The command a person runs on the serving host to log a provider in.
// Imports nothing at run time, so the Add dialog's script can write the
// command out as the fields are typed.

import type { Provider } from "./index.ts";

/** A path as a shell word: left as written when it needs no quoting, else
 *  single-quoted, with a leading `~/` kept outside the quotes so it still
 *  expands. */
function shellWord(path: string): string {
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(path)) return path;
  const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
  return path.startsWith("~/") ? `~/${quote(path.slice(2))}` : quote(path);
}

/** The command that logs the provider in, its folder and its program
 *  written as they are stored (quoted where a shell needs it), so a person
 *  can paste it into a terminal. */
export function providerLoginCommand(
  provider: Pick<Provider, "tool"> & Partial<Provider>,
): string {
  const program = provider.binary ? shellWord(provider.binary) : provider.tool;
  if (provider.tool === "opencode") return `${program} auth login`;
  if (provider.tool === "claude") {
    return `${provider.configDir ? `CLAUDE_CONFIG_DIR=${shellWord(provider.configDir)} ` : ""}${program} auth login`;
  }
  const folder = provider.shadowHome || provider.codexHome;
  return `${folder ? `CODEX_HOME=${shellWord(folder)} ` : ""}${program} login`;
}
