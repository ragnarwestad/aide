// What the Settings model routes are tested with: a stand-in for every CLI
// opening the Models tab or an Add would start, a queue config of the test's own,
// and the live model choices as the Settings page offers them.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CheckableTool,
  ProviderStatus,
  ToolCheck,
  ToolModels,
  ToolUsage,
} from "../../../src/render";
import type { QueueDefaults } from "../../../src/queue/types.ts";

export const AT = "2026-10-03T13:30:00.000Z";
export const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json",
};

/** Claude's four families as Claude Code named them on 2026-10-03. */
export const CLAUDE_READING: ToolModels = {
  tool: "claude",
  at: AT,
  offered: [
    { model: "opus", name: "Opus 5.5", id: "claude-opus-5-5" },
    { model: "sonnet", name: "Sonnet 5.5", id: "claude-sonnet-5-5" },
    { model: "fable", name: "Fable 5.1", id: "claude-fable-5-1" },
    { model: "haiku", name: "Haiku 4.5", id: "claude-haiku-4-5-20251001" },
  ],
};

/** Stands in for every CLI a provider's Models or Installation tab starts — the
 *  check and the models — counting which models were read. */
export function modelsProbe(
  readings: Partial<Record<CheckableTool, ToolModels>> = {},
) {
  const probe = {
    modelReads: [] as {
      tool: CheckableTool;
      configured: string[];
      env?: Record<string, string>;
    }[],
    check: async (tool: CheckableTool): Promise<ToolCheck> => ({
      tool,
      at: AT,
      found: true,
      extra: [],
    }),
    models: async (
      tool: CheckableTool,
      opts: { configured: string[]; env?: Record<string, string> },
    ): Promise<ToolModels> => {
      probe.modelReads.push({
        tool,
        configured: opts.configured,
        env: opts.env,
      });
      return readings[tool] ?? { tool, at: AT, offered: [] };
    },
  };
  return probe;
}

/** Fresh every time: the server works on the object it is handed, and a
 *  route that changes the choices changes it. */
export function defaultsOf(
  choices: QueueDefaults["modelChoices"],
  model: Record<string, string>,
): QueueDefaults {
  return {
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { ...model },
    modelChoices: choices ? structuredClone(choices) : undefined,
    providers: structuredClone(PROVIDERS),
  };
}

/** A directory of the test's own holding `queue-config.json` with the
 *  given text, and where `model-ids.json` goes. */
export function ownFiles(
  config: string,
  dirs: string[],
): { file: string; modelIdsPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-settings-models-"));
  dirs.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, config);
  return { file, modelIdsPath: join(dir, "model-ids.json") };
}

/** The model choices the Settings page offers, by value and label, as the
 *  Create row's Model select draws them. */
export async function offeredChoices(
  base: string,
): Promise<Record<string, string>> {
  const html = await (await fetch(`${base}/settings?tab=phases`)).text();
  const select =
    html.match(
      /<select[^>]*name="model\.create"[^>]*>([\s\S]*?)<\/select>/,
    )?.[1] ?? "";
  return Object.fromEntries(
    [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(
      (m) => [m[1]!, m[2]!],
    ),
  );
}

export const post = (
  base: string,
  path: string,
  body: Record<string, string>,
) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

/** The Models tab of a provider opened, which reads its tool's models. */
export const openModelsTab = (base: string, key: string) =>
  fetch(
    `${base}/settings?tab=providers&provider=${encodeURIComponent(key)}&aitab=models`,
  );

/** The providers a tab is read for: one per tool, on the tool's own folders. */
export const PROVIDERS = {
  Claude: { name: "Claude", tool: "claude" as const },
  Codex: { name: "Codex", tool: "codex" as const },
  OpenCode: { name: "OpenCode", tool: "opencode" as const },
};

/** What opening a provider's page reads, so no test starts a real CLI. */
export const stubReads = {
  providerProbe: async (key: string): Promise<ProviderStatus> => ({
    key,
    at: AT,
    installed: true,
  }),
  usageProbe: async (
    _key: string,
    provider: { tool: CheckableTool },
  ): Promise<ToolUsage> => ({ tool: provider.tool, at: AT, windows: [] }),
};
