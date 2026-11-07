// A provider's Models and Installation tabs read their own answer on an
// address each, once the page has drawn: the page itself reads neither.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetChecks, lastChecks } from "../../../src/serve/tool-check.ts";
import { lastModels } from "../../../src/serve/tool-models";
import type { CheckableTool, ToolCheck, ToolModels } from "../../../src/render";
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
function serve(probe: ReturnType<typeof countingProbe> | ReturnType<typeof modelsProbe>) {
  forgetChecks();
  const { file, modelIdsPath } = ownFiles(`{ "model": { "default": "Opus" } }\n`, ownDirs);
  const { base } = startServer({
    ...stubReads, queueDefaults: defaultsOf(CHOICES, { default: "Opus" }),
    queueConfigFile: file, modelIdsPath, toolProbe: probe,
  });
  return { base };
}

/** Counts each kind of read; what it answers is the test's to set. */
function countingProbe(over: { check?: (tool: CheckableTool) => Promise<ToolCheck>; models?: (tool: CheckableTool) => Promise<ToolModels> } = {}) {
  const probe = {
    checks: [] as CheckableTool[],
    modelReads: [] as { tool: CheckableTool; configured: string[]; env?: Record<string, string> }[],
    check: async (tool: CheckableTool): Promise<ToolCheck> => {
      probe.checks.push(tool);
      return over.check ? over.check(tool) : { tool, at: AT, found: true, lines: ["preflight says hello"], extra: [] };
    },
    models: async (tool: CheckableTool, opts: { configured: string[]; env?: Record<string, string> }): Promise<ToolModels> => {
      probe.modelReads.push({ tool, configured: opts.configured, env: opts.env });
      return over.models ? over.models(tool) : { tool, at: AT, offered: [] };
    },
  };
  return probe;
}

const get = (base: string, path: string) => fetch(`${base}${path}`);

describe("the Models address", () => {
  test("it reads the models once, with the provider's own env and the tool's configured values, and answers the Models block with Add on what is offered (AC-4, AC-7)", async () => {
    const probe = countingProbe({ models: async (tool) => ({ tool, at: AT, offered: [{ model: "gpt-6.1-sol" }] }) });
    const { base } = serve(probe);
    const res = await get(base, "/settings/providers/models?key=Codex");
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
    await get(base, "/settings/providers/models?key=Claude-2");
    expect(probe.modelReads).toHaveLength(1);
    expect(probe.modelReads[0]!.env).toMatchObject({ CLAUDE_CONFIG_DIR: dir });
    expect(probe.modelReads[0]!.configured).toEqual(["opus", "fable"]);
  });

  test("it records the reading under the provider's name, for Add and the notices (AC-11)", async () => {
    const { base } = serve(countingProbe({ models: async (tool) => ({ tool, at: AT, offered: [{ model: "gpt-6.1-sol" }] }) }));
    await get(base, "/settings/providers/models?key=Codex");
    expect(lastModels().codex).toMatchObject({ offered: [{ model: "gpt-6.1-sol" }], provider: "Codex" });
  });

  test("a key that is no provider is not found, and a POST is not allowed (AC-7)", async () => {
    const probe = countingProbe();
    const { base } = serve(probe);
    expect((await get(base, "/settings/providers/models?key=Gone")).status).toBe(404);
    expect((await get(base, "/settings/providers/models")).status).toBe(404);
    expect((await post(base, "/settings/providers/models?key=Claude", {})).status).toBe(405);
    expect(probe.modelReads).toHaveLength(0);
  });

  test("a probe that throws is answered as a reading that failed, and kept as one (AC-9)", async () => {
    const { base } = serve(countingProbe({ models: async () => { throw new Error("opencode would not start"); } }));
    const res = await get(base, "/settings/providers/models?key=OpenCode");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("The models could not be read: opencode would not start");
    expect(lastModels().opencode?.error).toContain("opencode would not start");
  });

  test("a reading that ran out of time says so with its reason (AC-9)", async () => {
    const error = "claude -p --model opus /model did not finish in time.";
    const { base } = serve(countingProbe({ models: async (tool) => ({ tool, at: AT, offered: [], error }) }));
    const html = await (await get(base, "/settings/providers/models?key=Claude")).text();
    expect(html).toContain(`The models could not be read: ${error}`);
  });
});

describe("the Installation address", () => {
  test("it runs the check once and answers the installation reading, holding the preflight's lines (AC-5, AC-7)", async () => {
    const probe = countingProbe();
    const { base } = serve(probe);
    const res = await get(base, "/settings/providers/installation?key=Claude");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("preflight says hello");
    expect(probe.checks).toEqual(["claude"]);
    expect(probe.modelReads).toHaveLength(0);
  });

  test("it records the check it answered (AC-11)", async () => {
    const { base } = serve(countingProbe());
    await get(base, "/settings/providers/installation?key=Codex");
    expect(lastChecks().codex).toMatchObject({ tool: "codex", lines: ["preflight says hello"] });
  });

  test("a key that is no provider is not found, and a POST is not allowed (AC-7)", async () => {
    const probe = countingProbe();
    const { base } = serve(probe);
    expect((await get(base, "/settings/providers/installation?key=Gone")).status).toBe(404);
    expect((await post(base, "/settings/providers/installation?key=Claude", {})).status).toBe(405);
    expect(probe.checks).toHaveLength(0);
  });

  test("a check that throws is answered as one that could not run (AC-9)", async () => {
    const { base } = serve(countingProbe({ check: async () => { throw new Error("spawn failed"); } }));
    const res = await get(base, "/settings/providers/installation?key=Claude");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("The check could not be run: spawn failed");
    expect(lastChecks().claude?.error).toContain("spawn failed");
  });

  test("a check that ran out of time says so in its own line (AC-9)", async () => {
    const error = "The check did not finish in time.";
    const { base } = serve(countingProbe({ check: async (tool) => ({ tool, at: AT, found: false, lines: [], extra: [], error }) }));
    expect(await (await get(base, "/settings/providers/installation?key=Claude")).text()).toContain(error);
  });
});

describe("opening the page", () => {
  test("it reads neither the models nor the check, whichever tab is open (AC-7)", async () => {
    const probe = countingProbe();
    const { base } = serve(probe);
    for (const aitab of ["overview", "config", "models", "installation"]) {
      expect((await get(base, `/settings?tab=providers&provider=Claude&aitab=${aitab}`)).status).toBe(200);
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
