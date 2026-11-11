import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { mergeQueueDefaults, type QueueDefaults } from "../../src/queue/queue.ts";
import { SETTINGS_STEPS } from "../../src/render";
import { QUEUE_DEFAULTS } from "../../src/serve/serve-helpers/config.ts";
import { setupQueueRoutesHarness } from "./fixtures.ts";
import {
  CLAUDE_READING, JSON_HEADERS, modelsProbe, openModelsTab, stubReads,
} from "./settings-models/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-settings-save-");
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

function config(raw: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-settings-save-config-"));
  ownDirs.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, JSON.stringify(raw, null, 2));
  return file;
}

function saved(file: string): Record<string, unknown> {
  return parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
}

function expected(file: string): QueueDefaults {
  return mergeQueueDefaults(QUEUE_DEFAULTS, saved(file));
}

function staleDefaults(): QueueDefaults {
  return {
    timeoutSec: { default: 99 },
    permissionMode: { default: "acceptEdits" },
    model: { default: "Opus", review: "Spare", verify: "Spare" },
    modelChoices: { Opus: {}, Spare: { model: "spare" }, Ghost: { model: "ghost" } },
    providers: {
      Claude: { name: "Claude", tool: "claude" },
      Spare: { name: "Stale", tool: "claude", enabled: false },
    },
  };
}

async function shownConcurrency(base: string): Promise<number> {
  const html = await (await fetch(`${base}/settings?tab=process`)).text();
  return Number(html.match(/<input[^>]*name="concurrency"[^>]*value="(\d+)"/)?.[1]);
}

const post = (base: string, path: string, body: Record<string, unknown>) =>
  fetch(`${base}${path}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

describe("saved queue settings are applied through the startup rules", () => {
  test("a config created after startup cannot turn saved values into built-in defaults (AC-3)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-settings-save-late-config-"));
    ownDirs.push(dir);
    const file = join(dir, "queue-config.json");
    const { base } = start({
      ...stubReads,
      queueConfigFile: file,
      toolProbe: modelsProbe({ claude: CLAUDE_READING }),
    });
    writeFileSync(file, JSON.stringify({ modelChoices: { Opus: {} } }, null, 2));
    await openModelsTab(base, "Claude");
    expect((await post(base, "/api/queue/settings/models/add", { tool: "claude", model: "fable" })).status).toBe(200);
    const model = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "Opus"]));
    const timeoutSec = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, 30]));
    expect((await post(base, "/api/queue/settings", {
      model: { ...model, review: "Fable" }, timeoutSec,
    })).status).toBe(200);
    expect((await post(base, "/api/queue/settings", {
      model: { ...model, review: "" }, timeoutSec,
    })).status).toBe(200);

    expect((saved(file).model as Record<string, unknown>).review).toBeUndefined();
    expect(QUEUE_DEFAULTS.model.review).toBeUndefined();
  });

  test("a partial phase save preserves omitted values and clears a side default (AC-1, AC-2, AC-3)", async () => {
    const file = config({
      concurrency: 5,
      model: { default: "Opus", review: "Spare", verify: "Spare", future: "keep" },
      modelChoices: { Opus: {}, Spare: { model: "spare" } },
      timeoutSec: { default: 1200, future: 777 },
    });
    const defaults = staleDefaults();
    const identity = defaults;
    const own = mkdtempSync(join(tmpdir(), "aide-settings-save-runner-"));
    ownDirs.push(own);
    const { base } = start({
      queueConfigFile: file,
      queueDefaults: defaults,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: join(own, "jobs"),
      queueConcurrency: 1,
    });
    const model = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "Opus"]));
    const timeoutSec = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, 30]));

    const response = await post(base, "/api/queue/settings", {
      model: { ...model, review: "" },
      timeoutSec,
    });

    expect(response.status).toBe(200);
    expect(defaults).toBe(identity);
    expect(defaults).toEqual(expected(file));
    expect(saved(file).model).toMatchObject({ verify: "Spare", future: "keep" });
    expect((saved(file).model as Record<string, unknown>).review).toBeUndefined();
    expect(await shownConcurrency(base)).toBe(5);
  });

  test("model-choice removal drops stale live choices through the complete saved result (AC-1, AC-3)", async () => {
    const file = config({
      model: { default: "Opus" },
      modelChoices: { Opus: {}, Spare: { model: "spare" } },
    });
    const defaults = staleDefaults();
    defaults.model = { default: "Opus" };
    const { base } = start({ queueConfigFile: file, queueDefaults: defaults });

    const response = await post(base, "/api/queue/settings/models/remove", { name: "Spare" });

    expect(response.status).toBe(200);
    expect(defaults).toEqual(expected(file));
    expect(defaults.modelChoices).toEqual({ Opus: {} });
  });

  test("provider edit, switch and removal each reapply the complete saved settings (AC-1, AC-3)", async () => {
    const claudeDir = mkdtempSync(join(tmpdir(), "aide-settings-save-claude-"));
    const ghostDir = mkdtempSync(join(tmpdir(), "aide-settings-save-ghost-"));
    ownDirs.push(claudeDir, ghostDir);
    const file = config({
      model: { default: "Opus" },
      modelChoices: { Opus: {} },
      providers: { Claude: { name: "Claude", tool: "claude", configDir: claudeDir } },
    });
    const defaults = staleDefaults();
    defaults.providers = {
      Claude: { name: "Old name", tool: "claude", configDir: claudeDir },
      Ghost: { name: "Ghost", tool: "claude", configDir: ghostDir },
    };
    const { base } = start({
      queueConfigFile: file,
      queueDefaults: defaults,
      providerProbe: async (key) => ({ key, at: "2026-11-11T12:00:00.000Z", installed: true }),
    });

    expect((await post(base, "/api/queue/settings/providers/edit", {
      key: "Claude", name: "Claude Live", configDir: claudeDir,
    })).status).toBe(200);
    expect(defaults).toEqual(expected(file));
    expect((await post(base, "/api/queue/settings/providers/switch", { key: "Claude", enabled: false })).status).toBe(200);
    expect(defaults).toEqual(expected(file));
    expect((await post(base, "/api/queue/settings/providers/remove", { key: "Claude" })).status).toBe(200);
    expect(defaults).toEqual(expected(file));
  });

  test("a persistence refusal leaves live defaults and concurrency unchanged (AC-4)", async () => {
    const file = config({ model: { default: "Opus" } });
    writeFileSync(file, "not jsonc");
    const defaults = staleDefaults();
    const before = structuredClone(defaults);
    const own = mkdtempSync(join(tmpdir(), "aide-settings-save-refusal-"));
    ownDirs.push(own);
    const { base } = start({
      queueConfigFile: file,
      queueDefaults: defaults,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: join(own, "jobs"),
      queueConcurrency: 3,
    });

    const response = await post(base, "/api/queue/settings/concurrency", { concurrency: 6 });

    expect(response.status).toBe(400);
    expect(defaults).toEqual(before);
    expect(await shownConcurrency(base)).toBe(3);
  });
});
