// Split out of project-settings.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../../src/serve/serve.ts";
import { SETTINGS_STEPS, type CheckableTool, type ProviderStatus, type ToolCheck, type ToolModels } from "../../../src/render";
import { forgetChecks, lastChecks, recordCheck } from "../../../src/serve/tool-check.ts";
import { lastModels, recordModels } from "../../../src/serve/tool-models";
import { JOB, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** A queue config of this suite's own, so a route that persists the
 *  allowlist has somewhere to write it. */
function ownConfig(contents: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-queue-projects-"));
  ownDirs.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, JSON.stringify(contents, null, 2));
  return file;
}


describe("Settings routes", () => {
  const DEFAULTS = {
    timeoutSec: { default: 1200, implement: 5400 }, permissionMode: { default: "acceptEdits" },
    model: { default: "sonnet" },
    modelChoices: { sonnet: {}, "codex-fast": { tool: "codex" as const } },
    providers: {
      Claude: { name: "Claude", tool: "claude" as const },
      Codex: { name: "Codex", tool: "codex" as const },
      OpenCode: { name: "OpenCode", tool: "opencode" as const },
    },
  };
  /** What opening a provider's page reads, so no test starts a real CLI. */
  const status = async (key: string): Promise<ProviderStatus> => ({ key, at: "2026-10-02T19:00:00.000Z", installed: true });
  const readsOnOpen = {
    providerProbe: status,
    usageProbe: async (_key: string, provider: { tool: "claude" | "codex" | "opencode" }) => ({ tool: provider.tool, at: "2026-10-02T19:00:00.000Z", windows: [] }),
  };
  const AUTH = { "content-type": "application/json", accept: "application/json" };
  const validModel = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "sonnet"]));
  const validTimeoutSec = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, 30]));
  const validBody = { model: validModel, timeoutSec: validTimeoutSec };

  // The check spawns a CLI and reaches the network, so a GET of the page
  // must never start one: it happens when the button is pressed.
  test("opening a provider's page runs no check", async () => {
    forgetChecks();
    const { base } = start({ queueDefaults: DEFAULTS, ...readsOnOpen });
    const html = await (await fetch(`${base}/settings/providers/edit?key=OpenCode&aitab=installation`)).text();
    expect(html).toContain('data-tool="opencode"');
    expect(html).toContain("Not checked yet.");
  });

  test("opening either tab of a provider's page after a press reads no check and no models, and shows the press's readings (AC-3)", async () => {
    forgetChecks();
    const toolProbe = countingProbe();
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe, ...readsOnOpen });
    expect((await pressCheck(base, "Claude")).status).toBe(200);
    const reads = () => [toolProbe.checks, toolProbe.modelReads];
    expect(reads()).toEqual([1, 1]);
    for (const aitab of ["models", "installation"]) {
      const html = await (await fetch(`${base}/settings/providers/edit?key=Claude&aitab=${aitab}`)).text();
      expect(html).toContain("2026-10-02 19:00:00 UTC");
      expect(reads()).toEqual([1, 1]);
    }
    forgetChecks();
  });

  test("the old Phases link still serves the models form", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const html = await (await fetch(`${base}/settings?tab=phases`)).text();
    expect(html).toContain("data-settings-form");
  });

  test("the check route refuses Copilot, a tool, and a key that is no provider (AC-25)", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    for (const body of [{ tool: "copilot" }, { tool: "claude" }, { key: "Copilot" }, { key: "../../bin/sh" }, {}]) {
      const res = await fetch(`${base}/api/queue/settings/check`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("is not a provider") });
    }
  });

  test("the check route answers GET with method not allowed", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const res = await fetch(`${base}/api/queue/settings/check`, );
    expect(res.status).toBe(405);
  });

  /** Stands in for every spawn a press makes, and counts each kind of read. */
  const countingProbe = () => {
    const probe = {
      checks: 0,
      modelReads: 0,
      check: async (tool: CheckableTool): Promise<ToolCheck> => {
        probe.checks += 1;
        return { tool, at: "2026-10-02T19:00:00.000Z", found: true, lines: [], extra: [] };
      },
      models: async (tool: CheckableTool): Promise<ToolModels> => {
        probe.modelReads += 1;
        return { tool, at: "2026-10-02T19:00:00.000Z", offered: [] };
      },
    };
    return probe;
  };

  const pressCheck = (base: string, key: string) =>
    fetch(`${base}/api/queue/settings/check`, { method: "POST", headers: AUTH, body: JSON.stringify({ key }) });

  /** Readings stored before the press, each from an earlier moment. */
  const EARLIER = "2026-10-01T08:00:00.000Z";
  const storeEarlier = () => {
    recordCheck({ tool: "claude", at: EARLIER, found: true, lines: ["earlier"], extra: [] });
    recordModels({ tool: "claude", at: EARLIER, offered: [] });
  };
  const stored = () => ({
    check: lastChecks().claude?.at, models: lastModels().claude?.at,
  });

  /** Each half logs when it starts and, a moment later, when it ends. */
  const waitingProbe = (log: string[], fail: Partial<Record<"check" | "models", Error>> = {}) => {
    const wait = () => new Promise((resolve) => setTimeout(resolve, 20));
    const half = async <T>(name: "check" | "models", value: T): Promise<T> => {
      log.push(`${name} start`);
      await wait();
      log.push(`${name} end`);
      if (fail[name]) throw fail[name];
      return value;
    };
    return {
      check: (tool: CheckableTool) => half("check", { tool, at: "2026-10-02T19:00:00.000Z", found: true, lines: [], extra: [] } as ToolCheck),
      models: (tool: CheckableTool) => half("models", { tool, at: "2026-10-02T19:00:00.000Z", offered: [] } as ToolModels),
    };
  };

  test("one press reads Installation and Models side by side, and stores what each returned, the models named for the provider (AC-3)", async () => {
    forgetChecks();
    storeEarlier();
    const log: string[] = [];
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe: waitingProbe(log) });
    const res = await pressCheck(base, "Claude");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; check: ToolCheck; models: ToolModels };
    expect(log.slice(0, 2).sort()).toEqual(["check start", "models start"]);
    expect(log.slice(2).every((line) => line.endsWith("end"))).toBe(true);
    expect(lastChecks().claude).toEqual(body.check);
    expect(lastModels().claude).toEqual(body.models);
    expect(body.models.provider).toBe("Claude");
    expect(stored()).toEqual({ check: body.check.at, models: body.models.at });
    forgetChecks();
  });

  test("a part named in the body is ignored, and a press without one still reads both (AC-3)", async () => {
    forgetChecks();
    const toolProbe = countingProbe();
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe });
    const res = await fetch(`${base}/api/queue/settings/check`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ key: "Claude", part: "everything" }),
    });
    expect(res.status).toBe(200);
    expect([toolProbe.checks, toolProbe.modelReads]).toEqual([1, 1]);
    forgetChecks();
  });

  test("a reading that throws is stored as one that failed, and the other is stored as it came (AC-3)", async () => {
    forgetChecks();
    const probe = waitingProbe([], { models: new Error("opencode would not start") });
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe: probe });
    const res = await pressCheck(base, "Claude");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { check: ToolCheck; models: ToolModels };
    expect(body.models.error).toContain("opencode would not start");
    expect(lastModels().claude?.error).toContain("opencode would not start");
    expect(lastChecks().claude).toEqual(body.check);
    expect(lastChecks().claude?.error).toBeUndefined();
    forgetChecks();
  });

  test("a check that throws is stored as one that could not run (AC-3)", async () => {
    forgetChecks();
    const probe = waitingProbe([], { check: new Error("spawn failed") });
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe: probe });
    expect((await pressCheck(base, "Claude")).status).toBe(200);
    expect(lastChecks().claude?.error).toContain("spawn failed");
    expect(lastModels().claude).toBeDefined();
    forgetChecks();
  });

  test("a successful save affects later jobs but not an accepted job", async () => {
    const file = ownConfig({ model: { default: "sonnet", future: "keep" } });
    const { base } = start({ queueDefaults: DEFAULTS, queueConfigFile: file });
    const accepted = await fetch(`${base}/api/queue`, {
      method: "POST", headers: AUTH, body: JSON.stringify(JOB),
    });
    const first = (await accepted.json()) as { job: { model: Record<string, string> } };
    const model = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "codex-fast"]));
    const saved = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ model, timeoutSec: validTimeoutSec }),
    });
    expect(saved.status).toBe(200);
    expect(first.job.model.analyze).toBe("sonnet");
    const later = await fetch(`${base}/api/queue`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: "82-second", steps: ["analyze"] }),
    });
    // The fixture does not discover 82-second, so use create to observe a later accepted job.
    const created = await fetch(`${base}/api/queue/create`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ project: "aide", title: "Later", description: "Later job" }),
    });
    expect(later.status).toBe(400);
    const createdBody = (await created.json()) as { job: { model: Record<string, string> } };
    expect(createdBody.job.model.create).toBe("codex-fast");
    expect(readFileSync(file, "utf-8")).toContain('"future": "keep"');
  });

  // Settings has no Fallback row, so the route saves the step rows only:
  // a `default` posted beside them is an unknown step, and nothing on
  // disk changes; the step rows alone save.
  test("a save naming model.default is refused and changes nothing", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const { base } = start({ queueDefaults: DEFAULTS, queueConfigFile: file });
    const refused = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...validBody, model: { ...validModel, default: "codex-fast" } }),
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("unknown workflow step: default");
    expect(readFileSync(file, "utf-8")).toEqual(JSON.stringify({ model: { default: "sonnet" } }, null, 2));
    const saved = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH, body: JSON.stringify(validBody),
    });
    expect(saved.status).toBe(200);
  });

  // A model typed in a different case is stored as listed.
  test("a differently-cased model is saved under the listed spelling", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const { base } = start({ queueDefaults: DEFAULTS, queueConfigFile: file });
    const res = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...validBody, model: { ...validModel, analyze: "CODEX-FAST" } }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf-8")) as { model: Record<string, string> };
    expect(saved.model.analyze).toBe("codex-fast");
  });

  // The provider of each phase is saved beside its model, and has to run it.
  test("the providers of the phases are saved beside the models, and one that cannot run its model is refused (AC-9)", async () => {
    const providers = {
      Claude: { name: "Claude", tool: "claude" as const },
      Codex: { name: "Codex", tool: "codex" as const },
    };
    const file = ownConfig({ model: { default: "sonnet" } });
    const defaults = { ...DEFAULTS, providers };
    const { base } = start({ queueDefaults: defaults, queueConfigFile: file });
    const body = (analyze: string) => JSON.stringify({
      ...validBody,
      model: { ...validModel, analyze: "codex-fast" },
      provider: { analyze },
    });
    const refused = await fetch(`${base}/api/queue/settings`, { method: "POST", headers: AUTH, body: body("Claude") });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("codex-fast is a Codex model and Claude is a Claude Code provider");
    expect(JSON.parse(readFileSync(file, "utf-8")).provider).toBeUndefined();
    const saved = await fetch(`${base}/api/queue/settings`, { method: "POST", headers: AUTH, body: body("Codex") });
    expect(saved.status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf-8")).provider).toEqual({ analyze: "Codex" });
    const unknown = await fetch(`${base}/api/queue/settings`, { method: "POST", headers: AUTH, body: body("Gone") });
    expect(unknown.status).toBe(400);
  });

  test("several case-only matches are refused, naming both, and nothing is written", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const defaults = { ...DEFAULTS, modelChoices: { Sonnet: {}, SONNET: {} } };
    const { base } = start({ queueDefaults: defaults, queueConfigFile: file });
    const res = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...validBody, model: { ...validModel, analyze: "sonnet" } }),
    });
    expect(res.status).toBe(400);
    const error = ((await res.json()) as { error: string }).error;
    expect(error).toContain("Sonnet");
    expect(error).toContain("SONNET");
    expect(readFileSync(file, "utf-8")).toEqual(JSON.stringify({ model: { default: "sonnet" } }, null, 2));
  });

  test("invalid input and missing config leave live defaults unchanged", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const { base } = start({ queueDefaults: DEFAULTS, queueConfigFile: file });
    for (const model of [
      { analyze: "sonnet" },
      { ...Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "sonnet"])), extra: "sonnet" },
      Object.fromEntries(SETTINGS_STEPS.map((step) => [step, step === "archive" ? "missing" : "sonnet"])),
    ]) {
      const res = await fetch(`${base}/api/queue/settings`, {
        method: "POST", headers: AUTH, body: JSON.stringify({ ...validBody, model }),
      });
      expect(res.status).toBe(400);
    }
    // Out-of-range / non-numeric per-step timeout.
    for (const overrides of [
      { timeoutSec: { ...validTimeoutSec, analyze: 0 } },
      { timeoutSec: { ...validTimeoutSec, analyze: 361 } },
      { timeoutSec: {} },
    ]) {
      const res = await fetch(`${base}/api/queue/settings`, {
        method: "POST", headers: AUTH, body: JSON.stringify({ ...validBody, ...overrides }),
      });
      expect(res.status).toBe(400);
    }
    expect(readFileSync(file, "utf-8")).toEqual(JSON.stringify({ model: { default: "sonnet" } }, null, 2));

    const without = start({ queueDefaults: DEFAULTS });
    const res = await fetch(`${without.base}/api/queue/settings`, {
      method: "POST", headers: AUTH, body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(400);
  });
});

