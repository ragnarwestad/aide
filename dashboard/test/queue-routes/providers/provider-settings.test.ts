// Adding, editing (the name among the fields) and removing a provider on
// Settings → Providers, and the pages that add and edit one. The file is
// written first and the live providers changed after; a refusal changes
// neither.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import type { Provider } from "../../../src/queue/providers/index.ts";
import type { QueueDefaults } from "../../../src/queue/types.ts";
import type { ProviderStatus, ToolUsage } from "../../../src/render";
import { JOB, setupQueueRoutesHarness } from "../fixtures.ts";
import { JSON_HEADERS, defaultsOf, ownFiles, post } from "../settings-models/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-providers-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const ADD = "/api/queue/settings/providers/add";
const EDIT = "/api/queue/settings/providers/edit";
const REMOVE = "/api/queue/settings/providers/remove";

const CONFIG = `{
  // the operator's own note
  "model": { "default": "Opus" }
}
`;

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-provider-dir-"));
  ownDirs.push(dir);
  return dir;
}

/** What a read of a provider answers here, so no test starts a real CLI. */
type Probe = (key: string, provider: Provider, opts?: { login?: boolean }) => Promise<ProviderStatus>;
const stubProbe: Probe = async (key) => ({ key, at: "2026-11-05T09:00:00.000Z", installed: true, version: `9.9.9 (${key})` });
const stubUsage = async (key: string, provider: Provider): Promise<ToolUsage> =>
  ({ tool: provider.tool, at: "2026-11-05T09:00:00.000Z", windows: [{ name: `Window of ${key}`, usedPercent: 7 }] });

function serve(
  extra: Partial<QueueDefaults> = {}, config = CONFIG, providerProbe: Probe = stubProbe, usageProbe = stubUsage,
  toolProbe?: NonNullable<Parameters<typeof start>[0]>["toolProbe"],
) {
  const { file, modelIdsPath } = ownFiles(config, ownDirs);
  const queueDefaults = {
    ...defaultsOf({ Opus: {}, "gpt-6": { tool: "codex" } }, { default: "Opus" }),
    providers: { Claude: { name: "Claude", tool: "claude" }, Codex: { name: "Codex", tool: "codex" } },
    ...extra,
  } as QueueDefaults;
  const { base } = start({ queueDefaults, queueConfigFile: file, modelIdsPath, providerProbe, usageProbe, toolProbe });
  return { base, file, queueDefaults };
}

const providersIn = (file: string) => (parse(readFileSync(file, "utf-8")) as { providers?: Record<string, unknown> }).providers;
const errorOf = async (res: Response): Promise<string> => ((await res.json()) as { error: string }).error;

