// A provider's subscription usage, kept for a short while once read. Reading
// it runs the tool (`claude -p /usage` takes seconds), so the Providers tab
// never waits for it: the tab shows a reading kept from the last two
// minutes, and otherwise asks for one after it has drawn. A reading is kept
// per server and per provider as it stood, so an edited provider is read
// again.

import type { Provider } from "../../queue/providers/index.ts";
import type { ToolUsage } from "../../render";

export const USAGE_KEPT_MS = 2 * 60_000;

type Read = (key: string, provider: Provider) => Promise<ToolUsage>;
interface Kept { usage: ToolUsage; at: number }

const kept = new WeakMap<object, Map<string, Kept>>();
const keyOf = (key: string, provider: Provider): string => `${key}\n${JSON.stringify(provider)}`;
const store = (owner: object): Map<string, Kept> => {
  let map = kept.get(owner);
  if (!map) kept.set(owner, (map = new Map()));
  return map;
};

/** The reading kept for this provider as it stands now, if it is less than
 *  two minutes old. */
export function keptUsage(owner: object, key: string, provider: Provider, now = Date.now()): ToolUsage | undefined {
  const hit = store(owner).get(keyOf(key, provider));
  return hit && now - hit.at < USAGE_KEPT_MS ? hit.usage : undefined;
}

/** Reads the usage now and keeps the answer. */
export async function readUsage(owner: object, key: string, provider: Provider, read: Read, now = Date.now): Promise<ToolUsage> {
  const usage = await read(key, provider);
  store(owner).set(keyOf(key, provider), { usage, at: now() });
  return usage;
}
