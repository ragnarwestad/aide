// What the board reads of one provider: whether its tool starts, the version
// it prints, and its login. Everything is asked from the board's own
// process with the provider's folder in the environment, so the answer is
// what a step on that provider would meet — a login the keychain keeps
// readable from a terminal and not from the board's launchd job shows up
// here as not logged in.

import { homedir } from "node:os";
import { providerLoginEnv, type Provider } from "../../queue/providers/index.ts";
import { runScript, scriptFor } from "../land-branch/run-script.ts";
import { askLogin, CHECK_TIMEOUT_MS, stripAnsi, type CheckOptions } from "../tool-check.ts";
import type { ProviderStatus } from "../../render";

export type { ProviderStatus };

/** Reads `key`'s provider: `<tool> --version` first, and the login only when
 *  the tool started — asking a login of a tool that is not there would say
 *  "not logged in" for what is "not installed". */
export async function readProviderStatus(
  key: string,
  provider: Provider,
  opts: Pick<CheckOptions, "run" | "scriptPath" | "now" | "home"> = {},
): Promise<ProviderStatus> {
  const run = opts.run ?? runScript;
  const bin = (opts.scriptPath ?? ((name: string) => scriptFor(name)))(provider.tool);
  const at = (opts.now ?? (() => new Date()))().toISOString();
  const home = opts.home ?? homedir();
  const env = providerLoginEnv(provider, home);

  let printed: string | undefined;
  try {
    const result = await run([bin, "--version"], process.cwd(), CHECK_TIMEOUT_MS, undefined, env);
    printed = stripAnsi(result.stdout).split("\n").map((l) => l.trim()).find((l) => l !== "");
  } catch {
    return { key, at, installed: false };
  }
  const login = await askLogin(provider.tool, run, bin, provider, home);
  return { key, at, installed: true, ...(printed ? { version: printed } : {}), login };
}