describe("adding, editing and removing a provider", () => {
  test("each writes the file and keeps the rest of it, and the live providers follow (AC-1)", async () => {
    const { base, file, queueDefaults } = serve();
    const dir = folder();
    expect((await post(base, ADD, { tool: "claude", name: "Claude-Capra", configDir: dir })).status).toBe(200);
    expect(providersIn(file)?.["Claude-Capra"]).toEqual({ name: "Claude-Capra", tool: "claude", configDir: dir });
    expect(queueDefaults.providers?.["Claude-Capra"]?.configDir).toBe(dir);
    expect(readFileSync(file, "utf-8")).toContain("// the operator's own note");

    const other = folder();
    expect((await post(base, EDIT, { key: "Claude-Capra", name: "Claude-Capra", configDir: other })).status).toBe(200);
    expect(queueDefaults.providers?.["Claude-Capra"]).toEqual({ name: "Claude-Capra", tool: "claude", configDir: other });

    expect((await post(base, REMOVE, { key: "Claude-Capra" })).status).toBe(200);
    expect(providersIn(file)?.["Claude-Capra"]).toBeUndefined();
    expect(queueDefaults.providers?.["Claude-Capra"]).toBeUndefined();
  });

  test("a name changed on the provider's page is saved under the same key (AC-14)", async () => {
    const { base, file, queueDefaults } = serve();
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: "Claude-Capra", configDir: dir });
    expect((await post(base, EDIT, { key: "Claude-Capra", name: "Capra", configDir: dir })).status).toBe(200);
    expect(providersIn(file)?.["Claude-Capra"]).toEqual({ name: "Capra", tool: "claude", configDir: dir });
    expect(queueDefaults.providers?.["Claude-Capra"]?.name).toBe("Capra");
  });

  test("a rename leaves the key a phase default, a schedule entry and a queued job hold, so each now shows the new name (AC-14)", async () => {
    const schedules = `{ "schedules": { "aide": [{ "name": "nightly", "cron": "0 3 * * *", "prompt": "p.md", "provider": "Capra" }] } }\n`;
    const { base, file, queueDefaults } = serve({ provider: { implement: "Capra" } }, schedules);
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: "Capra", configDir: dir });
    const queued = await fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...JOB, provider: "Capra" }) });
    const jobBefore = ((await queued.json()) as { job: { provider: Record<string, string> } }).job;
    expect((await post(base, EDIT, { key: "Capra", name: "Konto", configDir: dir })).status).toBe(200);

    expect(queueDefaults.provider?.implement).toBe("Capra");
    expect(queueDefaults.providers?.[queueDefaults.provider!.implement!]?.name).toBe("Konto");
    const jobs = (await (await fetch(`${base}/api/queue`)).json()) as { jobs: { id: string; provider?: Record<string, string> }[] };
    const job = jobs.jobs.find((j) => Object.values(j.provider ?? {}).includes("Capra"));
    expect(job?.provider).toEqual(jobBefore.provider);
    expect(queueDefaults.providers?.[Object.values(job!.provider!)[0]!]?.name).toBe("Konto");
    const written = parse(readFileSync(file, "utf-8")) as { schedules: { aide: { provider: string }[] } };
    expect(written.schedules.aide[0]!.provider).toBe("Capra");
  });

  test("a key never changes: a name added after a renamed one gets its own key (AC-1)", async () => {
    const { base, queueDefaults } = serve();
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: "Capra", configDir: dir });
    await post(base, EDIT, { key: "Capra", name: "Other", configDir: dir });
    await post(base, ADD, { tool: "claude", name: "Capra", configDir: folder() });
    expect(Object.keys(queueDefaults.providers!)).toEqual(["Claude", "Codex", "Capra", "Capra-2"]);
    expect(queueDefaults.providers?.Capra?.name).toBe("Other");
  });

  test("a key made for a taken 64-character name stays within 64 characters (AC-2)", async () => {
    const { base, queueDefaults } = serve();
    const long = "x".repeat(64);
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: long, configDir: dir });
    await post(base, EDIT, { key: long, name: "Other", configDir: dir });
    expect((await post(base, ADD, { tool: "claude", name: long, configDir: folder() })).status).toBe(200);
    const keys = Object.keys(queueDefaults.providers!);
    expect(keys.every((k) => k.length <= 64)).toBe(true);
    expect(keys).toHaveLength(4);
  });

  test("an empty name, a name with a character a provider cannot have and a name another provider has in any case are refused, on Add and on Edit, with the sentence for each, the file as it was (AC-17)", async () => {
    const { base, file } = serve();
    const before = readFileSync(file, "utf-8");
    for (const name of ["", "   ", "a\nb", "x".repeat(65)]) {
      for (const [path, body] of [[ADD, { tool: "opencode", name }], [EDIT, { key: "Claude", name }]] as const) {
        const res = await post(base, path, body);
        expect(res.status).toBe(400);
      }
    }
    const taken = await post(base, EDIT, { key: "Claude", name: "codex" });
    expect(taken.status).toBe(400);
    expect(await errorOf(taken)).toContain("Codex is already a provider");
    const added = await post(base, ADD, { tool: "opencode", name: "CLAUDE" });
    expect(await errorOf(added)).toContain("Claude is already a provider");
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("a provider can keep its own name on Edit (AC-17)", async () => {
    const { base } = serve();
    expect((await post(base, EDIT, { key: "Claude", name: "Claude" })).status).toBe(200);
  });

  test("the providers the conversion made are renamed and removed like any other, in the file and live (AC-22)", async () => {
    const { base, file, queueDefaults } = serve({
      providers: {
        Claude: { name: "Claude", tool: "claude" }, Codex: { name: "Codex", tool: "codex" }, OpenCode: { name: "OpenCode", tool: "opencode" },
      },
    }, '{ "providers": { "Claude": { "name": "Claude", "tool": "claude" }, "Codex": { "name": "Codex", "tool": "codex" }, "OpenCode": { "name": "OpenCode", "tool": "opencode" } } }\n');
    expect((await post(base, EDIT, { key: "Codex", name: "Codex-main" })).status).toBe(200);
    expect((await post(base, REMOVE, { key: "OpenCode" })).status).toBe(200);
    expect(Object.fromEntries(Object.entries(providersIn(file) as Record<string, { name: string }>).map(([k, v]) => [k, v.name]))).toEqual({
      Claude: "Claude", Codex: "Codex-main",
    });
    expect(Object.fromEntries(Object.entries(queueDefaults.providers!).map(([k, v]) => [k, v.name]))).toEqual({
      Claude: "Claude", Codex: "Codex-main",
    });
  });
});

