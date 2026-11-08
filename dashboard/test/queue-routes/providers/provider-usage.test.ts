// A provider's usage on its Usage tab: read before the tab answers, and
// kept for two minutes, so opening the tab again within them reads
// nothing, and an edited provider is read again.

import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { Provider } from "../../../src/queue/providers/index.ts";
import type { QueueDefaults } from "../../../src/queue/types.ts";
import type { ToolUsage } from "../../../src/render";
import { keptUsage, readUsage, USAGE_KEPT_MS } from "../../../src/serve/providers/usage-kept.ts";
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
