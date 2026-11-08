// The rules about providers, all pure: which fields a tool has, the name
// rule, which models a provider runs, which providers a picker offers, which
// provider a step runs on, what uses one, and which folders it owns.

import { describe, expect, test } from "bun:test";
import {
  providerChoices,
  providerFields,
  providerFolders,
  providerLoginCommand,
  providerLoginEnv,
  providerNameError,
  providerUses,
  resolveStepProvider,
  runsModel,
  sharesSessions,
  type Provider,
} from "../../../src/queue/providers/index.ts";
import type { Job, QueueDefaults } from "../../../src/queue/queue.ts";
import { resolveProvider } from "../../../src/render/pages/specs-list/model-resolve.ts";

const PROVIDERS: Record<string, Provider> = {
  Claude: { name: "Claude", tool: "claude" },
  "Claude-Capra": { name: "Claude-Capra", tool: "claude", configDir: "~/.claude-capra" },
  Codex: { name: "Codex", tool: "codex" },
  "Codex-a": { name: "Codex-a", tool: "codex", codexHome: "~/.codex-shared", shadowHome: "~/.codex-a" },
  "Codex-b": { name: "Codex-b", tool: "codex", codexHome: "~/.codex-shared", shadowHome: "~/.codex-b" },
  "Codex-own": { name: "Codex-own", tool: "codex", codexHome: "~/.codex-own" },
  OpenCode: { name: "OpenCode", tool: "opencode" },
};

const defaults = (over: Partial<QueueDefaults> = {}): QueueDefaults => ({
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "Opus", implement: "gpt-6" },
  modelChoices: { Opus: {}, "gpt-6": { tool: "codex" }, script: { tool: "fake-claude" } },
  providers: PROVIDERS,
  provider: { implement: "Codex" },
  ...over,
});

const job = (over: Record<string, unknown> = {}): Job =>
  ({ id: "j", project: "aide", specFolder: "703-x", steps: ["implement"], state: "queued", model: {}, ...over }) as unknown as Job;

describe("the fields a tool has", () => {
  test("Claude Code has a config folder, Codex a home and a shadow home, OpenCode none (AC-1)", () => {
    expect(providerFields("claude")).toEqual(["configDir"]);
    expect(providerFields("codex")).toEqual(["codexHome", "shadowHome"]);
    expect(providerFields("opencode")).toEqual([]);
  });
});

describe("the name rule", () => {
  test("64 letters, digits, dots, underscores and hyphens pass, and no name is reserved (AC-5)", () => {
    expect(providerNameError("a1._-".repeat(12) + "abcd")).toBeNull();
    expect(providerNameError("Default")).toBeNull();
  });
});

describe("which models a provider runs", () => {
  test("a Claude Code provider runs claude and fake-claude choices, the others only their own tool", () => {
    const claude = PROVIDERS.Claude!;
    expect(runsModel(claude, {})).toBe(true);
    expect(runsModel(claude, { tool: "fake-claude" })).toBe(true);
    expect(runsModel(claude, { tool: "codex" })).toBe(false);
    expect(runsModel(PROVIDERS.Codex!, { tool: "codex" })).toBe(true);
    expect(runsModel(PROVIDERS.Codex!, {})).toBe(false);
    expect(runsModel(PROVIDERS.OpenCode!, { tool: "opencode" })).toBe(true);
  });
});

describe("which providers a picker offers", () => {
  test("every provider that runs at least one model choice, in config order (AC-9)", () => {
    const keys = providerChoices(PROVIDERS, defaults().modelChoices).map((c) => c.key);
    expect(keys).toEqual(["Claude", "Claude-Capra", "Codex", "Codex-a", "Codex-b", "Codex-own"]);
  });

  test("a Codex provider is left out when no Codex model is listed (AC-9)", () => {
    const keys = providerChoices(PROVIDERS, { Opus: {} }).map((c) => c.key);
    expect(keys).toEqual(["Claude", "Claude-Capra"]);
  });
});

