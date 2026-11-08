// A provider is one named AI login: a tool (Claude Code, Codex or OpenCode)
// and the folders that tool keeps its login in. Every rule about providers
// lives here — the stored shape, the name rule, which models a provider
// runs, which providers a picker offers, which provider a step runs on, what
// uses one, which providers share sessions and which folders they own.
//
// A provider is stored under a KEY that never changes; a rename changes the
// `name` alone, so a stored job, schedule or phase default that names the
// key keeps meaning the same login.

import type { Job, ModelChoice, QueueDefaults } from "../types.ts";
import { NAME_RE } from "../parse-request.ts";
export { providerKeyFrom } from "./key.ts";
export { providerLoginCommand } from "./login-command.ts";
import { listedModelName, resolveStepModel } from "../model-name.ts";

import { PROVIDER_TOOLS, type ProviderTool } from "./tools.ts";
export { PROVIDER_TOOLS, type ProviderTool };

export interface Provider {
  /** What the board shows: free text, one line, at most 64 characters. */
  name: string;
  tool: ProviderTool;
  /** Stored only as `false`: a switched-off provider is offered by no picker
   *  and taken by no fallback, and a step that names it is held. */
  enabled?: false;
  /** The tool's program, when it is not the one found on PATH. */
  binary?: string;
  /** Claude Code: compact the conversation once it holds this many tokens
   *  (`--autocompact`). Absent means Claude Code's own setting. */
  autoCompact?: number;
  /** Claude Code: handed over as `CLAUDE_CONFIG_DIR`. Empty or absent means
   *  Claude Code's own folder, and nothing is set. */
  configDir?: string;
  /** Codex: `CODEX_HOME`. Empty or absent means Codex's own folder. */
  codexHome?: string;
  /** Codex: a folder of its own login that shares the rest of `codexHome`. */
  shadowHome?: string;
}

export type ProviderField = "configDir" | "codexHome" | "shadowHome";

/** The folder each tool's login lives in when none is written, as a person
 *  writes it. */
export const NORMAL_CLAUDE_DIR = "~/.claude";
export const NORMAL_CODEX_HOME = "~/.codex";

/** The fields a provider of this tool has, in the order a form asks for
 *  them. */
export function providerFields(tool: ProviderTool): ProviderField[] {
  if (tool === "claude") return ["configDir"];
  if (tool === "codex") return ["codexHome", "shadowHome"];
  return [];
}

export const asProviderTool = (value: unknown): ProviderTool | undefined =>
  (PROVIDER_TOOLS as readonly unknown[]).includes(value)
    ? (value as ProviderTool)
    : undefined;

/** The refusal for a name a provider cannot have, or null when it can: one
 *  line of up to 64 characters, not only spaces. */
export function providerNameError(name: string): string | null {
  if (!name.trim()) return "A provider needs a name";
  if (name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    return `${name.slice(0, 64)} is not a name a provider can have — use one line of up to 64 characters`;
  }
  return null;
}

/** The range `claude --autocompact` takes, in tokens. */
export const AUTO_COMPACT_MIN = 100_000;
export const AUTO_COMPACT_MAX = 1_000_000;

/** The refusal for an auto-compact threshold Claude Code does not take, or
 *  null when it does. */
export function autoCompactError(tokens: number): string | null {
  return Number.isInteger(tokens) &&
    tokens >= AUTO_COMPACT_MIN &&
    tokens <= AUTO_COMPACT_MAX
    ? null
    : `Auto-compact takes a whole number of tokens from ${AUTO_COMPACT_MIN} to ${AUTO_COMPACT_MAX} — ${tokens} was given`;
}

/** Whether the provider stored under `key` is switched off. A key that is
 *  not a provider is not switched off: the caller finds it gone. */
export const switchedOff = (
  key: string | undefined,
  providers: Record<string, Provider> | undefined,
): boolean => key !== undefined && providers?.[key]?.enabled === false;

/** `~/…` read against the home directory; any other path is kept. */
export function expandDir(dir: string, home: string): string {
  if (dir === "~") return home;
  return dir.startsWith("~/") ? `${home}/${dir.slice(2)}` : dir;
}

