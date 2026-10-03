// Adding and removing a model choice from an AI's Models tab. The file is
// written first and the live choices after; a refusal changes neither. A
// model is added only when the last reading of its AI's models offered it,
// and a step's default model is never removed from under it.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { parse } from "jsonc-parser";
import { forgetChecks } from "../../../src/serve/tool-check.ts";
import type { ModelChoice } from "../../../src/queue/types.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { AT, CLAUDE_READING, defaultsOf, modelsProbe, offeredChoices, ownFiles, post, pressCheck } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-settings-models-");
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  forgetChecks();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const ADD = "/api/queue/settings/models/add";
const REMOVE = "/api/queue/settings/models/remove";

const CHOICES: Record<string, ModelChoice> = {
  Opus: { model: "opus" },
  "gpt-6.1-sol": { tool: "codex" },
  "gpt-5.6-luna": { tool: "codex" },
};
const MODEL = { default: "Sonnet", analyze: "Opus", implement: "Opus", explore: "opus" };
const CONFIG = `{
  // the operator's own note
  "model": { "default": "Sonnet", "analyze": "Opus", "implement": "Opus", "explore": "opus" },
  "modelChoices": {
    "Opus": { "model": "opus" },
    "gpt-6.1-sol": { "tool": "codex" },
    "gpt-5.6-luna": { "tool": "codex" }
  }
}
`;

const CODEX_READING = {
  tool: "codex" as const, at: AT, offered: [{ model: "gpt-6.1-sol", name: "GPT-6.1-Sol" }, { model: "gpt-5.5", name: "GPT-5.5" }],
};
const OPENCODE_READING = { tool: "opencode" as const, at: AT, offered: [{ model: "opencode/gpt-5.5" }] };

/** A server on a config file of the test's own. */
function serve(probe = modelsProbe(), choices = CHOICES, model: Record<string, string> = MODEL, config = CONFIG) {
  const { file, modelIdsPath } = ownFiles(config, ownDirs);
  const { base } = start({ queueDefaults: defaultsOf(choices, model), toolProbe: probe, queueConfigFile: file, modelIdsPath });
  return { base, file, modelIdsPath, probe };
}

const choicesIn = (file: string): Record<string, ModelChoice> =>
  (parse(readFileSync(file, "utf-8")) as { modelChoices: Record<string, ModelChoice> }).modelChoices;

const errorOf = async (res: Response): Promise<string> => ((await res.json()) as { error: string }).error;

describe("adding a model the AI offers", () => {
  test("is written to the file and the live choices, keeping the rest (AC-1)", async () => {
    forgetChecks();
    const { base, file } = serve(modelsProbe({ codex: CODEX_READING }));
    await pressCheck(base, "codex");
    const res = await post(base, ADD, { tool: "codex", model: "gpt-5.5" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "gpt-5.5" });
    expect(choicesIn(file)["gpt-5.5"]).toEqual({ tool: "codex", model: "gpt-5.5" });
    expect(readFileSync(file, "utf-8")).toContain("// the operator's own note");
    expect(choicesIn(file).Opus).toEqual({ model: "opus" });
    expect(Object.keys(await offeredChoices(base))).toContain("gpt-5.5");
  });

  test("a key another AI's choice holds gets the provider in front (AC-1)", async () => {
    forgetChecks();
    const choices = { ...CHOICES, "gpt-5.5": { tool: "codex" as const } };
    const { base, file } = serve(modelsProbe({ opencode: OPENCODE_READING }), choices);
    await pressCheck(base, "opencode");
    const res = await post(base, ADD, { tool: "opencode", model: "opencode/gpt-5.5" });
    expect(await res.json()).toEqual({ ok: true, name: "opencode-gpt-5.5" });
    expect(choicesIn(file)["opencode-gpt-5.5"]).toEqual({ tool: "opencode", model: "opencode/gpt-5.5" });
    expect(choicesIn(file)["gpt-5.5"]).toBeUndefined();
    expect(Object.keys(await offeredChoices(base))).toContain("gpt-5.5");
  });

  test("a Claude family is added under its capitalised name and shows its version (AC-14)", async () => {
    forgetChecks();
    const { base, file } = serve(modelsProbe({ claude: CLAUDE_READING }));
    await pressCheck(base, "claude");
    const res = await post(base, ADD, { tool: "claude", model: "haiku" });
    expect(await res.json()).toEqual({ ok: true, name: "Haiku" });
    expect(choicesIn(file).Haiku).toEqual({ model: "haiku" });
    expect((await offeredChoices(base)).Haiku).toBe("Haiku 4.5");
  });

  test("a model the last reading did not offer, or no reading at all, is refused (AC-1)", async () => {
    forgetChecks();
    const { base, file } = serve(modelsProbe({ codex: CODEX_READING }));
    for (const body of [{ tool: "codex", model: "gpt-5.5" }, { tool: "claude", model: "haiku" }]) {
      const res = await post(base, ADD, body);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain("Check");
    }
    await pressCheck(base, "codex");
    expect((await post(base, ADD, { tool: "codex", model: "gpt-9" })).status).toBe(400);
    expect(readFileSync(file, "utf-8")).toBe(CONFIG);
  });

  test("a model already a choice of that AI is refused (AC-8)", async () => {
    forgetChecks();
    const { base, file } = serve(modelsProbe({ claude: CLAUDE_READING }));
    await pressCheck(base, "claude");
    expect((await post(base, ADD, { tool: "claude", model: "OPUS" })).status).toBe(400);
    expect(readFileSync(file, "utf-8")).toBe(CONFIG);
  });
});

describe("a Claude model typed as its full id", () => {
  test("is refused like any model the last reading did not offer, asking no CLI (AC-14)", async () => {
    forgetChecks();
    const { base, file, probe } = serve(modelsProbe({ claude: CLAUDE_READING }));
    await pressCheck(base, "claude");
    const before = await offeredChoices(base);
    const res = await post(base, ADD, { tool: "claude", model: "claude-opus-4-8" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("Check");
    expect(probe.modelReads.length).toBe(1);
    expect(readFileSync(file, "utf-8")).toBe(CONFIG);
    expect(await offeredChoices(base)).toEqual(before);
  });
});

describe("removing a model choice", () => {
  test("takes it out of the file and the live choices (AC-2)", async () => {
    const { base, file } = serve();
    const res = await post(base, REMOVE, { name: "gpt-5.6-luna" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "gpt-5.6-luna" });
    expect(choicesIn(file)["gpt-5.6-luna"]).toBeUndefined();
    expect(readFileSync(file, "utf-8")).toContain("// the operator's own note");
    expect(Object.keys(await offeredChoices(base))).not.toContain("gpt-5.6-luna");
  });

  test("a step's default model is refused, naming each step, and nothing changes (AC-9)", async () => {
    const { base, file } = serve();
    const before = await offeredChoices(base);
    const res = await post(base, REMOVE, { name: "Opus" });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    for (const step of ["Analyze", "Implement", "Explore"]) expect(error).toContain(step);
    expect(readFileSync(file, "utf-8")).toBe(CONFIG);
    expect(await offeredChoices(base)).toEqual(before);
  });

  test("the default for every step without its own is named as that (AC-9)", async () => {
    const { base } = serve(modelsProbe(), CHOICES, { default: "Opus" });
    const res = await post(base, REMOVE, { name: "Opus" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("every step without its own");
  });

  test("a name that is no choice is refused (AC-2)", async () => {
    const { base, file } = serve();
    expect((await post(base, REMOVE, { name: "gpt-0" })).status).toBe(400);
    expect(readFileSync(file, "utf-8")).toBe(CONFIG);
  });
});
