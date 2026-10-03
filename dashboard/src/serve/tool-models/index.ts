// Which models each AI offers, read when its Check is pressed and at no
// other time: the start-up check and the re-check before a job call
// `checkTool()`, which reads none of it, and four Claude Code processes a
// round would be too many for either. Each reader asks the tool in a way
// that runs no model.

import { runScript, scriptFor } from "../land-branch/run-script.ts";
import { lastModels, recordModels } from "../../render/ui/tool-checks.ts";
import { CHECK_TIMEOUT_MS, stripAnsi } from "../tool-check.ts";
import { readClaudeModels } from "./claude.ts";
import { readCodexModels } from "./codex.ts";
import type { CheckableTool, OfferedModel, ToolModels } from "../../render";

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
}

/** `opencode models`: one `provider/model` per line, from every provider
 *  that is logged in. A line of any other shape is not a model. */
async function readOpencodeModels(
  run: typeof runScript,
  bin: string,
  base: Pick<ToolModels, "tool" | "at">,
): Promise<ToolModels> {
  const result = await run([bin, "models"], process.cwd(), CHECK_TIMEOUT_MS);
  if (result.timedOut) return { ...base, offered: [], error: "opencode models did not finish in time." };
  if (result.code !== 0) return { ...base, offered: [], error: "opencode models could not be run." };
  const offered: OfferedModel[] = stripAnsi(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\S+\/\S+$/.test(line))
    .map((model) => ({ model }));
  return { ...base, offered };
}

/** One reading of `tool`'s models. Never throws: a CLI that cannot be
 *  started is a reading that failed, said as one. */
export async function readModels(tool: CheckableTool, opts: ModelsOptions = {}): Promise<ToolModels> {
  const path = opts.scriptPath ?? ((name: string) => scriptFor(name));
  const run = opts.run ?? runScript;
  const base = { tool, at: (opts.now ?? (() => new Date()))().toISOString() };
  try {
    switch (tool) {
      case "claude":
        return await readClaudeModels(run, path("claude"), opts.configured ?? [], base);
      case "codex":
        return await readCodexModels(run, path("codex"), base);
      case "opencode":
        return await readOpencodeModels(run, path("opencode"), base);
      case "copilot":
        // No model choice can name Copilot, and its command line cannot
        // list models, so it is not read.
        return { ...base, offered: [], noSource: true };
    }
  } catch (err) {
    return { ...base, offered: [], error: err instanceof Error ? err.message : String(err) };
  }
}
