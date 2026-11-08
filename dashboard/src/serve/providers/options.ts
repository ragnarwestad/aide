// The providers a page's AI choice lists, in the shape every picker takes.

import { providerChoices } from "../../queue/providers/index.ts";
import type { QueueStore } from "../../queue/queue.ts";
import type { ProviderOption } from "../../render/pages/specs-list/model-resolve.ts";

/** The providers that run at least one model choice, in config order, with
 *  the configured provider per step. */
export function providerPickerOptions(queue: Pick<QueueStore, "defaults">): {
  providerChoices: ProviderOption[];
  defaultProviders: Record<string, string> | undefined;
} {
  const { providers, modelChoices, provider } = queue.defaults;
  return {
    providerChoices: providerChoices(providers, modelChoices).map(({ key, provider: p }) => ({
      key, name: p.name, tool: p.tool, ...(p.enabled === false ? { off: true } : {}),
    })),
    defaultProviders: provider,
  };
}
