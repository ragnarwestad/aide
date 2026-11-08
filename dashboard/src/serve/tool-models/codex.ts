// Codex's models, from `codex debug models`: one JSON object whose
// `models[]` each carry a `slug`, Codex's own `display_name` and a
// `visibility` of `list` or `hide` (codex-cli 0.160.0, 2026-10-03). The
// hidden ones are Codex's own and never offered.

import type { runScript } from "../land-branch/run-script.ts";
import { CHECK_TIMEOUT_MS, stripAnsi } from "../tool-check.ts";
import type { OfferedModel, ToolModels } from "../../render";

export const CODEX_MODELS_ARGS = ["debug", "models"];

/** The models Codex lists, or why its answer could not be read. An answer
 *  without a `models` array of the known shape is never read as none. */
export function parseCodexModels(stdout: string): OfferedModel[] | { error: string } {
  const unknown = { error: "codex debug models answered in a shape this does not know." };
  const text = stripAnsi(stdout);
  const start = text.indexOf("{");
  if (start === -1) return unknown;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch {
    return unknown;
  }
  const models = (parsed as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return unknown;
  const offered: OfferedModel[] = [];
  for (const entry of models) {
    const m = entry as Record<string, unknown> | null;
    if (!m || typeof m.slug !== "string" || !m.slug || typeof m.visibility !== "string") return unknown;
    if (m.visibility === "hide") continue;
    offered.push({ model: m.slug, ...(typeof m.display_name === "string" && m.display_name ? { name: m.display_name } : {}) });
  }
  return offered;
}

export async function readCodexModels(
  run: typeof runScript,
  bin: string,
  base: Pick<ToolModels, "tool" | "at">,
): Promise<ToolModels> {
  const result = await run([bin, ...CODEX_MODELS_ARGS], process.cwd(), CHECK_TIMEOUT_MS);
  if (result.timedOut) return { ...base, offered: [], error: "codex debug models did not finish in time." };
  if (result.code !== 0) return { ...base, offered: [], error: "codex debug models could not be run." };
  const parsed = parseCodexModels(result.stdout);
  return "error" in parsed ? { ...base, offered: [], error: parsed.error } : { ...base, offered: parsed };
}
