// Which models each AI offers, read when a provider's Models tab is opened and at no
// other time: the start-up check and the re-check before a job call
// `checkTool()`, which reads none of it, and four Claude Code processes a
// round would be too many for either. Each reader asks the tool in a way
// that runs no model.

import { runScript, scriptFor } from "../land-branch/run-script.ts";
import { lastModels, recordModels } from "../../render/ui/tool-checks.ts";
import { TOOLS } from "../../queue/providers/tools.ts";
import { TOOL_READERS } from "../tool-readers/index.ts";
import type { CheckableTool, ToolModels } from "../../render";

// The store lives in the render layer beside the checks; re-exported so
// a caller has one import site for "read the models and remember them".
export { lastModels, recordModels };
export { askClaudeModel, CLAUDE_FAMILIES, isClaudeFamily } from "./claude.ts";
export { parseCodexModels } from "./codex.ts";

export interface ModelsOptions {
  /** The model values of this AI's choices, as its command line is given
   *  them. Claude asks each full id among them as well as its families. */
  configured?: string[];
  /** Test seam: what runs the CLI instead of the real binary. */
  run?: typeof runScript;
  /** Test seam: where to find the binaries. */
  scriptPath?: (name: string) => string;
  now?: () => Date;
  /** Added to the environment of every command: the folders of the
   *  provider whose Models tab read the models. */
  env?: Record<string, string>;
}

/** One reading of `tool`'s models. Never throws: a CLI that cannot be
 *  started is a reading that failed, said as one. */
export async function readModels(tool: CheckableTool, opts: ModelsOptions = {}): Promise<ToolModels> {
  const path = opts.scriptPath ?? ((name: string) => scriptFor(name));
  const inner = opts.run ?? runScript;
  const env = opts.env ?? {};
  const run: typeof runScript = (argv, cwd, timeoutMs, owner, extra) => inner(argv, cwd, timeoutMs, owner, { ...extra, ...env });
  const base = { tool, at: (opts.now ?? (() => new Date()))().toISOString() };
  try {
    const reader = TOOLS[tool].readers.models;
    if (reader === "claude") return await TOOL_READERS[reader].models(run, path(tool), opts.configured ?? [], base);
    return await TOOL_READERS[reader].models(run, path(tool), base);
  } catch (err) {
    return { ...base, offered: [], error: err instanceof Error ? err.message : String(err) };
  }
}
