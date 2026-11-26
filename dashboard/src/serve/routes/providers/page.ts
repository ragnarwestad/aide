// What the Providers tab shows of the chosen provider. The Settings route
// (`providerDetailFor`) reads the open tab's models or installation before
// the page answers, and shows the usage the server keeps.

import type { Language } from "../../../i18n";
import type { Provider } from "../../../queue/providers/index.ts";
import { readProviderUsage } from "../../providers/status.ts";
import { readInstallationTab, readModelsTab } from "./readings.ts";
import { keptUsage, readsUsage } from "../../providers/usage-kept.ts";
import { providerTab, type ProviderDetailOptions } from "../../../render/pages/settings-page/provider-detail.ts";
import type { ProviderStatus } from "../../../render";
import type { RoutesContext } from "../";

/** What the Providers tab shows of the chosen provider: its status as the
 *  tab read it, and what the open tab shows: the usage the server keeps, or
 *  the models or the installation, read now. A tool the server reads no
 *  usage for answers its own reading, which runs nothing. */
export async function providerDetailFor(
  ctx: RoutesContext,
  key: string,
  provider: Provider,
  status: ProviderStatus | undefined,
  aiTab: string | undefined,
  lang: Language,
): Promise<ProviderDetailOptions> {
  const base = { key, provider, status, aiTab };
  switch (providerTab(aiTab)) {
    case "usage":
      return {
        ...base,
        usage: readsUsage(provider.tool) ? keptUsage(ctx.opts, key) : await (ctx.opts.usageProbe ?? readProviderUsage)(key, provider),
      };
    case "models":
      return { ...base, reading: await readModelsTab(ctx, key, provider, lang) };
    case "installation":
      return { ...base, reading: await readInstallationTab(ctx, provider, lang) };
    case "config":
      return base;
  }
}
