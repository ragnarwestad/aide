// A provider's usage, read by the server in the background: when it starts
// and then on an interval, kept until the next reading of the same provider
// replaces it, and shown from the kept reading by the header's panel, the
// panel's route and the provider's Usage tab.

import { afterEach, expect, setSystemTime, test } from "bun:test";
import { rmSync } from "node:fs";
import { Window } from "happy-dom";
import { t } from "../../../src/i18n";
import type { Provider } from "../../../src/queue/providers/index.ts";
import type { QueueDefaults } from "../../../src/queue/types.ts";
import type { ToolUsage } from "../../../src/render";
import { readProviderUsage } from "../../../src/serve/providers/status.ts";
import { keptUsage, readAllUsage, readUsage, usageReader } from "../../../src/serve/providers/usage-kept.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { forgetChecks } from "../../../src/serve/tool-check.ts";
import { defaultsOf, modelsProbe, ownFiles, post } from "../settings-models/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-provider-usage-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  forgetChecks();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const AT = "2026-11-06T09:00:00.000Z";
const READING = t("en", "usage.reading");
const USAGE_ROUTE = "/api/queue/settings/providers/usage";
const PROVIDERS: Record<string, Provider> = {
  Claude: { name: "Claude", tool: "claude" },
  Codex: { name: "Codex", tool: "codex" },
  OpenCode: { name: "OpenCode", tool: "opencode" },
};

