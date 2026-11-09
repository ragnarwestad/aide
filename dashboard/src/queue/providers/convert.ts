// The one-time conversion from tools and Claude accounts to providers: a
// pure function from what is stored to what replaces it. Every phase
// default, schedule entry, job and result that named a tool or an account
// names the provider that is the same login instead.

import { listedModelName, resolveStepModel } from "../model-name.ts";
import type { ScheduleEntry } from "../schedule.ts";
import type { Job, QueueDefaults, StepResult } from "../types.ts";
import { expandDir, PROVIDER_TOOLS, willRun, type Provider, type ProviderTool } from "./index.ts";
import { RUNNABLE_TOOLS, SHORT_TOOL_NAMES, providerFamily } from "./tools.ts";

export interface ConversionInput {
  defaults: Pick<QueueDefaults, "model" | "modelChoices">;
  /** The Claude accounts the config held before providers: name and folder. */
  claudeAccounts?: Record<string, { configDir: string }>;
  jobs: readonly Job[];
  schedules: Record<string, readonly ScheduleEntry[]>;
  home: string;
}

export interface Conversion {
  providers: Record<string, Provider>;
  /** The phase defaults' provider, per step. */
  provider: Record<string, string>;
  schedules: Record<string, ScheduleEntry[]>;
  jobs: Job[];
}

export function convertToProviders(input: ConversionInput): Conversion {
  const { defaults, home } = input;
  const taken = new Set<string>();
  const free = (base: string): string => {
    let key = base;
    for (let n = 2; taken.has(key.toLowerCase()); n++) key = `${base}-${n}`;
    taken.add(key.toLowerCase());
    return key;
  };

  // Accounts claim their names first, so one named like a tool keeps it.
  const accounts: { key: string; name: string; dir: string; provider: Provider }[] = [];
  for (const [name, account] of Object.entries(input.claudeAccounts ?? {})) {
    const key = free(name);
    accounts.push({
      key, name, dir: expandDir(account.configDir, home),
      provider: { name: key, tool: "claude", configDir: account.configDir },
    });
  }
  const toolKey = {} as Record<ProviderTool, string>;
  const providers: Record<string, Provider> = {};
  for (const tool of PROVIDER_TOOLS) {
    toolKey[tool] = free(SHORT_TOOL_NAMES[tool]);
    providers[toolKey[tool]] = { name: toolKey[tool], tool };
  }
  for (const a of accounts) providers[a.key] = a.provider;

  const toolOfModel = (model: string | undefined): ProviderTool => {
    const listed = model ? listedModelName(Object.keys(defaults.modelChoices ?? {}), model) : undefined;
    const tool = listed && "name" in listed ? defaults.modelChoices?.[listed.name]?.tool : undefined;
    return (RUNNABLE_TOOLS as readonly unknown[]).includes(tool) ? providerFamily(tool!) : "claude";
  };

  const provider: Record<string, string> = {};
  for (const [step, model] of Object.entries(defaults.model ?? {})) {
    if (step !== "default") provider[step] = toolKey[toolOfModel(model)];
  }

  const schedules: Record<string, ScheduleEntry[]> = {};
  for (const [project, entries] of Object.entries(input.schedules)) {
    schedules[project] = entries.map((e) =>
      e.model && !e.provider ? { ...e, provider: toolKey[toolOfModel(e.model)] } : { ...e },
    );
  }

  // A provider of a job's own: one for an account no longer configured that
  // a job will still run on, shared by every job with the same name and folder.
  const own = new Map<string, string>();
  const keyForAccount = (name: string, dir: string, make: boolean): string | undefined => {
    const configured = accounts.find((a) => a.dir === dir);
    if (configured) return configured.key;
    if (!make) return undefined;
    const id = `${name}\n${dir}`;
    if (!own.has(id)) {
      const key = free(name);
      own.set(id, key);
      providers[key] = { name: key, tool: "claude", configDir: dir };
    }
    return own.get(id);
  };
  const keyForAccountName = (name: string): string | undefined =>
    accounts.find((a) => a.name === name)?.key ?? [...own].find(([id]) => id.startsWith(`${name}\n`))?.[1];

  const jobs = input.jobs.map((stored): Job => {
    // The fields providers replace, read off the stored job as unknown.
    const {
      claudeAccount: rawAccount, usageLimitLeft: _left, usageLimitLeftBefore: _before, ...job
    } = stored as Job & { claudeAccount?: { name?: unknown; configDir?: unknown }; usageLimitLeft?: unknown; usageLimitLeftBefore?: unknown };
    const account =
      rawAccount && typeof rawAccount.name === "string" && typeof rawAccount.configDir === "string"
        ? { name: rawAccount.name, dir: rawAccount.configDir }
        : undefined;
    const stepProvider: Record<string, string> = { ...job.provider };
    for (const step of job.steps) {
      if (stepProvider[step]) continue;
      const tool = toolOfModel(resolveStepModel(job, step, defaults.model ?? {}));
      const onAccount = tool === "claude" && account ? keyForAccount(account.name, account.dir, willRun(job)) : undefined;
      stepProvider[step] = onAccount ?? toolKey[tool];
    }
    return { ...job, provider: stepProvider, results: job.results.map((r) => resultWithProvider(r)) };
  });

  // Run after the jobs, so a provider made for a job's own account is known.
  function resultWithProvider(r: StepResult): StepResult {
    const { claudeAccount: accountName, ...result } = r as StepResult & { claudeAccount?: string };
    if (result.provider || result.tool === "none") return result;
    const tool: ProviderTool = providerFamily(result.tool ?? "claude");
    if (tool === "claude" && accountName) {
      const key = keyForAccountName(accountName);
      return { ...result, provider: { key: key ?? accountName, name: key ? providers[key]!.name : accountName } };
    }
    return { ...result, provider: { key: toolKey[tool], name: providers[toolKey[tool]]!.name } };
  }

  return { providers, provider, schedules, jobs };
}
