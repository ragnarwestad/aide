// What the board reads of one provider: whether its tool starts, the version
// it prints, and its login. Everything is asked from the board's own
// process with the provider's folder in the environment, so the answer is
// what a step on that provider would meet — a login the keychain keeps
// readable from a terminal and not from the board's launchd job shows up
// here as not logged in.

import { homedir } from "node:os";
import {
  expandDir,
  providerLoginEnv,
  type Provider,
} from "../../queue/providers/index.ts";
import { runScript, scriptFor } from "../land-branch/run-script.ts";
import {
  askLogin,
  CHECK_TIMEOUT_MS,
  stripAnsi,
  type CheckOptions,
} from "../tool-check.ts";
import { readUsage, type UsageOptions } from "../tool-usage";
import type { ProviderStatus, ToolUsage } from "../../render";

export type { ProviderStatus };

/** Reads `key`'s provider: `<tool> --version` first, and the login only when
 *  the tool started — asking a login of a tool that is not there would say
 *  "not logged in" for what is "not installed". */
export async function readProviderStatus(
  key: string,
  provider: Provider,
  opts: Pick<CheckOptions, "run" | "scriptPath" | "now" | "home"> & {
    /** `false` stops after `--version`: a save asks only whether the tool is
     *  there, never for a login. */
    login?: boolean;
  } = {},
): Promise<ProviderStatus> {
  const run = opts.run ?? runScript;
  const home = opts.home ?? homedir();
  const bin = provider.binary
    ? expandDir(provider.binary, home)
    : (opts.scriptPath ?? ((name: string) => scriptFor(name)))(provider.tool);
  const at = (opts.now ?? (() => new Date()))().toISOString();
  const env = providerLoginEnv(provider, home);

  let printed: string | undefined;
  try {
    const result = await run(
      [bin, "--version"],
      process.cwd(),
      CHECK_TIMEOUT_MS,
      undefined,
      env,
    );
    // A shim left behind by a version manager runs and exits 127 for a tool
    // it no longer has.
    if (result.code === 127) return { key, at, installed: false };
    printed = stripAnsi(result.stdout)
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "");
  } catch {
    return { key, at, installed: false };
  }
  if (opts.login === false)
    return {
      key,
      at,
      installed: true,
      ...(printed ? { version: printed } : {}),
    };
  const login = await askLogin(provider.tool, run, bin, provider, home);
  return {
    key,
    at,
    installed: true,
    ...(printed ? { version: printed } : {}),
    login,
  };
}

/** Reads `provider`'s usage with its own folders in the environment, so two
 *  providers of one tool on two accounts each show their own. */
export function readProviderUsage(
  _key: string,
  provider: Provider,
  opts: Omit<UsageOptions, "env"> & { home?: string } = {},
): Promise<ToolUsage> {
  const { home, ...rest } = opts;
  const at = home ?? homedir();
  const own = provider.binary
    ? { scriptPath: () => expandDir(provider.binary!, at) }
    : {};
  return readUsage(provider.tool, {
    ...rest,
    ...own,
    env: providerLoginEnv(provider, at),
  });
}