/** A provider runs the model choices of its own tool; Claude Code's also
 *  run the scripted stand-in, which is Claude Code's command line with the
 *  binary swapped. A choice with no tool is Claude Code's. */
export function runsModel(
  provider: Provider,
  choice: ModelChoice | undefined,
): boolean {
  const tool = choice?.tool ?? "claude";
  return provider.tool === "claude"
    ? tool === "claude" || tool === "fake-claude"
    : tool === provider.tool;
}

/** The providers a picker lists: those that run at least one model choice,
 *  in the order the config lists them. A switched-off one is listed too, so
 *  a choice already on it is shown as it is; the picker leaves it out
 *  otherwise (`offeredProviders`). */
export function providerChoices(
  providers: Record<string, Provider> | undefined,
  modelChoices: Record<string, ModelChoice> | undefined,
): { key: string; provider: Provider }[] {
  const choices = Object.values(modelChoices ?? {});
  return Object.entries(providers ?? {})
    .filter(([, provider]) => choices.some((c) => runsModel(provider, c)))
    .map(([key, provider]) => ({ key, provider }));
}

/** The key of the provider a step runs on: the job's own pick; else the
 *  phase default when it runs the step's model; else the first provider, in
 *  config order, that is switched on and does; else none — the tool's normal
 *  login, as before providers existed. A job's own pick and the phase default
 *  are returned even when switched off, and the job's pick even when removed
 *  since: the caller holds the step, or finds the provider gone. */
export function resolveStepProvider(
  job: Pick<Job, "model"> & {
    provider?: Record<string, string>;
    modelChoice?: string;
  },
  step: string,
  defaults: Pick<
    QueueDefaults,
    "model" | "modelChoices" | "providers" | "provider"
  >,
): string | undefined {
  const own = job.provider?.[step];
  if (own) return own;
  const providers = defaults.providers;
  if (!providers) return undefined;
  const model = resolveStepModel(job as Job, step, defaults.model);
  const listed =
    model && defaults.modelChoices
      ? listedModelName(Object.keys(defaults.modelChoices), model)
      : undefined;
  const choice =
    listed && "name" in listed
      ? defaults.modelChoices?.[listed.name]
      : undefined;
  const wanted = defaults.provider?.[step];
  if (wanted && providers[wanted] && runsModel(providers[wanted], choice))
    return wanted;
  return Object.entries(providers).find(
    ([, p]) => p.enabled !== false && runsModel(p, choice),
  )?.[0];
}

const capitalised = (step: string): string =>
  step.charAt(0).toUpperCase() + step.slice(1);

/** Whether a job will still run: queued, running, or stopped waiting for a
 *  usage-limit reset. */
export const willRun = (job: Job): boolean =>
  job.state === "queued" ||
  job.state === "running" ||
  (job.state === "stopped" && job.usageLimitWait !== undefined);

/** What uses the provider, one phrase each: the phase defaults that name it,
 *  the schedule entries that name it and the jobs that will still run on it.
 *  Empty when nothing does, which is when it may be removed. */
export function providerUses(
  key: string,
  defaults: Pick<QueueDefaults, "provider">,
  schedules: Record<string, { name: string; provider?: string }[]>,
  jobs: Job[],
): string[] {
  const uses: string[] = [];
  for (const [step, chosen] of Object.entries(defaults.provider ?? {})) {
    if (step !== "default" && chosen === key)
      uses.push(`the ${capitalised(step)} default`);
  }
  for (const [project, entries] of Object.entries(schedules)) {
    for (const entry of entries)
      if (entry.provider === key)
        uses.push(`the schedule ${entry.name} in ${project}`);
  }
  for (const job of jobs) {
    if (!willRun(job)) continue;
    const step = Object.entries(job.provider ?? {}).find(
      ([, chosen]) => chosen === key,
    )?.[0];
    if (step)
      uses.push(
        `the ${job.state === "stopped" ? "waiting" : job.state} ${capitalised(step)} of ${job.project}/${job.specFolder}`,
      );
  }
  return uses;
}

