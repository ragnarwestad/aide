// Split out of project-settings.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../../src/serve/serve.ts";
import { SETTINGS_STEPS, type CheckableTool, type ToolCheck, type ToolModels, type ToolUsage } from "../../../src/render";
import { forgetChecks, lastChecks, recordCheck } from "../../../src/serve/tool-check.ts";
import { lastUsage, recordUsage } from "../../../src/serve/tool-usage";
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


describe("Settings routes (spec 232)", () => {
  const DEFAULTS = {
    timeoutSec: { default: 1200, implement: 5400 }, permissionMode: { default: "acceptEdits" },
    model: { default: "sonnet" },
    modelChoices: { sonnet: {}, "codex-fast": { tool: "codex" as const } },
  };
  const AUTH = { "content-type": "application/json", accept: "application/json" };
  const validModel = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "sonnet"]));
  const validTimeoutSec = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, 30]));
  const validBody = { model: validModel, timeoutSec: validTimeoutSec };

  // The check spawns a CLI and reaches the network, so a GET of the page
  // must never start one: it happens when the button is pressed.
  test("opening an AI tab runs no check", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const html = await (
      await fetch(`${base}/settings?tab=opencode&aitab=installation`, )
    ).text();
    expect(html).toContain('data-tool="opencode"');
    expect(html).toContain("Not checked yet.");
  });

  test("the old Phases link still serves the models form (AC-4)", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const html = await (await fetch(`${base}/settings?tab=phases`)).text();
    expect(html).toContain("data-settings-form");
  });

  test("the check route refuses a tool it does not know", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const res = await fetch(`${base}/api/queue/settings/check`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ tool: "../../bin/sh" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("unknown tool") });
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
      usageReads: 0,
      modelReads: 0,
      check: async (tool: CheckableTool): Promise<ToolCheck> => {
        probe.checks += 1;
        return { tool, at: "2026-10-02T19:00:00.000Z", found: true, lines: [], extra: [] };
      },
      usage: async (tool: CheckableTool): Promise<ToolUsage> => {
        probe.usageReads += 1;
        return { tool, at: "2026-10-02T19:00:00.000Z", windows: [{ name: "Stand-in window", usedPercent: 42 }] };
      },
      models: async (tool: CheckableTool): Promise<ToolModels> => {
        probe.modelReads += 1;
        return { tool, at: "2026-10-02T19:00:00.000Z", offered: [] };
      },
    };
    return probe;
  };

  const pressCheck = (base: string, tool: string, part?: string) =>
    fetch(`${base}/api/queue/settings/check`, { method: "POST", headers: AUTH, body: JSON.stringify({ tool, part }) });

  /** Readings stored before the press, each from an earlier moment. */
  const EARLIER = "2026-10-01T08:00:00.000Z";
  const storeEarlier = () => {
    recordCheck({ tool: "claude", at: EARLIER, found: true, lines: ["earlier"], extra: [] });
    recordUsage({ tool: "claude", at: EARLIER, windows: [] });
    recordModels({ tool: "claude", at: EARLIER, offered: [] });
  };
  const stored = () => ({
    check: lastChecks().claude?.at, usage: lastUsage().claude?.at, models: lastModels().claude?.at,
  });

  test.each([
    ["installation", "check", { checks: 1, usageReads: 0, modelReads: 0 }],
    ["subscription", "usage", { checks: 0, usageReads: 1, modelReads: 0 }],
    ["models", "models", { checks: 0, usageReads: 0, modelReads: 1 }],
  ] as const)("a press on the %s tab reads only that, and leaves the other two readings as they were (AC-4)", async (part, kind, reads) => {
    forgetChecks();
    storeEarlier();
    const toolProbe = countingProbe();
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe });
    const res = await pressCheck(base, "claude", part);
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()) as object).sort()).toEqual(["ok", kind].sort());
    expect({ checks: toolProbe.checks, usageReads: toolProbe.usageReads, modelReads: toolProbe.modelReads }).toEqual(reads);
    const now = "2026-10-02T19:00:00.000Z";
    expect(stored()).toEqual({
      check: kind === "check" ? now : EARLIER,
      usage: kind === "usage" ? now : EARLIER,
      models: kind === "models" ? now : EARLIER,
    });
    forgetChecks();
  });

  test("a press naming no tab, or one it does not know, is refused and reads nothing (AC-4)", async () => {
    forgetChecks();
    const toolProbe = countingProbe();
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe });
    for (const part of [undefined, "everything"]) {
      const res = await pressCheck(base, "claude", part);
      expect(res.status).toBe(400);
      const { error } = (await res.json()) as { error: string };
      for (const name of ["models", "subscription", "installation"]) expect(error).toContain(name);
    }
    expect(toolProbe.checks + toolProbe.usageReads + toolProbe.modelReads).toBe(0);
  });

  test("an AI's tab opens on Models: the one Check on it reads the models (AC-2)", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const html = await (await fetch(`${base}/settings?tab=claude`)).text();
    const checks = [...html.matchAll(/<form [^>]*action="\/api\/queue\/settings\/check"[^>]*>([\s\S]*?)<\/form>/g)];
    expect(checks.length).toBe(1);
    expect(checks[0]![1]).toContain('name="part" value="models"');
  });

  test("a press of Check answers with the AI's usage, and stores it (AC-7)", async () => {
    forgetChecks();
    const toolProbe = countingProbe();
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe });
    const res = await pressCheck(base, "claude", "subscription");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { usage: ToolUsage };
    expect(body.usage.windows).toEqual([{ name: "Stand-in window", usedPercent: 42 }]);
    expect(lastUsage().claude).toEqual(body.usage);
    forgetChecks();
  });

  test("usage is read by a press of Check, never by opening a page (AC-6)", async () => {
    forgetChecks();
    const toolProbe = countingProbe();
    const { base } = start({ queueDefaults: DEFAULTS, toolProbe });
    await (await fetch(`${base}/settings`)).text();
    await (await fetch(`${base}/settings?tab=claude`)).text();
    expect(toolProbe.usageReads).toBe(0);
    expect((await pressCheck(base, "claude", "subscription")).status).toBe(200);
    expect(toolProbe.usageReads).toBe(1);
    const html = await (await fetch(`${base}/settings?tab=claude&aitab=subscription`)).text();
    expect(html.split("Stand-in window").length - 1).toBe(1);
    expect(toolProbe.usageReads).toBe(1);
    forgetChecks();
  });

  test("a successful save affects later jobs but not an accepted job (AC-4)", async () => {
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
  test("a save naming model.default is refused and changes nothing (AC-2)", async () => {
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

  // Spec 494: a model typed in a different case is stored as listed.
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

  test("the tab opens on the count the running queue uses (AC-1)", async () => {
    const { base } = withRunner({ queueConcurrency: 3 });
    expect(await shownCount(base)).toBe("3");
  });

  test("with no value saved, the tab shows the built-in 2 (AC-5)", async () => {
    const { base } = withRunner();
    expect(await shownCount(base)).toBe("2");
  });

  test("a form post saves, answers the new count, and the tab shows it (AC-2)", async () => {
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

  test("a count outside 1 to 8 is refused with a message and nothing is saved (AC-3)", async () => {
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

  test("a refused form post answers why, and nothing is saved (AC-3)", async () => {
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

  test("a server with no queue, or whose config file is missing, saves nothing (AC-3)", async () => {
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
