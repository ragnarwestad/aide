// A provider's subscription usage as the server keeps it. Reading it runs the
// tool (`claude -p /usage` takes seconds), so no page reads it: the server
// reads every Claude Code and Codex provider when it starts and then on a
// timer, and a provider again when it is saved. The latest finished reading
// of each provider is kept, per server and under the provider's key, until a
// newer one replaces it; the header's panel, its route and the Usage tab show
// that reading.

import type { Provider } from "../../queue/providers/index.ts";
import type { ToolUsage } from "../../render";
import { readProviderUsage } from "./status.ts";

/** How often the server reads every provider's usage again. */
export const USAGE_POLL_MS = 60_000;

/** What reads one provider's usage: the real tool, or a test's stand-in. */
export type UsageRead = (key: string, provider: Provider) => Promise<ToolUsage>;
/** A reading under way: the provider as it was read, and when it ends. */
interface Underway { as: string; done: Promise<void> }

const kept = new WeakMap<object, Map<string, ToolUsage>>();
const reading = new WeakMap<object, Map<string, Underway>>();
const mapOf = <V>(maps: WeakMap<object, Map<string, V>>, owner: object): Map<string, V> => {
  let map = maps.get(owner);
  if (!map) maps.set(owner, (map = new Map()));
  return map;
};

/** The tools whose usage the server reads: the ones that report usage windows. */
export const readsUsage = (tool: string): boolean => tool === "claude" || tool === "codex";

/** What reads a Claude Code or Codex usage on this server: the test's probe,
 *  the real tools on a server started to check them, and otherwise nothing,
 *  so a server nobody asked to check anything never starts a CLI for it. */
export function usageReader(opts: { usageProbe?: UsageRead; checkToolsOnStart?: boolean }): UsageRead | undefined {
  return opts.usageProbe ?? (opts.checkToolsOnStart ? readProviderUsage : undefined);
}

/** The provider's latest finished reading, however old. */
export function keptUsage(owner: object, key: string): ToolUsage | undefined {
  return mapOf(kept, owner).get(key);
}

/** Reads the provider's usage and keeps the answer, unless a reading of the
 *  provider as it stands is under way. An answer a newer reading overtook is
 *  dropped, and a reading that throws leaves the earlier one in place. */
export function readUsage(owner: object, key: string, provider: Provider, read: UsageRead): Promise<void> {
  const reads = mapOf(reading, owner);
  const as = JSON.stringify(provider);
  const current = reads.get(key);
  if (current?.as === as) return current.done;
  const latest = (): boolean => reads.get(key)?.done === done;
  const done: Promise<void> = (async () => read(key, provider))()
    .then((usage) => { if (latest()) mapOf(kept, owner).set(key, usage); })
    .catch(() => {})
    .finally(() => { if (latest()) reads.delete(key); });
  reads.set(key, { as, done });
  return done;
}

/** One round: reads every Claude Code and Codex provider not being read already. */
export async function readAllUsage(owner: object, providers: Record<string, Provider>, read: UsageRead): Promise<void> {
  await Promise.all(Object.entries(providers).filter(([, provider]) => readsUsage(provider.tool)).map(([key, provider]) => readUsage(owner, key, provider, read)));
}

/** Every Claude Code and Codex provider with its kept reading, as the Usage panel takes them. */
export function keptEntries(owner: object, providers: Record<string, Provider>): { key: string; provider: Provider; usage?: ToolUsage }[] {
  return Object.entries(providers).filter(([, provider]) => readsUsage(provider.tool)).map(([key, provider]) => ({ key, provider, usage: keptUsage(owner, key) }));
}
