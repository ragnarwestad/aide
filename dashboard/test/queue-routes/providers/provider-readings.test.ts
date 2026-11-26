// A provider's Models and Installation tabs are read when the tab is
// opened, before the page answers, and only the open tab is read.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { forgetChecks, lastChecks, recordCheck } from "../../../src/serve/tool-check.ts";
import { lastModels } from "../../../src/serve/tool-models";
import type { CheckableTool, ExtraCheck, ToolCheck, ToolModels } from "../../../src/render";
import type { Provider } from "../../../src/queue/providers/index.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { AT, defaultsOf, modelsProbe, ownFiles, post, stubReads } from "../settings-models/fixtures.ts";

const { harness, start: startServer } = setupQueueRoutesHarness("aide-provider-readings-");
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  forgetChecks();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const CHOICES = { Opus: { model: "opus" }, Fable: { model: "fable" }, "gpt-5.5": { tool: "codex" as const } };

/** A board with the three providers, a probe that counts what it is asked, and
 *  the page's own reads stubbed so no CLI starts. */
function serve(probe: ReturnType<typeof countingProbe> | ReturnType<typeof modelsProbe>, providers?: Record<string, Provider>) {
  forgetChecks();
  const { file, modelIdsPath } = ownFiles(JSON.stringify({
    model: { default: "Opus" },
    modelChoices: CHOICES,
    providers: {
      Claude: { name: "Claude", tool: "claude" },
      Codex: { name: "Codex", tool: "codex" },
      OpenCode: { name: "OpenCode", tool: "opencode" },
    },
  }, null, 2), ownDirs);
  const { base } = startServer({
    ...stubReads, queueDefaults: { ...defaultsOf(CHOICES, { default: "Opus" }), ...(providers ? { providers } : {}) },
    queueConfigFile: file, modelIdsPath, toolProbe: probe,
  });
  return { base };
}

/** Counts each kind of read; what it answers is the test's to set. */
function countingProbe(over: { check?: (tool: CheckableTool, provider?: Provider) => Promise<ToolCheck>; models?: (tool: CheckableTool) => Promise<ToolModels> } = {}) {
  const probe = {
    checks: [] as CheckableTool[],
    checkedProviders: [] as (string | undefined)[],
    modelReads: [] as { tool: CheckableTool; configured: string[]; env?: Record<string, string>; bin?: string }[],
    check: async (tool: CheckableTool, provider?: Provider): Promise<ToolCheck> => {
      probe.checks.push(tool);
      probe.checkedProviders.push(provider?.name);
      return over.check ? over.check(tool, provider) : { tool, at: AT, found: true, missing: ["scripts"], extra: [] };
    },
    models: async (tool: CheckableTool, opts: { configured: string[]; env?: Record<string, string>; bin?: string }): Promise<ToolModels> => {
      probe.modelReads.push({ tool, configured: opts.configured, env: opts.env, bin: opts.bin });
      return over.models ? over.models(tool) : { tool, at: AT, offered: [] };
    },
  };
  return probe;
}

/** The provider's page with `tab` open. */
const open = (base: string, key: string, tab: string) =>
  fetch(`${base}/settings?tab=providers&provider=${encodeURIComponent(key)}&aitab=${tab}`);

describe("the Models tab", () => {
  test("it reads the models once, with the provider's own env and the tool's configured values, and shows the Models block with Add on what is offered", async () => {
    const probe = countingProbe({ models: async (tool) => ({ tool, at: AT, offered: [{ model: "gpt-6.1-sol" }] }) });
    const { base } = serve(probe);
    const res = await open(base, "Codex", "models");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(probe.modelReads).toHaveLength(1);
    expect(probe.modelReads[0]).toMatchObject({ tool: "codex", configured: ["gpt-5.5"] });
    expect(html).toContain('name="model" value="gpt-6.1-sol"');
    expect(html).toContain("/api/queue/settings/models/add");
  });

  test("a Claude provider is read with its own config folder in the env and the Claude values configured (AC-7)", async () => {
    const probe = countingProbe();
    const { base } = serve(probe);
    const dir = mkdtempSync(join(tmpdir(), "aide-provider-dir-"));
    ownDirs.push(dir);
    await post(base, "/api/queue/settings/providers/add", { tool: "claude", name: "Claude-2", configDir: dir });
    await open(base, "Claude-2", "models");
    expect(probe.modelReads).toHaveLength(1);
    expect(probe.modelReads[0]!.env).toMatchObject({ CLAUDE_CONFIG_DIR: dir });
    expect(probe.modelReads[0]!.configured).toEqual(["opus", "fable"]);
  });

  test("it records the reading under the provider's name, for Add and the notices (AC-11)", async () => {
    const { base } = serve(countingProbe({ models: async (tool) => ({ tool, at: AT, offered: [{ model: "gpt-6.1-sol" }] }) }));
    await open(base, "Codex", "models");
    expect(lastModels().codex).toMatchObject({ offered: [{ model: "gpt-6.1-sol" }], provider: "Codex" });
  });

  test("a provider with a binary path is read through that program, with its own env (AC-1)", async () => {
    const probe = countingProbe();
    const { base } = serve(probe, { Next: { name: "Next", tool: "claude", configDir: "/srv/claude-next", binary: "~/bin/claude-next" } });
    await open(base, "Next", "models");
    expect(probe.modelReads).toHaveLength(1);
    expect(probe.modelReads[0]!.bin).toBe(join(homedir(), "bin/claude-next"));
    expect(probe.modelReads[0]!.env).toMatchObject({ CLAUDE_CONFIG_DIR: "/srv/claude-next" });
  });

  test("a provider with no binary path is read through the tool's own program, with its own env (AC-4)", async () => {
    const probe = countingProbe();
    const { base } = serve(probe, { Own: { name: "Own", tool: "claude", configDir: "/srv/claude-own" } });
    await open(base, "Own", "models");
    expect(probe.modelReads[0]!.bin).toBeUndefined();
    expect(probe.modelReads[0]!.env).toMatchObject({ CLAUDE_CONFIG_DIR: "/srv/claude-own" });
  });


  test("a probe that throws is answered as a reading that failed, and kept as one (AC-9)", async () => {
    const { base } = serve(countingProbe({ models: async () => { throw new Error("opencode would not start"); } }));
    const res = await open(base, "OpenCode", "models");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("The models could not be read: opencode would not start");
    expect(lastModels().opencode?.error).toContain("opencode would not start");
  });

  test("a reading that ran out of time says so with its reason (AC-9)", async () => {
    const error = "claude -p --model opus /model did not finish in time.";
    const { base } = serve(countingProbe({ models: async (tool) => ({ tool, at: AT, offered: [], error }) }));
    const html = await (await open(base, "Claude", "models")).text();
    expect(html).toContain(`The models could not be read: ${error}`);
  });
});