describe("a provider whose tool is not installed", () => {
  const missing: Probe = async (key, provider) => ({ key, at: "x", installed: provider.tool !== "codex" });

  test("is refused on Add and on Edit, naming the tool, nothing written, and only the version asked (AC-16)", async () => {
    const asked: ({ login?: boolean } | undefined)[] = [];
    const probe: Probe = async (key, provider, opts) => { asked.push(opts); return missing(key, provider, opts); };
    const { base, file } = serve({}, CONFIG, probe);
    const before = readFileSync(file, "utf-8");
    const added = await post(base, ADD, { tool: "codex", name: "Codex-2", codexHome: folder() });
    expect(added.status).toBe(400);
    expect(await errorOf(added)).toContain("Codex is not installed on the machine serving the board");
    const edited = await post(base, EDIT, { key: "Codex", name: "Codex" });
    expect(edited.status).toBe(400);
    expect(await errorOf(edited)).toContain("Codex is not installed");
    expect(readFileSync(file, "utf-8")).toBe(before);
    expect(asked).toEqual([{ login: false }, { login: false }]);
  });

  test("a tool that is installed is saved (AC-16)", async () => {
    const { base } = serve({}, CONFIG, missing);
    expect((await post(base, ADD, { tool: "opencode", name: "Open" })).status).toBe(200);
  });
});

describe("a provider that is not logged in", () => {
  test("is saved, since a save asks no login (AC-19)", async () => {
    const probe: Probe = async (key, _provider, opts) => ({
      key, at: "x", installed: true,
      ...(opts?.login === false ? {} : { login: { question: "Is it logged in?", ok: false, detail: "", answer: { key: "login.out" as const, values: { command: "x" } } } }),
    });
    const { base, queueDefaults } = serve({}, CONFIG, probe);
    expect((await post(base, ADD, { tool: "claude", name: "Not-in", configDir: folder() })).status).toBe(200);
    expect(queueDefaults.providers?.["Not-in"]).toBeDefined();
  });

  test("a folder that is not there yet is made, and a path that is a file is refused (AC-19)", async () => {
    const { base, file } = serve();
    const parent = folder();
    const home = join(parent, "codex-new");
    const shadow = join(parent, "shadow-new");
    expect(existsSync(home)).toBe(false);
    expect((await post(base, ADD, { tool: "codex", name: "Codex-new", codexHome: home, shadowHome: shadow })).status).toBe(200);
    expect(existsSync(home)).toBe(true);
    expect(existsSync(shadow)).toBe(true);
    const config = join(parent, "claude-new");
    expect((await post(base, ADD, { tool: "claude", name: "Claude-new", configDir: config })).status).toBe(200);
    expect(existsSync(config)).toBe(true);

    const before = readFileSync(file, "utf-8");
    const aFile = join(parent, "a-file");
    writeFileSync(aFile, "x");
    const res = await post(base, ADD, { tool: "claude", name: "Claude-file", configDir: aFile });
    expect(res.status).toBe(400);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });
});