describe("Settings' Process tab: how many steps may run at once", () => {
  const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };
  const FORM = { "content-type": "application/x-www-form-urlencoded" };

  /** A server with a runner. No job is queued in these tests, so the
   *  runner bin is never spawned. */
  function withRunner(extra: Partial<ServerOptions> = {}) {
    const own = mkdtempSync(join(tmpdir(), "aide-process-tab-"));
    ownDirs.push(own);
    return start({ queueRunnerBin: "/usr/bin/true", queueResultDir: join(own, "jobs"), ...extra });
  }

  /** The value the Process tab's field opens on. */
  async function shownCount(base: string): Promise<string | undefined> {
    const html = await (await fetch(`${base}/settings?tab=process`)).text();
    return html.match(/<input[^>]*name="concurrency"[^>]*>/)?.[0].match(/value="(\d+)"/)?.[1];
  }

  test("the tab opens on the count the running queue uses", async () => {
    const { base } = withRunner({ queueConcurrency: 3 });
    expect(await shownCount(base)).toBe("3");
  });

  test("with no value saved, the tab shows the built-in 2", async () => {
    const { base } = withRunner();
    expect(await shownCount(base)).toBe("2");
  });

  test("a form post saves, answers the new count, and the tab shows it", async () => {
    const file = ownConfig({ concurrency: 2 });
    const { base } = withRunner({ queueConcurrency: 2, queueConfigFile: file });
    const res = await fetch(`${base}/api/queue/settings/concurrency`, {
      method: "POST", headers: FORM, body: "concurrency=4", redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, concurrency: 4 });
    expect((JSON.parse(readFileSync(file, "utf-8")) as { concurrency: number }).concurrency).toBe(4);
    expect(await shownCount(base)).toBe("4");
  });

  test("a count outside 1 to 8 is refused with a message and nothing is saved", async () => {
    const file = ownConfig({ concurrency: 2 });
    const before = readFileSync(file, "utf-8");
    const { base } = withRunner({ queueConcurrency: 2, queueConfigFile: file });
    for (const body of [{ concurrency: 0 }, { concurrency: 9 }, { concurrency: 2.5 }, { concurrency: "abc" }, {}]) {
      const res = await fetch(`${base}/api/queue/settings/concurrency`, {
        method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    }
    expect(readFileSync(file, "utf-8")).toBe(before);
    expect(await shownCount(base)).toBe("2");
  });

  test("a refused form post answers why, and nothing is saved", async () => {
    const file = ownConfig({ concurrency: 2 });
    const before = readFileSync(file, "utf-8");
    const { base } = withRunner({ queueConcurrency: 2, queueConfigFile: file });
    for (const body of ["concurrency=abc", "concurrency="]) {
      const res = await fetch(`${base}/api/queue/settings/concurrency`, {
        method: "POST", headers: FORM, body, redirect: "manual",
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("whole number");
    }
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("a server with no queue, or whose config file is missing, saves nothing", async () => {
    const file = ownConfig({ concurrency: 2 });
    const before = readFileSync(file, "utf-8");
    const noRunner = start({ queueConfigFile: file });
    const refused = await fetch(`${noRunner.base}/api/queue/settings/concurrency`, {
      method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ concurrency: 3 }),
    });
    expect(refused.status).toBe(400);
    expect(readFileSync(file, "utf-8")).toBe(before);

    const missing = join(ownDirs[ownDirs.length - 1]!, "missing.json");
    const noFile = withRunner({ queueConcurrency: 2, queueConfigFile: missing });
    const res = await fetch(`${noFile.base}/api/queue/settings/concurrency`, {
      method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ concurrency: 3 }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(missing)).toBe(false);
    expect(await shownCount(noFile.base)).toBe("2");
  });
});
