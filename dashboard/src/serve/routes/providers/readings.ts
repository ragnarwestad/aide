// What a provider's Models and Installation tabs are drawn with: each
// asks its tool when the tab is opened, records the answer
// where the pickers, Add, the header notices and the re-check before a
// job read it, and answers with the tab's HTML.

import { homedir } from "node:os";
import { dirname } from "node:path";
import {
  installationBlock,
  modelsBlock,
  stamp,
  TOOL_TAB_LABELS,
  type ToolCheck,
  type ToolModels,
} from "../../../render";
import type { Language } from "../../../i18n";
import {
  providerLoginEnv,
  type Provider,
} from "../../../queue/providers/index.ts";
import { modelChoiceOptions } from "../../serve-helpers";
import { checkTool, recordCheck } from "../../tool-check.ts";
import { readModels, recordModels } from "../../tool-models";
import { recordClaudeVersions } from "../settings-models.ts";
import type { RoutesContext } from "../";

const failed = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** The models the provider's tool offers, read with the provider's own
 *  folders and set against the board's choices. A read that throws is
 *  stored and drawn as one that failed. */
export async function readModelsTab(
  ctx: RoutesContext,
  provider: Provider,
  lang: Language,
): Promise<string> {
  const tool = provider.tool;
  const env = providerLoginEnv(provider, homedir());
  // Every model value of this tool's choices, its key where it names none:
  // what the models read are set against.
  const configured = Object.entries(ctx.queue.defaults.modelChoices ?? {})
    .filter(([, choice]) => (choice.tool ?? "claude") === tool)
    .map(([name, choice]) => choice.model ?? name);
  const probe = ctx.opts.toolProbe;
  let read: ToolModels;
  try {
    read = await (probe
      ? probe.models(tool, { configured, env })
      : readModels(tool, { configured, env }));
  } catch (err) {
    read = {
      tool,
      at: new Date().toISOString(),
      offered: [],
      error: failed(err),
    };
  }
  read = { ...read, provider: provider.name };
  recordModels(read);
  recordClaudeVersions(ctx.queue, read, ctx.opts.modelIdsPath);
  return modelsBlock(
    tool,
    {
      reading: read,
      choices: ctx.queue.defaults.modelChoices,
      options: modelChoiceOptions(ctx.queue),
    },
    stamp(read.at),
    lang,
    TOOL_TAB_LABELS[tool],
  );
}

/** Whether the provider's tool is installed and usable on this host. A
 *  check that throws is stored and drawn as one that could not run. */
export async function readInstallationTab(
  ctx: RoutesContext,
  provider: Provider,
  lang: Language,
): Promise<string> {
  const tool = provider.tool;
  const probe = ctx.opts.toolProbe;
  let check: ToolCheck;
  try {
    check = await (probe
      ? probe.check(tool)
      : checkTool(tool, {
          providers: () => ctx.queue.defaults.providers,
          scriptDir: ctx.opts.queueRunnerBin
            ? dirname(ctx.opts.queueRunnerBin)
            : undefined,
        }));
  } catch (err) {
    check = {
      tool,
      at: new Date().toISOString(),
      found: false,
      extra: [],
      error: `The check could not be run: ${failed(err)}`,
    };
  }
  recordCheck(check);
  return installationBlock(check, lang);
}
