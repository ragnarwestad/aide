// The board the Providers page's browser tests open: two providers in its
// queue config, each probed as installed, with no usage to show.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QueueHarness } from "../../helpers/queue-server.ts";

const PROVIDERS = {
  Claude: { name: "Claude", tool: "claude" as const },
  OpenCode: { name: "OpenCode", tool: "opencode" as const },
};
export const AT = "2026-11-05T09:00:00.000Z";

/** Writes a queue config holding the two providers into a new folder named
 *  from `scratchPrefix`, and starts `harness` on it, with `probes` beside
 *  the default ones. Returns the board's address and the folder. */
export function startProviderBoard(
  harness: QueueHarness,
  scratchPrefix: string,
  probes: Record<string, unknown> = {},
): { base: string; scratch: string } {
  const scratch = mkdtempSync(join(tmpdir(), scratchPrefix));
  const file = join(scratch, "queue-config.json");
  writeFileSync(file, JSON.stringify({ providers: PROVIDERS }, null, 2));
  const base = harness.start({
    extra: {
      queueConfigFile: file,
      queueDefaults: {
        timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" },
        providers: structuredClone(PROVIDERS),
      },
      providerProbe: async (key: string) => ({ key, at: AT, installed: true }),
      usageProbe: async (_key: string, provider: { tool: "claude" | "codex" | "opencode" }) => ({ tool: provider.tool, at: AT, windows: [] }),
      ...probes,
    },
  }).base;
  return { base, scratch };
}
