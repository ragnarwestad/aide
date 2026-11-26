// Two boards in one process keep their tool checks and model readings
// apart: what one board's Installation and Models tabs read is that
// board's alone, for its Add a model and for its header.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { CheckableTool, ToolCheck, ToolModels } from "../../../src/render";
import type { ModelChoice } from "../../../src/queue/types.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { AT, defaultsOf, ownFiles, post, stubReads } from "../settings-models/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-two-servers-readings-");
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** A probe whose Codex offers `codexModel` and whose every check finds
 *  the tool missing, so each check is a fault the header names. */
function probeOffering(codexModel: string) {
  return {
    check: async (tool: CheckableTool): Promise<ToolCheck> => ({ tool, at: AT, found: false, extra: [] }),
    models: async (tool: CheckableTool): Promise<ToolModels> =>
      ({ tool, at: AT, offered: tool === "codex" ? [{ model: codexModel }] : [] }),
  };
}

/** A board configured for one tool only, on a config file of its own. */
function board(choices: Record<string, ModelChoice>, defaultModel: string, codexModel: string) {
  const config = JSON.stringify({ model: { default: defaultModel }, modelChoices: choices }, null, 2);
  const { file, modelIdsPath } = ownFiles(config, ownDirs);
  return start({
    ...stubReads, queueDefaults: defaultsOf(choices, { default: defaultModel }),
    queueConfigFile: file, modelIdsPath, toolProbe: probeOffering(codexModel),
  });
}

const open = (base: string, provider: string, tab: string) =>
  fetch(`${base}/providers?provider=${encodeURIComponent(provider)}&aitab=${tab}`).then((r) => r.text());

const faultLines = (html: string): string[] => [...html.matchAll(/<p[^>]*tool-fault[^>]*>[\s\S]*?<\/p>/g)].map((m) => m[0]);

describe("two boards in one process", () => {
  test("each board's Add a model reads its own board's Models reading (AC-1, AC-2)", async () => {
    const a = board({ Opus: { model: "opus" } }, "Opus", "model-a");
    const b = board({ "gpt-5.5": { tool: "codex" } }, "gpt-5.5", "model-b");
    await open(a.base, "Codex", "models");
    await open(b.base, "Codex", "models");

    expect((await post(a.base, "/api/queue/settings/models/add", { tool: "codex", model: "model-a" })).status).toBe(200);
    expect((await post(b.base, "/api/queue/settings/models/add", { tool: "codex", model: "model-a" })).status).toBe(400);
    expect(a.server.toolReadings().lastModels().codex?.offered).toEqual([{ model: "model-a" }]);
    expect(b.server.toolReadings().lastModels().codex?.offered).toEqual([{ model: "model-b" }]);
  });

  test("each board's header names the faults of its own configured tools only (AC-1, AC-2)", async () => {
    const a = board({ Opus: { model: "opus" } }, "Opus", "model-a");
    const b = board({ "gpt-5.5": { tool: "codex" } }, "gpt-5.5", "model-b");
    for (const base of [a.base, b.base]) {
      await open(base, "Claude", "installation");
      await open(base, "Codex", "installation");
    }

    const aFaults = faultLines(await (await fetch(`${a.base}/specs`)).text());
    const bFaults = faultLines(await (await fetch(`${b.base}/specs`)).text());
    expect(aFaults).toHaveLength(1);
    expect(aFaults[0]).toContain("Claude");
    expect(bFaults).toHaveLength(1);
    expect(bFaults[0]).toContain("Codex");
  });
});
