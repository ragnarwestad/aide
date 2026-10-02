// How much of each AI's subscription is used, read when its Check is
// pressed and at no other time: the start-up check and the re-check
// before a job call `checkTool()`, which reads none of it. Each reader
// asks the tool in a way that runs no model.

import { runScript, scriptFor } from "../land-branch/run-script.ts";
import { lastUsage, recordUsage } from "../../render/ui/tool-checks.ts";
import { CHECK_TIMEOUT_MS } from "../tool-check.ts";
import { readClaudeUsage } from "./claude.ts";
import { appServerExchange, readCodexUsage, type UsageExchange } from "./codex.ts";
import type { CheckableTool, ToolUsage } from "../../render";

// The store lives in the render layer beside the checks; re-exported so
// a caller has one import site for "read the usage and remember it".
export { lastUsage, recordUsage };
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
}

/** One reading of `tool`'s usage. Never throws: a CLI that cannot be
 *  started is a reading that failed, said as one. */
export async function readUsage(tool: CheckableTool, opts: UsageOptions = {}): Promise<ToolUsage> {
  const path = opts.scriptPath ?? ((name: string) => scriptFor(name));
  const base = { tool, at: (opts.now ?? (() => new Date()))().toISOString() };
  try {
    switch (tool) {
      case "claude":
        return await readClaudeUsage(opts.run ?? runScript, path("claude"), base);
      case "codex":
        return await readCodexUsage(opts.exchange ?? appServerExchange, path("codex"), base, opts.timeoutMs ?? CHECK_TIMEOUT_MS);
      case "opencode":
        // Every model is a provider's, and OpenCode keeps no usage window
        // of its own.
        return { ...base, windows: [] };
      case "copilot":
        // The Copilot CLI has no command that reports it, so it is not
        // read — which is not the same as having none.
        return { ...base, windows: [], noSource: true };
    }
  } catch (err) {
    return { ...base, windows: [], error: err instanceof Error ? err.message : String(err) };
  }
}
