// A provider's usage on the Providers tab: read on an address of its own
// after the tab has drawn, and kept for two minutes, so the tab shows a
// kept reading at once and an edited provider is read again.

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

const tab = (base: string) => fetch(`${base}/settings?tab=providers&provider=Claude`).then((r) => r.text());

test("once the usage has been read, the tab shows that reading at once and reads nothing more", async () => {
  const { base, reads } = serve();
  expect(await tab(base)).toContain("data-read-from=\"");
  expect(await (await fetch(`${base}/settings/providers/usage?key=Claude`)).text()).toContain("Window of Claude");
  const again = await tab(base);
  expect(again).toContain("Window of Claude");
  expect(again).not.toContain("data-read-from=\"");
  expect(reads).toEqual(["Claude"]);
});

test("a provider edited since its usage was read is read again", async () => {
  const { base } = serve();
  await fetch(`${base}/settings/providers/usage?key=Claude`);
  await post(base, "/api/queue/settings/providers/edit", { key: "Claude", name: "Claude Work" });
  expect(await tab(base)).toContain("data-read-from=\"");
});

test("the usage of a provider that is not there is not found", async () => {
  const { base } = serve();
  expect((await fetch(`${base}/settings/providers/usage?key=Gone`)).status).toBe(404);
});

test("a kept reading is shown for two minutes and no longer", async () => {
  const owner = {};
  const provider: Provider = { name: "Claude", tool: "claude" };
  const usage: ToolUsage = { tool: "claude", at: "2026-11-06T09:00:00.000Z", windows: [] };
  await readUsage(owner, "Claude", provider, async () => usage, () => 1_000);
  expect(keptUsage(owner, "Claude", provider, 1_000 + USAGE_KEPT_MS - 1)).toBe(usage);
  expect(keptUsage(owner, "Claude", provider, 1_000 + USAGE_KEPT_MS)).toBeUndefined();
});