describe("which provider a step runs on", () => {
  test("the job's own pick wins, then the phase default, then the first provider that runs the model", () => {
    const d = defaults();
    expect(resolveStepProvider(job({ provider: { implement: "Claude-Capra" } }), "implement", d)).toBe("Claude-Capra");
    expect(resolveStepProvider(job(), "implement", d)).toBe("Codex");
    expect(resolveStepProvider(job({ model: { analyze: "Opus" } }), "analyze", d)).toBe("Claude");
  });

  test("a phase default that does not run the step's model gives way to the first provider that does", () => {
    const d = defaults({ provider: { analyze: "Codex" } });
    expect(resolveStepProvider(job({ model: { analyze: "Opus" } }), "analyze", d)).toBe("Claude");
  });

  test("a `default` entry is never read: a step with no phase entry takes the first provider that runs its model (AC-24)", () => {
    const d = defaults({ provider: { analyze: "Codex", default: "Claude-Capra" } as QueueDefaults["provider"] });
    expect(resolveStepProvider(job({ model: { create: "Opus" } }), "create", d)).toBe("Claude");
  });

  test("the runner and the Models per phase row pick the same provider for each phase, a `default` entry ignored (AC-24)", () => {
    const d = defaults({ provider: { analyze: "Claude-Capra", default: "Claude-Capra" } as QueueDefaults["provider"] });
    const modelChoices = Object.entries(d.modelChoices ?? {}).map(([name, c]) => ({ name, tool: c.tool ?? "claude" }));
    const providerChoices = Object.entries(PROVIDERS).map(([key, p]) => ({ key, name: p.name, tool: p.tool }));
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const model = (d.model[step] ?? d.model.default) as string;
      const row = resolveProvider({ modelChoices, providerChoices, defaultProviders: d.provider } as never, step, model, []);
      expect(row?.key).toBe(resolveStepProvider(job(), step, d));
    }
  });

  test("a stand-in model runs under a Claude Code provider", () => {
    const d = defaults({ model: { default: "script" }, provider: {} });
    expect(resolveStepProvider(job(), "analyze", d)).toBe("Claude");
  });

  test("a store with no provider at all answers none", () => {
    expect(resolveStepProvider(job(), "analyze", defaults({ providers: undefined, provider: undefined }))).toBeUndefined();
  });
});

describe("what uses a provider", () => {
  const schedules = { aide: [{ name: "nightly", provider: "Claude-Capra" }, { name: "weekly" }] };

  test("a phase default, a schedule entry and a queued job are all named (AC-6)", () => {
    const d = defaults({ provider: { implement: "Claude-Capra" } });
    const jobs = [job({ id: "q", state: "queued", steps: ["analyze"], provider: { analyze: "Claude-Capra" } })];
    const uses = providerUses("Claude-Capra", d, schedules, jobs);
    expect(uses).toHaveLength(3);
    expect(uses.join(" | ")).toContain("Implement default");
    expect(uses.join(" | ")).toContain("schedule nightly in aide");
    expect(uses.join(" | ")).toContain("aide/703-x");
  });

  test("a job stopped waiting for a usage-limit reset counts; a finished one does not (AC-6)", () => {
    const waiting = job({ state: "stopped", stopReason: "provider-limit", usageLimitWait: { until: "x", resetKnown: true }, provider: { implement: "Codex" } });
    const done = job({ state: "done", provider: { implement: "Codex" } });
    const stoppedForGood = job({ state: "stopped", stopReason: "cap", provider: { implement: "Codex" } });
    const d = defaults({ provider: {} });
    expect(providerUses("Codex", d, {}, [waiting])).toHaveLength(1);
    expect(providerUses("Codex", d, {}, [done, stoppedForGood])).toEqual([]);
  });
});

describe("whether two providers share sessions", () => {
  test("one provider shares with itself; two Codex providers share on one CODEX_HOME (AC-16)", () => {
    expect(sharesSessions("Claude", "Claude", PROVIDERS)).toBe(true);
    expect(sharesSessions("Codex-a", "Codex-b", PROVIDERS)).toBe(true);
    expect(sharesSessions("Codex-a", "Codex-own", PROVIDERS)).toBe(false);
    expect(sharesSessions("Claude", "Claude-Capra", PROVIDERS)).toBe(false);
    expect(sharesSessions("Claude", "Codex", PROVIDERS)).toBe(false);
  });

  test("a provider no longer configured shares with nothing (AC-16)", () => {
    expect(sharesSessions("Gone", "Codex", PROVIDERS)).toBe(false);
    expect(sharesSessions(undefined, "Codex", PROVIDERS)).toBe(false);
  });
});