/** Whether a step on `a` can continue a session `b` started: the same
 *  provider, or two Codex providers with one `CODEX_HOME`, which a shadow
 *  home lets each have a login of its own beside. A provider no longer
 *  configured shares with nothing. */
export function sharesSessions(
  a: string | undefined,
  b: string | undefined,
  providers: Record<string, Provider> | undefined,
): boolean {
  const first = a ? providers?.[a] : undefined;
  const second = b ? providers?.[b] : undefined;
  if (!a || !b || !first || !second) return false;
  if (a === b) return true;
  return (
    first.tool === "codex" &&
    second.tool === "codex" &&
    (first.codexHome || NORMAL_CODEX_HOME) ===
      (second.codexHome || NORMAL_CODEX_HOME)
  );
}

/** Every provider's own folders, expanded, for the sandbox to protect: the
 *  Claude Code config folders and the Codex homes and shadow homes. The
 *  normal `~/.claude` and `~/.codex` are left out; the fixed lists cover
 *  them. */
export function providerFolders(
  providers: Record<string, Provider> | undefined,
  home: string,
): { claude: string[]; codex: string[] } {
  const claude: string[] = [];
  const codex: string[] = [];
  const add = (
    list: string[],
    dir: string | undefined,
    normal: string,
  ): void => {
    if (!dir) return;
    const expanded = expandDir(dir, home);
    if (expanded !== expandDir(normal, home) && !list.includes(expanded))
      list.push(expanded);
  };
  for (const provider of Object.values(providers ?? {})) {
    if (provider.tool === "claude")
      add(claude, provider.configDir, NORMAL_CLAUDE_DIR);
    if (provider.tool === "codex") {
      add(codex, provider.codexHome, NORMAL_CODEX_HOME);
      add(codex, provider.shadowHome, NORMAL_CODEX_HOME);
    }
  }
  return { claude, codex };
}

/** The environment a command for this provider runs with — a step's, and
 *  the board's own status reads: `CLAUDE_CONFIG_DIR` for a Claude Code
 *  provider with a config folder, `CODEX_HOME` for a Codex one (its shadow
 *  home when it has one, else its home), expanded against `home`. Nothing
 *  for a provider on its tool's own folder, and nothing for OpenCode. */
export function providerLoginEnv(
  provider: Provider,
  home: string,
): Record<string, string> {
  if (provider.tool === "claude" && provider.configDir)
    return { CLAUDE_CONFIG_DIR: expandDir(provider.configDir, home) };
  const folder = provider.shadowHome || provider.codexHome;
  if (provider.tool === "codex" && folder)
    return { CODEX_HOME: expandDir(folder, home) };
  return {};
}

/** One entry read off a file field by field: undefined when it is not a
 *  provider (a bad name, an unknown tool, a field of the wrong type). */
export function parseProvider(raw: unknown): Provider | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return undefined;
  const e = raw as Record<string, unknown>;
  const tool = asProviderTool(e.tool);
  if (!tool || typeof e.name !== "string" || providerNameError(e.name))
    return undefined;
  const out: Provider = { name: e.name, tool };
  if (e.enabled !== undefined && typeof e.enabled !== "boolean")
    return undefined;
  if (e.enabled === false) out.enabled = false;
  for (const field of [...providerFields(tool), "binary"] as const) {
    const value = e[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return undefined;
    if (value) out[field] = value;
  }
  if (tool === "claude" && e.autoCompact !== undefined) {
    if (typeof e.autoCompact !== "number" || autoCompactError(e.autoCompact))
      return undefined;
    out.autoCompact = e.autoCompact;
  }
  return out;
}

/** The `providers` table read off a file: keys and entries that are not
 *  valid, and a name another entry already has in any case, are dropped.
 *  Undefined when none is left. */
export function parseProviders(
  raw: unknown,
): Record<string, Provider> | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return undefined;
  const out: Record<string, Provider> = {};
  const names = new Set<string>();
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const provider = NAME_RE.test(key) ? parseProvider(entry) : undefined;
    if (!provider || names.has(provider.name.toLowerCase())) continue;
    names.add(provider.name.toLowerCase());
    out[key] = provider;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
