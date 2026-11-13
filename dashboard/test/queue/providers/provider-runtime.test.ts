// A provider's on/off switch, its binary path and Claude Code's auto-compact
// threshold: what is stored, what is refused, and what a switched-off
// provider is no longer used for.

import { describe, expect, test } from "bun:test";
import {
  AUTO_COMPACT_MAX,
  AUTO_COMPACT_MIN,
  autoCompactError,
  parseProvider,
  parseProviders,
  providerLoginCommand,
  providerChoices,
  providerKeyFrom,
  providerNameError,
  resolveStepProvider,
  switchedOff,
  type Provider,
} from "../../../src/queue/providers/index.ts";
import type { Job, QueueDefaults } from "../../../src/queue/queue.ts";
import { offeredProviders, resolveProvider } from "../../../src/render/pages/specs-list/model-resolve.ts";
import { providerPickerOptions } from "../../../src/serve/providers/options.ts";

const PROVIDERS: Record<string, Provider> = {
  claude: { name: "Claude", tool: "claude", enabled: false },
  "claude-capra": { name: "Claude Capra", tool: "claude", configDir: "~/.claude-capra" },
  codex: { name: "Codex", tool: "codex" },
};

const defaults = (over: Partial<QueueDefaults> = {}): QueueDefaults => ({
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "Opus" },
  modelChoices: { Opus: {}, "gpt-6": { tool: "codex" } },
  providers: PROVIDERS,
  provider: {},
  ...over,
});

const job = (over: Record<string, unknown> = {}): Job =>
  ({ id: "j", project: "aide", specFolder: "703-x", steps: ["analyze"], state: "queued", model: {}, ...over }) as unknown as Job;

describe("a switched-off provider", () => {
  test("is still listed for the pickers, marked off, so a choice already on it is shown", () => {
    expect(providerChoices(PROVIDERS, defaults().modelChoices).map((c) => c.key)).toEqual(["claude", "claude-capra", "codex"]);
    expect(providerPickerOptions({ defaults: defaults() }).providerChoices[0]).toMatchObject({ key: "claude", off: true });
  });

  test("is passed over when a step falls back to the first provider that runs its model", () => {
    expect(resolveStepProvider(job(), "analyze", defaults())).toBe("claude-capra");
  });

  test("named by the job or the phase default, is still the step's provider, so the step is held there", () => {
    expect(resolveStepProvider(job({ provider: { analyze: "claude" } }), "analyze", defaults())).toBe("claude");
    expect(resolveStepProvider(job(), "analyze", defaults({ provider: { analyze: "claude" } }))).toBe("claude");
    expect(switchedOff("claude", PROVIDERS)).toBe(true);
    expect(switchedOff("claude-capra", PROVIDERS)).toBe(false);
    expect(switchedOff("gone", PROVIDERS)).toBe(false);
  });

  test("is stored as enabled: false; a provider that is on stores nothing", () => {
    expect(parseProvider({ name: "Claude", tool: "claude", enabled: false })).toEqual({ name: "Claude", tool: "claude", enabled: false });
    expect(parseProvider({ name: "Claude", tool: "claude", enabled: true })).toEqual({ name: "Claude", tool: "claude" });
    expect(parseProvider({ name: "Claude", tool: "claude", enabled: "no" })).toBeUndefined();
  });
});

describe("the board's pages and the runner", () => {
  test("pick the same provider for every phase when one is switched off, a default on it included", () => {
    const d = defaults({ provider: { analyze: "claude" } });
    const options = { ...providerPickerOptions({ defaults: d }), modelChoices: [{ name: "Opus", tool: "claude" as const }] };
    for (const step of ["create", "analyze"]) {
      expect(resolveProvider(options as never, step, "Opus", [])?.key).toBe(resolveStepProvider(job(), step, d));
    }
  });

  test("a picker lists a switched-off provider only where it is the one chosen", () => {
    const { providerChoices: all } = providerPickerOptions({ defaults: defaults() });
    expect(offeredProviders(all).map((p) => p.key)).toEqual(["claude-capra", "codex"]);
    expect(offeredProviders(all, "claude").map((p) => p.key)).toEqual(["claude", "claude-capra", "codex"]);
  });
});

describe("a binary path", () => {
  test("is kept for every tool", () => {
    for (const tool of ["claude", "codex", "opencode"]) {
      expect(parseProvider({ name: "P", tool, binary: "/opt/bin/x" })?.binary).toBe("/opt/bin/x");
    }
  });

  test("is the program the login command runs, quoted where a shell needs it", () => {
    expect(providerLoginCommand({ tool: "claude", binary: "/opt/bin/claude-next", configDir: "~/.claude-2" })).toBe(
      "CLAUDE_CONFIG_DIR=~/.claude-2 /opt/bin/claude-next auth login",
    );
    expect(providerLoginCommand({ tool: "codex", binary: "~/my tools/codex" })).toBe("~/'my tools/codex' login");
    expect(providerLoginCommand({ tool: "opencode", binary: "/opt/oc" })).toBe("/opt/oc auth login");
  });

  test("an empty one is no binary path, and one of the wrong type is no provider", () => {
    expect(parseProvider({ name: "P", tool: "claude", binary: "" })).toEqual({ name: "P", tool: "claude" });
    expect(parseProvider({ name: "P", tool: "claude", binary: 7 })).toBeUndefined();
  });
});

describe("auto-compact", () => {
  test("a Claude Code provider keeps a whole number of tokens from 100k to 1M", () => {
    expect(parseProvider({ name: "P", tool: "claude", autoCompact: 200000 })?.autoCompact).toBe(200000);
    expect(autoCompactError(AUTO_COMPACT_MIN)).toBeNull();
    expect(autoCompactError(AUTO_COMPACT_MAX)).toBeNull();
  });

  test("outside the range, or not a whole number, it is refused, and the refusal names the range", () => {
    for (const bad of [AUTO_COMPACT_MIN - 1, AUTO_COMPACT_MAX + 1, 150000.5]) {
      expect(autoCompactError(bad)).toContain("100000");
      expect(parseProvider({ name: "P", tool: "claude", autoCompact: bad })).toBeUndefined();
    }
  });

  test("a Codex or OpenCode provider has none", () => {
    expect(parseProvider({ name: "P", tool: "codex", autoCompact: 200000 })).toEqual({ name: "P", tool: "codex" });
  });
});

describe("the display name and the ID", () => {
  test("a name is free text of up to 64 characters", () => {
    expect(providerNameError("Claude Capra (work)")).toBeNull();
    expect(providerNameError("x".repeat(65))).toContain("64");
    expect(providerNameError("")).not.toBeNull();
    expect(providerNameError("   ")).not.toBeNull();
    expect(providerNameError("a\nb")).not.toBeNull();
  });

  test("a table keyed by IDs keeps entries whose names have spaces", () => {
    expect(parseProviders({ "claude-capra": { name: "Claude Capra", tool: "claude" } })).toEqual({
      "claude-capra": { name: "Claude Capra", short: "CC", tool: "claude" },
    });
  });

  test("an ID is made from the name when none is given: letters, digits, '-' and '_'", () => {
    expect(providerKeyFrom("Claude Capra (work)")).toBe("claude-capra-work");
    expect(providerKeyFrom("Æøå")).toBe("aeoa");
    expect(providerKeyFrom("!!!")).toBe("provider");
  });
});