describe("the folders a provider owns", () => {
  test("every Claude config folder and every Codex home and shadow home, expanded, the normal ones left out (AC-17)", () => {
    const folders = providerFolders(PROVIDERS, "/home/r");
    expect(folders.claude).toEqual(["/home/r/.claude-capra"]);
    expect(folders.codex).toEqual(["/home/r/.codex-shared", "/home/r/.codex-a", "/home/r/.codex-b", "/home/r/.codex-own"]);
  });
});

describe("no `default` use", () => {
  test("a stored `default` entry is no use of a provider (AC-24)", () => {
    const d = { provider: { default: "Claude" } } as Pick<QueueDefaults, "provider">;
    expect(providerUses("Claude", d, {}, [])).toEqual([]);
  });
});

describe("what a provider's login commands run with", () => {
  test("a Claude provider with a folder gets CLAUDE_CONFIG_DIR, expanded; a Codex one the shadow home, else its home (AC-5)", () => {
    expect(providerLoginEnv(PROVIDERS["Claude-Capra"]!, "/home/r")).toEqual({ CLAUDE_CONFIG_DIR: "/home/r/.claude-capra" });
    expect(providerLoginEnv(PROVIDERS["Codex-a"]!, "/home/r")).toEqual({ CODEX_HOME: "/home/r/.codex-a" });
    expect(providerLoginEnv(PROVIDERS["Codex-own"]!, "/home/r")).toEqual({ CODEX_HOME: "/home/r/.codex-own" });
    expect(providerLoginEnv({ name: "Codex-away", tool: "codex", codexHome: "/srv/codex" }, "/home/r")).toEqual({ CODEX_HOME: "/srv/codex" });
  });

  test("a provider on its tool's own folder, and an OpenCode one, set no variable (AC-5)", () => {
    expect(providerLoginEnv(PROVIDERS.Claude!, "/home/r")).toEqual({});
    expect(providerLoginEnv(PROVIDERS.Codex!, "/home/r")).toEqual({});
    expect(providerLoginEnv(PROVIDERS.OpenCode!, "/home/r")).toEqual({});
  });
});

describe("the command that logs a provider in", () => {
  test("it carries the folder as written, the shadow home first (AC-4)", () => {
    expect(providerLoginCommand(PROVIDERS["Claude-Capra"]!)).toBe("CLAUDE_CONFIG_DIR=~/.claude-capra claude auth login");
    expect(providerLoginCommand({ name: "Codex-p", tool: "codex", codexHome: "~/.codex", shadowHome: "~/.codex-p" })).toBe(
      "CODEX_HOME=~/.codex-p codex login",
    );
    expect(providerLoginCommand(PROVIDERS["Codex-own"]!)).toBe("CODEX_HOME=~/.codex-own codex login");
  });

  test("a folder with a space or a quote is quoted so the shell reads it as one word (AC-4)", () => {
    expect(providerLoginCommand({ name: "A", tool: "claude", configDir: "/srv/AI accounts/claude" })).toBe(
      "CLAUDE_CONFIG_DIR='/srv/AI accounts/claude' claude auth login",
    );
    expect(providerLoginCommand({ name: "B", tool: "codex", codexHome: "~/my codex" })).toBe("CODEX_HOME=~/'my codex' codex login");
    expect(providerLoginCommand({ name: "C", tool: "claude", configDir: "/srv/it's" })).toBe(
      "CLAUDE_CONFIG_DIR='/srv/it'\\''s' claude auth login",
    );
  });

  test("a provider on its tool's own folder logs in with the plain command (AC-4)", () => {
    expect(providerLoginCommand(PROVIDERS.Claude!)).toBe("claude auth login");
    expect(providerLoginCommand(PROVIDERS.Codex!)).toBe("codex login");
    expect(providerLoginCommand(PROVIDERS.OpenCode!)).toBe("opencode auth login");
  });
});