describe("what a provider's folders have to be", () => {
  test("a folder not written from / or ~/ and one another provider logs in under are refused (AC-1)", async () => {
    const { base, file } = serve();
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: "One", configDir: dir });
    const before = readFileSync(file, "utf-8");
    for (const body of [
      { tool: "claude", name: "Two", configDir: "relative/dir" } as Record<string, string>,
      { tool: "claude", name: "Two", configDir: dir },
      { tool: "claude", name: "Two", configDir: "~/.claude" },
    ]) {
      const res = await post(base, ADD, body);
      expect(res.status).toBe(400);
    }
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("a second OpenCode provider and a name taken in any case are refused (AC-1)", async () => {
    const { base } = serve();
    expect((await post(base, ADD, { tool: "opencode", name: "OpenCode" })).status).toBe(200);
    expect((await post(base, ADD, { tool: "opencode", name: "Another" })).status).toBe(400);
    expect((await post(base, ADD, { tool: "codex", name: "CLAUDE" })).status).toBe(400);
  });

  test("a shadow home with a sessions folder of its own is refused with the conflict sentence (AC-16)", async () => {
    const { base, file } = serve();
    const shared = folder();
    mkdirSync(join(shared, "sessions"));
    const shadow = folder();
    mkdirSync(join(shadow, "sessions"));
    const before = readFileSync(file, "utf-8");
    const res = await post(base, ADD, { tool: "codex", name: "Codex-a", codexHome: shared, shadowHome: shadow });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("has a sessions folder of its own");
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("a shadow home is prepared when it is saved, and two on one CODEX_HOME share its sessions (AC-16)", async () => {
    const { base } = serve();
    const shared = folder();
    mkdirSync(join(shared, "sessions"));
    const first = join(folder(), "a");
    const second = join(folder(), "b");
    expect((await post(base, ADD, { tool: "codex", name: "Codex-a", codexHome: shared, shadowHome: first })).status).toBe(200);
    expect((await post(base, ADD, { tool: "codex", name: "Codex-b", codexHome: shared, shadowHome: second })).status).toBe(200);
    expect(existsSync(join(first, "sessions"))).toBe(true);
    expect(existsSync(join(second, "sessions"))).toBe(true);
  });
});

describe("removing a provider something uses", () => {
  test("a phase default, a schedule entry and a queued job are named in one refusal, the provider still there (AC-6)", async () => {
    const schedules = `{ "schedules": { "aide": [{ "name": "nightly", "cron": "0 3 * * *", "prompt": "p.md", "provider": "Capra" }] } }\n`;
    const { base, file, queueDefaults } = serve({ provider: { implement: "Capra" } }, schedules);
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: "Capra", configDir: dir });
    const queued = await fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...JOB, provider: "Capra" }) });
    expect(queued.status).toBe(200);
    const before = readFileSync(file, "utf-8");

    const res = await post(base, REMOVE, { key: "Capra" });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error).toContain("the Implement default");
    expect(error).toContain("nightly");
    expect(error).toContain("Analyze");
    expect(readFileSync(file, "utf-8")).toBe(before);
    expect(queueDefaults.providers?.Capra).toBeDefined();
  });

  test("a provider only finished jobs used is removed from the file and from the live defaults (AC-6)", async () => {
    const { base, file, queueDefaults } = serve();
    await post(base, ADD, { tool: "opencode", name: "Open" });
    expect((await post(base, REMOVE, { key: "Open" })).status).toBe(200);
    expect(providersIn(file)?.Open).toBeUndefined();
    expect(queueDefaults.providers?.Open).toBeUndefined();
  });
});

