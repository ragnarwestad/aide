// The dashboard's three sets of tools and the names they go by, written once.
// This module imports nothing, so any layer can read it at load time without
// joining an import cycle; every type that takes a tool derives from a list here.

/** The tools a provider can be a login for. */
export const PROVIDER_TOOLS = ["claude", "codex", "opencode"] as const;
export type ProviderTool = (typeof PROVIDER_TOOLS)[number];

/** The CLIs a step can run on, as `--tool` spells them. One list, read
 *  wherever a tool name arrives as a string at runtime: the config
 *  file's `modelChoices`, and a result file's own `tool`. A hand-written
 *  copy of these names is how `opencode` reached the board as a type but
 *  not as a value - the type checker cannot see a string comparison. */
export const RUNNABLE_TOOLS = [...PROVIDER_TOOLS, "fake-claude"] as const;
export type RunnableTool = (typeof RUNNABLE_TOOLS)[number];

/** What a step's result records it ran with: `none` is a create that ran no AI. */
export const RESULT_TOOLS = [...RUNNABLE_TOOLS, "none"] as const;
export type ResultTool = (typeof RESULT_TOOLS)[number];

export type LoginFolderField = "configDir" | "shadowHome" | "codexHome";
export interface ToolLogin { args: readonly string[]; folderVariable?: string; folderFields: readonly LoginFolderField[] }
interface ToolDescriptor { name: string; shortName: string; family: ProviderTool; readers: { transcript: ProviderTool } }
type ProviderToolDescriptor = ToolDescriptor & {
  login: ToolLogin;
  readers: ToolDescriptor["readers"] & { login: ProviderTool; models: ProviderTool; usage: ProviderTool };
};

export const TOOLS = {
  claude: { name: "Claude Code", shortName: "Claude", family: "claude", readers: { transcript: "claude", login: "claude", models: "claude", usage: "claude" }, login: { args: ["auth", "login"], folderVariable: "CLAUDE_CONFIG_DIR", folderFields: ["configDir"] } },
  codex: { name: "Codex", shortName: "Codex", family: "codex", readers: { transcript: "codex", login: "codex", models: "codex", usage: "codex" }, login: { args: ["login"], folderVariable: "CODEX_HOME", folderFields: ["shadowHome", "codexHome"] } },
  opencode: { name: "OpenCode", shortName: "OpenCode", family: "opencode", readers: { transcript: "opencode", login: "opencode", models: "opencode", usage: "opencode" }, login: { args: ["auth", "login"], folderFields: [] } },
  "fake-claude": { name: "Fake-Claude", shortName: "Fake-Claude", family: "claude", readers: { transcript: "claude" } },
} as const satisfies { [T in RunnableTool]: T extends ProviderTool ? ProviderToolDescriptor : ToolDescriptor };

export const providerFamily = (tool: RunnableTool): ProviderTool => TOOLS[tool].family;
export const asProviderTool = (value: unknown): ProviderTool | undefined =>
  (PROVIDER_TOOLS as readonly unknown[]).includes(value) ? (value as ProviderTool) : undefined;

/** What each CLI is called on the page. The config's own word is the
 *  short one the runner uses; this is the one a reader picks by.
 *
 *  `fake-claude` is the scripted stand-in a project points
 *  `AIDE_CLAUDE_BIN` at: it speaks Claude Code's own command line and
 *  event format, costs nothing, and answers every step the same way
 *  every time. It is named here so a row running it says so, rather than
 *  reading as a real Claude run. */
export const TOOL_NAMES: Record<RunnableTool, string> = Object.fromEntries(
  RUNNABLE_TOOLS.map((tool) => [tool, TOOLS[tool].name]),
) as Record<RunnableTool, string>;

/** The same tools, in the one word a narrow screen has room for. The
 *  compact picker (`aiModelButton`) shows an AI and a model together in
 *  a box eight characters wide — "Claude Code/sonnet" does not fit, and
 *  the second word is not the one that tells the two tools apart. */
export const SHORT_TOOL_NAMES: Record<RunnableTool, string> = Object.fromEntries(
  RUNNABLE_TOOLS.map((tool) => [tool, TOOLS[tool].shortName]),
) as Record<RunnableTool, string>;
