import type { ProviderTool } from "../../queue/providers/tools.ts";
import type { ToolUsage } from "../../render";
import { readClaudeModels } from "../tool-models/claude.ts";
import { readCodexModels } from "../tool-models/codex.ts";
import { readOpencodeModels } from "../tool-models/opencode.ts";
import { readClaudeUsage } from "../tool-usage/claude.ts";
import { readCodexUsage } from "../tool-usage/codex.ts";

const opencodeUsage = async (base: Pick<ToolUsage, "tool" | "at">): Promise<ToolUsage> => ({ ...base, windows: [] });

export const TOOL_READERS = {
  claude: { login: "claude", models: readClaudeModels, usage: readClaudeUsage },
  codex: { login: "codex", models: readCodexModels, usage: readCodexUsage },
  opencode: { login: "opencode", models: readOpencodeModels, usage: opencodeUsage },
} as const satisfies Record<ProviderTool, { login: ProviderTool; models: Function; usage: Function }>;
