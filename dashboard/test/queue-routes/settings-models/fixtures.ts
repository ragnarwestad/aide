// What the Settings model routes are tested with: a stand-in for every CLI
// a press of Check or Add would start, a queue config of the test's own,
// and the live model choices as the Settings page offers them.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckableTool, ToolCheck, ToolModels, ToolUsage } from "../../../src/render";
import type { QueueDefaults } from "../../../src/queue/types.ts";
import type { ClaudeModelAnswer } from "../../../src/serve/tool-models";

export const AT = "2026-10-03T13:30:00.000Z";
export const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

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

/** Stands in for every CLI: the check, the usage, the models and the one
 *  `/model` ask an Add makes, counting what each was asked. */
export function modelsProbe(
  readings: Partial<Record<CheckableTool, ToolModels>> = {},
  names: Record<string, ClaudeModelAnswer> = {},
) {
  const probe = {
    asked: [] as string[],
    modelReads: [] as { tool: CheckableTool; configured: string[] }[],
    check: async (tool: CheckableTool): Promise<ToolCheck> => ({ tool, at: AT, found: true, lines: [], extra: [] }),
    usage: async (tool: CheckableTool): Promise<ToolUsage> => ({ tool, at: AT, windows: [] }),
    models: async (tool: CheckableTool, opts: { configured: string[] }): Promise<ToolModels> => {
      probe.modelReads.push({ tool, configured: opts.configured });
      return readings[tool] ?? { tool, at: AT, offered: [] };
    },
    claudeName: async (id: string): Promise<ClaudeModelAnswer> => {
      probe.asked.push(id);
      return names[id] ?? { known: false };
    },
  };
  return probe;
}

/** Fresh every time: the server works on the object it is handed, and a
 *  route that changes the choices changes it. */
export function defaultsOf(choices: QueueDefaults["modelChoices"], model: Record<string, string>): QueueDefaults {
  return {
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { ...model },
    modelChoices: choices ? structuredClone(choices) : undefined,
  };
}

/** A directory of the test's own holding `queue-config.json` with the
 *  given text, and where `model-ids.json` goes. */
export function ownFiles(config: string, dirs: string[]): { file: string; modelIdsPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-settings-models-"));
  dirs.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, config);
  return { file, modelIdsPath: join(dir, "model-ids.json") };
}

/** The model choices the Settings page offers, by value and label, as the
 *  Create row's Model select draws them. */
export async function offeredChoices(base: string): Promise<Record<string, string>> {
  const html = await (await fetch(`${base}/settings?tab=phases`)).text();
  const select = html.match(/<select[^>]*name="model\.create"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
  return Object.fromEntries(
    [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1]!, m[2]!]),
  );
}

export const post = (base: string, path: string, body: Record<string, string>) =>
  fetch(`${base}${path}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

export const pressCheck = (base: string, tool: string) => post(base, "/api/queue/settings/check", { tool });