/** Asks again until `ok` holds, and throws when it never does. */
async function until(ok: () => boolean | Promise<boolean>, what: string, budgetMs = 10_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!(await ok())) {
    if (Date.now() > deadline) throw new Error(`never reached ${what} within ${budgetMs}ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A server whose usage reading is a stub that counts its calls and, when
 *  `held`, answers only once `release()` is called. No tab starts a real tool. */
function serve(opts: { usagePollMs?: number; held?: boolean } = {}) {
  const reads: { key: string; provider: Provider }[] = [];
  const waiting: (() => void)[] = [];
  const { file, modelIdsPath } = ownFiles(JSON.stringify({ model: { default: "Opus" }, providers: PROVIDERS }), ownDirs);
  const queueDefaults: QueueDefaults = { ...defaultsOf({ Opus: {} }, { default: "Opus" }), providers: structuredClone(PROVIDERS) };
  const usageProbe = async (key: string, provider: Provider): Promise<ToolUsage> => {
    reads.push({ key, provider });
    if (opts.held) await new Promise<void>((resolve) => waiting.push(resolve));
    return { tool: provider.tool, at: AT, windows: [{ name: `Window of ${provider.name}`, usedPercent: 7 }] };
  };
  const { base } = start({
    queueDefaults, queueConfigFile: file, modelIdsPath, usageProbe, usagePollMs: opts.usagePollMs ?? 60_000,
    providerProbe: async (key: string) => ({ key, at: AT, installed: true }),
    toolProbe: modelsProbe(),
  });
  const text = (path: string) => fetch(`${base}${path}`).then((r) => r.text());
  return {
    base, reads, text,
    keys: () => reads.map((read) => read.key),
    release: () => { while (waiting.length) waiting.shift()!(); },
    /** Every Claude Code and Codex provider has a finished reading. */
    read: () => until(async () => {
      const html = await text(USAGE_ROUTE);
      return html.includes("Window of") && !html.includes(READING);
    }, "a finished reading of every provider"),
  };
}

/** The header's Usage panel as a page carries it. */
function panelOf(html: string): string {
  const page = new (new Window()).DOMParser().parseFromString(html, "text/html");
  return page.querySelector("[data-usage-content]")?.innerHTML ?? "";
}

/** The page's own part, below the header. */
const mainOf = (html: string): string => html.slice(html.indexOf("<main"));

const tabPath = (key: string, tab: string) => `/settings?tab=providers&provider=${key}&aitab=${tab}`;

test("a server that has started has read every Claude Code and Codex provider, with no page asked for (AC-1)", async () => {
  const { reads, keys } = serve();
  await until(() => reads.length >= 2, "the readings at start");
  expect(keys().sort()).toEqual(["Claude", "Codex"]);
});

test("every Claude Code and Codex provider is read again when the interval has passed (AC-2)", async () => {
  const { keys } = serve({ usagePollMs: 20 });
  const times = (key: string) => keys().filter((read) => read === key).length;
  await until(() => times("Claude") >= 2 && times("Codex") >= 2, "a second reading of each provider");
  expect(keys()).not.toContain("OpenCode");
});

test("a reading is kept however old it gets, until a newer reading of the provider replaces it (AC-3)", async () => {
  const owner = {};
  const provider = PROVIDERS.Claude!;
  const first: ToolUsage = { tool: "claude", at: AT, windows: [] };
  const second: ToolUsage = { tool: "claude", at: "2026-11-07T09:00:00.000Z", windows: [] };
  await readUsage(owner, "Claude", provider, async () => first);
  setSystemTime(new Date(Date.now() + 24 * 60 * 60_000));
  try {
    expect(keptUsage(owner, "Claude")).toBe(first);
    await readUsage(owner, "Claude", provider, async () => second);
    expect(keptUsage(owner, "Claude")).toBe(second);
  } finally {
    setSystemTime();
  }
});

test("a reading that ends after a newer reading of the provider was started does not replace it (AC-3)", async () => {
  const owner = {};
  const older: ToolUsage = { tool: "claude", at: AT, windows: [] };
  const newer: ToolUsage = { tool: "claude", at: "2026-11-07T09:00:00.000Z", windows: [] };
  let endOlder!: (usage: ToolUsage) => void;
  const first = readUsage(owner, "Claude", { name: "Claude", tool: "claude" }, () => new Promise<ToolUsage>((resolve) => { endOlder = resolve; }));
  await readUsage(owner, "Claude", { name: "Claude Work", tool: "claude" }, async () => newer);
  endOlder(older);
  await first;
  expect(keptUsage(owner, "Claude")).toBe(newer);
});

test("a provider whose reading is still under way is not read a second time by the next round (AC-4)", async () => {
  const owner = {};
  let reads = 0;
  let end!: (usage: ToolUsage) => void;
  const read = (): Promise<ToolUsage> => {
    reads += 1;
    return new Promise<ToolUsage>((resolve) => { end = resolve; });
  };
  const providers = { Claude: PROVIDERS.Claude! };
  const first = readAllUsage(owner, providers, read);
  const second = readAllUsage(owner, providers, read);
  end({ tool: "claude", at: AT, windows: [] });
  await Promise.all([first, second]);
  expect(reads).toBe(1);
});

test("a provider saved with a changed setting is read once more at once, as it is now (AC-5)", async () => {
  const { base, reads, read } = serve();
  await read();
  expect(reads).toHaveLength(2);
  expect((await post(base, "/api/queue/settings/providers/edit", { key: "Claude", name: "Claude Work" })).status).toBe(200);
  await until(() => reads.length >= 3, "the saved provider's reading");
  expect(reads[2]).toEqual({ key: "Claude", provider: { name: "Claude Work", tool: "claude" } });
  expect(reads).toHaveLength(3);
});

test("a page carries the Usage panel with the kept reading of every Claude Code and Codex provider (AC-6)", async () => {
  const { text, read } = serve();
  await read();
  const panel = panelOf(await text("/"));
  expect(panel).toContain("Window of Claude");
  expect(panel).toContain("Window of Codex");
  expect(panel).not.toContain("OpenCode");
});

test("the usage route answers the panel from the kept readings and starts no reading (AC-7)", async () => {
  const { text, reads, read } = serve();
  await read();
  for (const address of [USAGE_ROUTE, `${USAGE_ROUTE}?read=Claude`, `${USAGE_ROUTE}?read=Nobody`]) {
    const html = await text(address);
    expect(html).toContain("Window of Claude");
    expect(html).toContain("Window of Codex");
  }
  expect(reads).toHaveLength(2);
});

test("the Usage tab shows the kept reading, and no tab of the provider starts a reading (AC-8)", async () => {
  const { text, reads, read } = serve();
  await read();
  for (const tab of ["config", "models", "installation"]) await text(tabPath("Claude", tab));
  expect(mainOf(await text(tabPath("Claude", "usage")))).toContain("Window of Claude");
  expect(reads).toHaveLength(2);
});

test("the Usage tab answers while the provider's first reading is still under way (AC-8)", async () => {
  const { base, reads, release } = serve({ held: true });
  const response = await fetch(`${base}${tabPath("Codex", "usage")}`);
  expect(response.status).toBe(200);
  expect(reads).toHaveLength(2);
  release();
});

test("the panel, its route and the Usage tab say usage is being read only until the provider's first reading (AC-9)", async () => {
  const { text, read, release } = serve({ held: true });
  const places = async () => [
    await text(USAGE_ROUTE),
    panelOf(await text("/")),
    mainOf(await text(tabPath("Claude", "usage"))),
  ];
  for (const place of await places()) expect(place).toContain(READING);
  release();
  await read();
  for (const place of await places()) expect(place).not.toContain(READING);
});

test("with the interval set to 0 the server starts no reading, and the panel's route starts none either (AC-10)", async () => {
  const { text, reads } = serve({ usagePollMs: 0 });
  expect(await text(USAGE_ROUTE)).toContain(READING);
  expect(reads).toEqual([]);
});

test("usage is read with the test's probe, with the real tools on a server started to check them, and otherwise not at all", () => {
  const probe = async (_key: string, provider: Provider): Promise<ToolUsage> => ({ tool: provider.tool, at: AT, windows: [] });
  expect(usageReader({ usageProbe: probe, checkToolsOnStart: true })).toBe(probe);
  expect(usageReader({ checkToolsOnStart: true })).toBe(readProviderUsage);
  expect(usageReader({})).toBeUndefined();
});
