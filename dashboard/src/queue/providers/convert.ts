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

/** One conversion: the keys taken so far, and the providers made for the
 *  tools, the accounts and the jobs' own accounts. */
class ProviderConversion {
  private readonly taken = new Set<string>();
  // Accounts claim their names first, so one named like a tool keeps it.
  private readonly accounts: { key: string; name: string; dir: string; provider: Provider }[] = [];
  private readonly toolKey = {} as Record<ProviderTool, string>;
  readonly providers: Record<string, Provider> = {};
  // A provider of a job's own: one for an account no longer configured that
  // a job will still run on, shared by every job with the same name and folder.
  private readonly own = new Map<string, string>();

  constructor(private readonly input: ConversionInput) {
    for (const [name, account] of Object.entries(input.claudeAccounts ?? {})) {
      const key = this.free(name);
      this.accounts.push({
        key, name, dir: expandDir(account.configDir, input.home),
        provider: { name: key, tool: "claude", configDir: account.configDir },
      });
    }
    for (const tool of PROVIDER_TOOLS) {
      this.toolKey[tool] = this.free(SHORT_TOOL_NAMES[tool]);
      this.providers[this.toolKey[tool]] = { name: this.toolKey[tool], tool };
    }
    for (const a of this.accounts) this.providers[a.key] = a.provider;
  }

  private free(base: string): string {
    let key = base;
    for (let n = 2; this.taken.has(key.toLowerCase()); n++) key = `${base}-${n}`;
    this.taken.add(key.toLowerCase());
    return key;
  }

  private toolOfModel(model: string | undefined): ProviderTool {
    const { defaults } = this.input;
    const listed = model ? listedModelName(Object.keys(defaults.modelChoices ?? {}), model) : undefined;
    const tool = listed && "name" in listed ? defaults.modelChoices?.[listed.name]?.tool : undefined;
    return (RUNNABLE_TOOLS as readonly unknown[]).includes(tool) ? providerFamily(tool!) : "claude";
  }

  /** The phase defaults' provider, per step. */
  stepProviders(): Record<string, string> {
    const provider: Record<string, string> = {};
    for (const [step, model] of Object.entries(this.input.defaults.model ?? {})) {
      if (step !== "default") provider[step] = this.toolKey[this.toolOfModel(model)];
    }
    return provider;
  }

  schedules(): Record<string, ScheduleEntry[]> {
    const schedules: Record<string, ScheduleEntry[]> = {};
    for (const [project, entries] of Object.entries(this.input.schedules)) {
      schedules[project] = entries.map((e) =>
        e.model && !e.provider ? { ...e, provider: this.toolKey[this.toolOfModel(e.model)] } : { ...e },
      );
    }
    return schedules;
  }

  private keyForAccount(name: string, dir: string, make: boolean): string | undefined {
    const configured = this.accounts.find((a) => a.dir === dir);
    if (configured) return configured.key;
    if (!make) return undefined;
    const id = `${name}\n${dir}`;
    if (!this.own.has(id)) {
      const key = this.free(name);
      this.own.set(id, key);
      this.providers[key] = { name: key, tool: "claude", configDir: dir };
    }
    return this.own.get(id);
  }

  private keyForAccountName(name: string): string | undefined {
    return this.accounts.find((a) => a.name === name)?.key ?? [...this.own].find(([id]) => id.startsWith(`${name}\n`))?.[1];
  }

  job(stored: Job): Job {
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
      const tool = this.toolOfModel(resolveStepModel(job, step, this.input.defaults.model ?? {}));
      const onAccount = tool === "claude" && account ? this.keyForAccount(account.name, account.dir, willRun(job)) : undefined;
      stepProvider[step] = onAccount ?? this.toolKey[tool];
    }
    return { ...job, provider: stepProvider, results: job.results.map((r) => this.resultWithProvider(r)) };
  }

  // Run after the jobs, so a provider made for a job's own account is known.
  private resultWithProvider(r: StepResult): StepResult {
    const { claudeAccount: accountName, ...result } = r as StepResult & { claudeAccount?: string };
    if (result.provider || result.tool === "none") return result;
    const tool: ProviderTool = providerFamily(result.tool ?? "claude");
    if (tool === "claude" && accountName) {
      const key = this.keyForAccountName(accountName);
      return { ...result, provider: { key: key ?? accountName, name: key ? this.providers[key]!.name : accountName } };
    }
    return { ...result, provider: { key: this.toolKey[tool], name: this.providers[this.toolKey[tool]]!.name } };
  }
}

export function convertToProviders(input: ConversionInput): Conversion {
  const conversion = new ProviderConversion(input);
  const provider = conversion.stepProviders();
  const schedules = conversion.schedules();
  const jobs = input.jobs.map((stored) => conversion.job(stored));
  return { providers: conversion.providers, provider, schedules, jobs };
}
