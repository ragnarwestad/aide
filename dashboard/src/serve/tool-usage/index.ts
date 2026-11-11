// How much of a provider's subscription is used, read when its page opens
// and at no other time: the start-up check and the re-check before a job
// call `checkTool()`, which reads none of it. Each reader asks the tool in
// a way that runs no model, with the provider's folders in the environment.

import { runScript, scriptFor } from "../process";
import { TOOLS } from "../../queue/providers/tools.ts";
import { TOOL_READERS } from "../tool-readers/index.ts";
import { CHECK_TIMEOUT_MS } from "../tool-readers/run.ts";
import { appServerExchange, type UsageExchange } from "./codex.ts";
import type { CheckableTool, ToolUsage } from "../../render";

export { codexWindowName, parseCodexRateLimits } from "./codex.ts";
export { parseClaudeUsage } from "./claude.ts";
export type { UsageExchange };

export interface UsageOptions {
  /** Test seam: what runs `claude` instead of the real binary. */
  run?: typeof runScript;
  /** Test seam: what talks to `codex app-server` instead of the real one. */
  exchange?: UsageExchange;
  /** Test seam: where to find the binaries. */
  scriptPath?: (name: string) => string;
  now?: () => Date;
  timeoutMs?: number;
  /** Added to the environment of whatever is started: the folders of the
   *  provider whose usage is read. */
  env?: Record<string, string>;
}

/** One reading of `tool`'s usage. Never throws: a CLI that cannot be
 *  started is a reading that failed, said as one. */
export async function readUsage(tool: CheckableTool, opts: UsageOptions = {}): Promise<ToolUsage> {
  const path = opts.scriptPath ?? ((name: string) => scriptFor(name));
  const base = { tool, at: (opts.now ?? (() => new Date()))().toISOString() };
  const env = opts.env ?? {};
  const run = opts.run ?? runScript;
  const runWithEnv: typeof runScript = (argv, cwd, timeoutMs, owner, extra) => run(argv, cwd, timeoutMs, owner, { ...extra, ...env });
  try {
    const reader = TOOLS[tool].readers.usage;
    if (reader === "claude") return await TOOL_READERS[reader].usage(runWithEnv, path(tool), base);
    if (reader === "codex") return await TOOL_READERS[reader].usage(opts.exchange ?? appServerExchange, path(tool), base, opts.timeoutMs ?? CHECK_TIMEOUT_MS, env);
    return await TOOL_READERS[reader].usage(base);
  } catch (err) {
    return { ...base, windows: [], error: err instanceof Error ? err.message : String(err) };
  }
}
