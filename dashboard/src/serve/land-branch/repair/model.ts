import { homedir } from "node:os";
import type { Job, QueueDefaults } from "../../../queue/queue.ts";
import { resolveStepModel } from "../../../queue/model-name.ts";
import { expandDir, providerLoginEnv, resolveStepProvider } from "../../../queue/providers/index.ts";

export function repairModel(defaults: QueueDefaults, job: Job, prompt: string) {
  const name = resolveStepModel(job, "implement", defaults.model);
  const choice = name ? defaults.modelChoices?.[name] : undefined;
  if (!name || !choice) return undefined;
  const key = resolveStepProvider(job, "implement", defaults);
  const provider = key ? defaults.providers?.[key] : undefined;
  if (provider?.enabled === false) return undefined;
  const tool = provider?.tool ?? choice.tool ?? "claude";
  const binary = provider?.binary ? expandDir(provider.binary, homedir()) : tool;
  const model = choice.model ?? name;
  const argv = tool === "codex" ? [binary, "exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--model", model, prompt]
    : tool === "claude" ? [binary, "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--model", model, prompt]
      : tool === "opencode" ? [binary, "run", "--format", "json", "--agent", "build", "--auto", "--model", model, prompt] : [];
  if (!argv.length) return undefined;
  return { name, key: key ?? tool, argv, env: { ...(provider ? providerLoginEnv(provider, homedir()) : {}), AIDE_HEADLESS: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" } };
}
