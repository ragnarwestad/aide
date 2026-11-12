// A provider's usage on its Usage tab: read before the tab answers, and
// kept for two minutes, so opening the tab again within them reads
// nothing, and an edited provider is read again.

import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { Provider } from "../../../src/queue/providers/index.ts";
import type { QueueDefaults } from "../../../src/queue/types.ts";
import type { ToolUsage } from "../../../src/render";
import { keptUsage, readUsage, readUsageJoined, USAGE_KEPT_MS } from "../../../src/serve/providers/usage-kept.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { defaultsOf, ownFiles, post } from "../settings-models/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-provider-usage-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

function serve() {
  const reads: string[] = [];
  const { file, modelIdsPath } = ownFiles(`{ "model": { "default": "Opus" } }\n`, ownDirs);
  const queueDefaults = {
    ...defaultsOf({ Opus: {} }, { default: "Opus" }),
    providers: { Claude: { name: "Claude", tool: "claude" } },
  } as QueueDefaults;
  const usageProbe = async (key: string, provider: Provider): Promise<ToolUsage> => {
    reads.push(key);
    return { tool: provider.tool, at: "2026-11-06T09:00:00.000Z", windows: [{ name: `Window of ${provider.name}`, usedPercent: 7 }] };
  };
  const { base } = start({
    queueDefaults, queueConfigFile: file, modelIdsPath, usageProbe,
    providerProbe: async (key: string) => ({ key, at: "2026-11-06T09:00:00.000Z", installed: true }),
  });
  return { base, reads };
}

const tab = (base: string) => fetch(`${base}/settings?tab=providers&provider=Claude&aitab=usage`).then((r) => r.text());

test("the Usage tab shows the usage it read, and opened again within two minutes reads nothing more", async () => {
  const { base, reads } = serve();
  expect(await tab(base)).toContain("Window of Claude");
  expect(await tab(base)).toContain("Window of Claude");
  expect(reads).toEqual(["Claude"]);
});

test("a provider edited since its usage was read is read again", async () => {
  const { base, reads } = serve();
  await tab(base);
  await post(base, "/api/queue/settings/providers/edit", { key: "Claude", name: "Claude Work" });
  expect(await tab(base)).toContain("Window of Claude Work");
  expect(reads).toEqual(["Claude", "Claude"]);
});

test("no other tab of the provider reads the usage", async () => {
  const { base, reads } = serve();
  for (const other of ["config", "models", "installation"]) await fetch(`${base}/settings?tab=providers&provider=Claude&aitab=${other}`);
  expect(reads).toEqual([]);
});

test("a kept reading is shown for two minutes and no longer", async () => {
  const owner = {};
  const provider: Provider = { name: "Claude", tool: "claude" };
  const usage: ToolUsage = { tool: "claude", at: "2026-11-06T09:00:00.000Z", windows: [] };
  await readUsage(owner, "Claude", provider, async () => usage, () => 1_000);
  expect(keptUsage(owner, "Claude", provider, 1_000 + USAGE_KEPT_MS - 1)).toBe(usage);
  expect(keptUsage(owner, "Claude", provider, 1_000 + USAGE_KEPT_MS)).toBeUndefined();
});

test("dialog asks made while one provider is being read join the same read (AC-7)", async () => {
  const owner = {};
  const provider: Provider = { name: "Claude", tool: "claude" };
  let reads = 0;
  let release!: (usage: ToolUsage) => void;
  const held = new Promise<ToolUsage>((resolve) => { release = resolve; });
  const read = async () => { reads += 1; return held; };
  const first = readUsageJoined(owner, "Claude", provider, read);
  const second = readUsageJoined(owner, "Claude", provider, read);
  release({ tool: "claude", at: "2026-11-06T09:00:00.000Z", windows: [] });
  expect(await Promise.all([first, second])).toHaveLength(2);
  expect(reads).toBe(1);
});

test("concurrent Usage-tab asks still make separate readings", async () => {
  const owner = {};
  const provider: Provider = { name: "Claude", tool: "claude" };
  let reads = 0;
  const read = async (): Promise<ToolUsage> => {
    reads += 1;
    return { tool: "claude", at: "2026-11-06T09:00:00.000Z", windows: [] };
  };
  await Promise.all([readUsage(owner, "Claude", provider, read), readUsage(owner, "Claude", provider, read)]);
  expect(reads).toBe(2);
});

test("the dialog route starts missing providers together and excludes OpenCode (AC-6, AC-7, AC-9)", async () => {
  const started: string[] = [];
  const releases = new Map<string, (usage: ToolUsage) => void>();
  const { file, modelIdsPath } = ownFiles(`{ "model": { "default": "Opus" } }\n`, ownDirs);
  const providers = {
    Claude: { name: "Claude", tool: "claude" as const },
    Codex: { name: "Codex", tool: "codex" as const },
    OpenCode: { name: "OpenCode", tool: "opencode" as const },
  };
  const { base } = start({
    queueDefaults: { ...defaultsOf({ Opus: {} }, { default: "Opus" }), providers },
    queueConfigFile: file, modelIdsPath,
    usageProbe: async (key) => {
      started.push(key);
      return await new Promise<ToolUsage>((resolve) => releases.set(key, resolve));
    },
    providerProbe: async (key: string) => ({ key, at: "2026-11-06T09:00:00.000Z", installed: true }),
  });
  const html = await fetch(`${base}/api/queue/settings/providers/usage`).then((response) => response.text());
  expect(started).toEqual(["Claude", "Codex"]);
  expect(html).toContain("Claude");
  expect(html).toContain("Codex");
  expect(html).not.toContain("OpenCode");
  for (const [key, release] of releases) release({ tool: providers[key as keyof typeof providers].tool, at: "2026-11-06T09:00:00.000Z", windows: [] });
});
