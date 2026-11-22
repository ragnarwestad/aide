import { homedir } from "node:os";
import type { Job, QueueDefaults } from "../../../queue/queue.ts";
import { resolveStepModel } from "../../../queue/model-name.ts";
import { expandDir, providerLoginEnv, resolveStepProvider } from "../../../queue/providers/index.ts";
import { forProject } from "../../../queue/providers/project-defaults.ts";

/** A repair takes no messages from the user's other Claude sessions and sends none. */
const NO_SESSION_MESSAGES = JSON.stringify({ crossSessionInbound: "refuse", permissions: { deny: ["SendMessage", "ListAgents"] } });

export function repairModel(board: QueueDefaults, job: Job, prompt: string) {
  const defaults = forProject(board, job.project);
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
    : tool === "claude" ? [binary, "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      "--settings", NO_SESSION_MESSAGES, "--model", model, prompt]
      : tool === "opencode" ? [binary, "run", "--standalone", "--format", "json", "--agent", "build", "--auto", "--model", model, prompt] : [];
  if (!argv.length) return undefined;
  return { name, key: key ?? tool, argv, env: { ...(provider ? providerLoginEnv(provider, homedir()) : {}), AIDE_HEADLESS: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" } };
}

/** Provider events can contain recoverable tool errors inside a successful turn. */
export function repairSessionFailed(stdout: string): boolean {
  return stdout.split("\n").some(line => {
    try {
      const event = JSON.parse(line);
      return event?.type === "turn.failed" || event?.type === "error" ||
        (event?.type === "result" && (event.is_error === true || event.subtype?.startsWith("error")));
    } catch { return false; }
  });
}