describe("the Installation tab", () => {
  test("it runs the check once and shows the table with what the check found missing", async () => {
    const probe = countingProbe();
    const { base } = serve(probe);
    const res = await open(base, "Claude", "installation");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("~/.claude/skills/");
    expect(html).toContain("Not on this host: ~/.local/bin/");
    expect(probe.checks).toEqual(["claude"]);
    expect(probe.modelReads).toHaveLength(0);
  });

  test("it records the check it answered (AC-11)", async () => {
    const { base } = serve(countingProbe());
    await open(base, "Codex", "installation");
    expect(lastChecks().codex).toMatchObject({ tool: "codex", missing: ["scripts"] });
  });


  const login = (provider: string, ok: boolean): ExtraCheck => ({ question: "Is it logged in?", ok, detail: "", provider, ...(ok ? {} : { problem: `${provider} not logged in` }) });
  const TWO: Record<string, Provider> = { Claude: { name: "Claude", tool: "claude" }, "Claude-2": { name: "Claude-2", tool: "claude", configDir: "/srv/claude-2" } };
  const OLD = "2026-10-03T12:00:00.000Z";

  test("the check is handed the open provider only (AC-2)", async () => {
    const probe = countingProbe();
    const { base } = serve(probe, TWO);
    await open(base, "Claude-2", "installation");
    expect(probe.checkedProviders).toEqual(["Claude-2"]);
  });

  test("the stored check keeps the other provider's answer and its time, with the open one's new (AC-2)", async () => {
    const probe = countingProbe({ check: async (tool, provider) => ({ tool, at: AT, found: true, extra: [login(provider!.name, true)] }) });
    const { base } = serve(probe, TWO);
    recordCheck({ tool: "claude", at: OLD, found: true, extra: [login("Claude", false), login("Claude-2", false)] });
    await open(base, "Claude-2", "installation");
    const stored = lastChecks().claude!;
    expect(stored.at).toBe(OLD);
    expect(stored.extra.map((e) => [e.provider, e.ok])).toEqual([["Claude", false], ["Claude-2", true]]);
  });

  test("a switched-off provider's answer is not stored (AC-2)", async () => {
    const probe = countingProbe({ check: async (tool, provider) => ({ tool, at: AT, found: true, extra: [login(provider!.name, false)] }) });
    const { base } = serve(probe, { ...TWO, "Claude-2": { ...TWO["Claude-2"]!, enabled: false } });
    recordCheck({ tool: "claude", at: OLD, found: true, extra: [login("Claude", true)] });
    await open(base, "Claude-2", "installation");
    expect(probe.checkedProviders).toEqual(["Claude-2"]);
    expect(lastChecks().claude!.extra.map((e) => e.provider)).toEqual(["Claude"]);
  });

  test("a check that throws is answered as one that could not run (AC-9)", async () => {
    const { base } = serve(countingProbe({ check: async () => { throw new Error("spawn failed"); } }));
    const res = await open(base, "Claude", "installation");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("The check could not be run: spawn failed");
    expect(lastChecks().claude?.error).toContain("spawn failed");
  });

  test("a check that ran out of time says so in its own line (AC-9)", async () => {
    const error = "The check did not finish in time.";
    const { base } = serve(countingProbe({ check: async (tool) => ({ tool, at: AT, found: false, extra: [], error }) }));
    expect(await (await open(base, "Claude", "installation")).text()).toContain(error);
  });
});

describe("opening the page", () => {
  test("Config and Usage read neither the models nor the check", async () => {
    const probe = countingProbe();
    const { base } = serve(probe);
    for (const aitab of ["config", "usage"]) {
      expect((await open(base, "Claude", aitab)).status).toBe(200);
    }
    expect(probe.checks).toHaveLength(0);
    expect(probe.modelReads).toHaveLength(0);
  });
});

describe("the Check route is gone", () => {
  test("a POST to it is not found", async () => {
    const { base } = serve(countingProbe());
    expect((await post(base, "/api/queue/settings/check", { key: "Claude" })).status).toBe(404);
  });
});
