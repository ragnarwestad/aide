// A press of Check reads the AI's models beside its check and its usage.
// For Claude it records the id each choice resolves to, exactly as a run
// does, so every picker shows the version before any run has used it; and
// it never changes a model choice.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { forgetChecks } from "../../../src/serve/tool-check.ts";
import { lastModels } from "../../../src/serve/tool-models";
import type { ToolModels } from "../../../src/render";
import { OPEN_81, setupQueueRoutesHarness } from "../fixtures.ts";
import { AT, CLAUDE_READING, defaultsOf, modelsProbe, offeredChoices, ownFiles, pressCheck } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-check-models-");
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  forgetChecks();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const CHOICES = { Opus: { model: "opus" }, Fable: { model: "fable" }, "gpt-5.5": { tool: "codex" as const } };
const CONFIG = `{
  // the operator's own note
  "model": { "default": "Opus" },
  "modelChoices": {
    "Opus": { "model": "opus" },
    "Fable": { "model": "fable" },
    "gpt-5.5": { "tool": "codex" }
  }
}
`;

const pageText = async (url: string): Promise<string> => (await fetch(url)).text();

describe("a press of Check reads the AI's models", () => {
  test("the answer carries the reading, and the tab is drawn from it (AC-1)", async () => {
    forgetChecks();
    const toolProbe = modelsProbe({ claude: CLAUDE_READING });
    const { base } = start({ queueDefaults: defaultsOf(CHOICES, { default: "Opus" }), toolProbe });
    const res = await pressCheck(base, "claude");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: ToolModels };
    expect(body.models).toEqual(CLAUDE_READING);
    expect(lastModels().claude).toEqual(CLAUDE_READING);
    expect(toolProbe.modelReads).toEqual([{ tool: "claude", configured: ["opus", "fable"] }]);
  });

  test("opening a tab reads no models (AC-8)", async () => {
    forgetChecks();
    const toolProbe = modelsProbe({ claude: CLAUDE_READING });
    const { base } = start({ queueDefaults: defaultsOf(CHOICES, { default: "Opus" }), toolProbe });
    await pageText(`${base}/settings?tab=claude`);
    expect(toolProbe.modelReads).toEqual([]);
  });

  test("a Claude choice that never ran shows its version everywhere, also after a restart (AC-6)", async () => {
    forgetChecks();
    const { modelIdsPath } = ownFiles(CONFIG, ownDirs);
    const toolProbe = modelsProbe({ claude: CLAUDE_READING });
    const first = start({ queueDefaults: defaultsOf(CHOICES, { default: "Opus" }), toolProbe, modelIdsPath });
    expect((await offeredChoices(first.base)).Fable).toBe("Fable");
    expect((await pressCheck(first.base, "claude")).status).toBe(200);
    expect(JSON.parse(readFileSync(modelIdsPath, "utf-8"))).toMatchObject({ Fable: "claude-fable-5-1", Opus: "claude-opus-5-5" });

    const shown = async (base: string) => {
      expect((await offeredChoices(base)).Fable).toBe("Fable 5.1");
      expect(await pageText(`${base}/settings?tab=claude`)).toContain("Fable 5.1");
      expect(await pageText(`${base}/?${OPEN_81}`)).toContain(">Fable 5.1</option>");
    };
    await shown(first.base);

    forgetChecks();
    const afresh = start({ queueDefaults: defaultsOf(CHOICES, { default: "Opus" }), toolProbe: modelsProbe(), modelIdsPath });
    expect(lastModels().claude).toBeUndefined();
    await shown(afresh.base);
  });

  test("a choice named opus[1m] shows the name Claude Code gives it, also after a restart (AC-6)", async () => {
    forgetChecks();
    const { modelIdsPath } = ownFiles(CONFIG, ownDirs);
    const choices = { ...CHOICES, "opus[1m]": {} };
    const reading: ToolModels = {
      ...CLAUDE_READING,
      named: [{ model: "opus[1m]", name: "Opus 5.5 (1M context)", id: "claude-opus-5-5[1m]" }],
    };
    const first = start({ queueDefaults: defaultsOf(choices, { default: "Opus" }), toolProbe: modelsProbe({ claude: reading }), modelIdsPath });
    expect((await offeredChoices(first.base))["opus[1m]"]).toBe("opus[1m]");
    await pressCheck(first.base, "claude");
    expect((await offeredChoices(first.base))["opus[1m]"]).toBe("Opus 5.5 (1M context)");
    expect(await pageText(`${first.base}/settings?tab=claude`)).toContain("Opus 5.5 (1M context)");

    forgetChecks();
    const afresh = start({ queueDefaults: defaultsOf(choices, { default: "Opus" }), toolProbe: modelsProbe(), modelIdsPath });
    expect((await offeredChoices(afresh.base))["opus[1m]"]).toBe("Opus 5.5 (1M context)");
  });

  test("the newest of a run and a Check names the version (AC-6)", async () => {
    forgetChecks();
    const { modelIdsPath } = ownFiles(CONFIG, ownDirs);
    // As a run left it.
    writeFileSync(modelIdsPath, JSON.stringify({ Opus: "claude-opus-5-4" }));
    const newer: ToolModels = {
      ...CLAUDE_READING,
      offered: CLAUDE_READING.offered.map((m) => (m.model === "opus" ? { ...m, name: "Opus 5.6", id: "claude-opus-5-6" } : m)),
    };
    const readings = { claude: CLAUDE_READING };
    const { base } = start({ queueDefaults: defaultsOf(CHOICES, { default: "Opus" }), toolProbe: modelsProbe(readings), modelIdsPath });
    expect((await offeredChoices(base)).Opus).toBe("Opus 5.4");
    await pressCheck(base, "claude");
    expect((await offeredChoices(base)).Opus).toBe("Opus 5.5");
    readings.claude = newer;
    await pressCheck(base, "claude");
    expect((await offeredChoices(base)).Opus).toBe("Opus 5.6");
  });

  test("a press of each AI's Check leaves the config file and the choices as they were (AC-8)", async () => {
    forgetChecks();
    const { file, modelIdsPath } = ownFiles(CONFIG, ownDirs);
    const readings = {
      claude: CLAUDE_READING,
      codex: { tool: "codex" as const, at: AT, offered: [{ model: "gpt-6.1-sol" }] },
      opencode: { tool: "opencode" as const, at: AT, offered: [{ model: "opencode/glm-5" }] },
    };
    const { base } = start({
      queueDefaults: defaultsOf(CHOICES, { default: "Opus" }), toolProbe: modelsProbe(readings), queueConfigFile: file, modelIdsPath,
    });
    const before = Object.keys(await offeredChoices(base));
    for (const tool of ["claude", "codex", "copilot", "opencode"]) {
      expect((await pressCheck(base, tool)).status).toBe(200);
    }
    expect(readFileSync(file, "utf-8")).toBe(CONFIG);
    expect(Object.keys(await offeredChoices(base))).toEqual(before);
  });
});