describe("the pages that add and edit a provider", () => {
  test("the address of the old Add page leads to the Providers tab, where Add is a dialog", async () => {
    const { base } = serve();
    const res = await fetch(`${base}/settings/providers/new?tool=codex`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings?tab=providers");
  });

  test("Edit shows the name as a field beside the folders, with the tool shown and not asked (AC-9)", async () => {
    const { base } = serve();
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: "Capra", configDir: dir });
    const page = await (await fetch(`${base}/settings/providers/edit?key=Capra&aitab=config`)).text();
    const html = page.match(/<form id="provider-form"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(html).toContain('name="name" type="text" value="Capra"');
    expect(html).toContain(`value="${dir}"`);
    expect(html).toContain(EDIT);
    expect(html).toContain('name="key" value="Capra"');
    expect(html).not.toContain('name="tool"');
  });

  test("the name field does not stop an empty name in the browser, so the board's refusal reaches the form's line (AC-18)", async () => {
    const { base } = serve();
    const html = await (await fetch(`${base}/settings/providers/edit?key=Claude&aitab=config`)).text();
    const field = html.match(/<input id="provider-name"[^>]*>/)?.[0] ?? "";
    expect(field).toContain('name="name"');
    expect(field).not.toContain("required");
  });

  test("an unknown provider has no edit page (AC-4)", async () => {
    const { base } = serve();
    expect((await fetch(`${base}/settings/providers/edit?key=Nobody`)).status).toBe(404);
  });

  test("the address that edited a provider sends the reader to it on the Providers tab, its inner tab kept", async () => {
    const { base } = serve();
    const res = await fetch(`${base}/settings/providers/edit?key=Codex&aitab=installation`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings?tab=providers&provider=Codex&aitab=installation");
  });

  test("the Providers tab carries the four tabs of the chosen provider with Config open, and a named tab opens", async () => {
    const { base } = serve();
    const open = async (query: string) => {
      const html = await (await fetch(`${base}/settings?tab=providers&provider=Claude${query}`)).text();
      return [...html.matchAll(/<a [^>]*href="[^"]*aitab=(\w+)"([^>]*)>/g)].map((m) => ({ tab: m[1], current: m[2]!.includes("aria-current") }));
    };
    const tabs = ["config", "usage", "models", "installation"];
    expect(await open("")).toEqual(tabs.map((tab) => ({ tab, current: tab === "config" })));
    expect(await open("&aitab=installation")).toEqual(tabs.map((tab) => ({ tab, current: tab === "installation" })));
  });

  test("the Models and Installation tabs are read before the page answers, and a tab reads only its own", async () => {
    const asked: string[] = [];
    const { base } = serve({}, CONFIG, stubProbe, stubUsage, {
      check: async (tool) => { asked.push(`check:${tool}`); return { tool, at: "2026-11-05T09:00:00.000Z", found: true, lines: ["preflight says hello"], extra: [] }; },
      models: async (tool) => { asked.push(`models:${tool}`); return { tool, at: "2026-11-05T09:00:00.000Z", offered: [{ model: "opus-read-now" }] }; },
    });
    const page = (tab: string) => fetch(`${base}/settings?tab=providers&provider=Claude&aitab=${tab}`).then((r) => r.text());
    expect(await page("models")).toContain("opus-read-now");
    expect(asked).toEqual(["models:claude"]);
    expect(await page("installation")).toContain("preflight says hello");
    expect(asked).toEqual(["models:claude", "check:claude"]);
    await page("config");
    expect(asked).toEqual(["models:claude", "check:claude"]);
  });
});

describe("what a provider's page shows of its own folders", () => {
  const login = (command: string) => ({ question: "Is it logged in?", ok: false, detail: "", answer: { key: "login.out" as const, values: { command } } });
  const byKey: Probe = async (key, provider) => ({
    key, at: "2026-11-05T09:00:00.000Z", installed: true, version: `1.0 (${key})`,
    login: key === "Claude-2" ? login(`CLAUDE_CONFIG_DIR=${provider.configDir} claude auth login`) : undefined,
  });

  test("every provider's status is read before the tab answers, and the usage only on the Usage tab, before it answers", async () => {
    const asked: string[] = [];
    const probe: Probe = async (key, provider, opts) => { asked.push(`status:${key}`); return byKey(key, provider, opts); };
    const { base } = serve({}, CONFIG, probe, async (key, provider) => { asked.push(`usage:${key}`); return stubUsage(key, provider); });
    expect((await fetch(`${base}/settings/providers/edit?key=Codex`)).status).toBe(200);
    expect(asked.sort()).toEqual(["status:Claude", "status:Codex"]);
    expect(await (await fetch(`${base}/settings?tab=providers&provider=Codex&aitab=usage`)).text()).toContain("Window of Codex");
    expect(asked.filter((a) => a.startsWith("usage:"))).toEqual(["usage:Codex"]);
  });

  test("two providers of one tool each show their own login and usage and not the other's (AC-4)", async () => {
    const dir = folder();
    const { base } = serve({}, CONFIG, byKey);
    await post(base, ADD, { tool: "claude", name: "Claude-2", configDir: dir });
    const second = await (await fetch(`${base}/settings?tab=providers&provider=Claude-2&aitab=usage`)).text();
    const first = await (await fetch(`${base}/settings?tab=providers&provider=Claude&aitab=usage`)).text();
    expect(second).toContain("Window of Claude-2");
    expect(first).toContain("Window of Claude");
    expect(first).not.toContain("Window of Claude-2");
    expect(second).toContain(`CLAUDE_CONFIG_DIR=${dir} claude auth login`);
    expect(first).not.toContain(`CLAUDE_CONFIG_DIR=${dir} claude auth login`);
  });

  test("a provider that is not logged in says so, and shows the command that logs in with its own folder (AC-20, AC-21)", async () => {
    const dir = folder();
    const { base } = serve({}, CONFIG, byKey);
    await post(base, ADD, { tool: "claude", name: "Claude-2", configDir: dir });
    const page = await (await fetch(`${base}/settings/providers/edit?key=Claude-2&aitab=usage`, { redirect: "follow" })).text();
    expect(page).toContain("Not logged in");
    expect(page).toContain(`CLAUDE_CONFIG_DIR=${dir} claude auth login`);
  });
});

describe("reading every provider's status when Settings opens", () => {
  const counting = () => {
    const asked: string[] = [];
    return { asked, probe: async (key: string, provider: Provider) => { asked.push(key); return stubProbe(key, provider); } };
  };

  test("the Providers tab reads each provider once before it answers (AC-6)", async () => {
    const { asked, probe } = counting();
    const { base } = serve({}, CONFIG, probe);
    await (await fetch(`${base}/settings?tab=providers`)).text();
    expect(asked.sort()).toEqual(["Claude", "Codex"]);
  });

  test("a removed tool tab opens Providers and reads the statuses too, and no other tab reads anything (AC-2)", async () => {
    const { asked, probe } = counting();
    const { base } = serve({}, CONFIG, probe);
    await fetch(`${base}/settings`);
    await fetch(`${base}/settings?tab=process`);
    expect(asked).toEqual([]);
    for (const tab of ["claude", "codex", "copilot", "opencode"]) {
      const html = await (await fetch(`${base}/settings?tab=${tab}`)).text();
      expect(html).toContain("provider=Claude");
    }
    expect(asked).toHaveLength(8);
  });
});
