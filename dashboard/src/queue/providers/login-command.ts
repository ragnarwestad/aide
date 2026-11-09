// The command a person runs on the serving host to log a provider in.
// Imports nothing at run time, so the Add dialog's script can write the
// command out as the fields are typed.

import type { Provider } from "./index.ts";
import { TOOLS } from "./tools.ts";

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
export function providerLoginCommand(provider: Pick<Provider, "tool"> & Partial<Provider>): string {
  const program = provider.binary ? shellWord(provider.binary) : provider.tool;
  const login = TOOLS[provider.tool].login;
  const folder = loginFolder(provider);
  return `${folder ? `${folder.variable}=${shellWord(folder.path)} ` : ""}${program} ${login.args.join(" ")}`;
}

export function loginFolder(provider: Pick<Provider, "tool"> & Partial<Provider>): { variable: string; path: string } | undefined {
  const login = TOOLS[provider.tool].login;
  if (!("folderVariable" in login)) return undefined;
  const field = login.folderFields.find((name) => provider[name]);
  const path = field ? provider[field] : undefined;
  return path ? { variable: login.folderVariable, path } : undefined;
}
