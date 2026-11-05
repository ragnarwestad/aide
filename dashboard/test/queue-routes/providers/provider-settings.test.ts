// Adding, editing, renaming and removing a provider on Settings → AI →
// Providers, and the pages that add and edit one. The file is written first
// and the live providers changed after; a refusal changes neither.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import type { QueueDefaults } from "../../../src/queue/types.ts";
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
const RENAME = "/api/queue/settings/providers/rename";
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

function serve(extra: Partial<QueueDefaults> = {}, config = CONFIG) {
  const { file, modelIdsPath } = ownFiles(config, ownDirs);
  const queueDefaults = {
    ...defaultsOf({ Opus: {}, "gpt-6": { tool: "codex" } }, { default: "Opus" }),
    providers: { Claude: { name: "Claude", tool: "claude" }, Codex: { name: "Codex", tool: "codex" } },
    provider: { default: "Claude" },
    ...extra,
  } as QueueDefaults;
  const { base } = start({ queueDefaults, queueConfigFile: file, modelIdsPath });
  return { base, file, queueDefaults };
}

const providersIn = (file: string) => (parse(readFileSync(file, "utf-8")) as { providers?: Record<string, unknown> }).providers;
const errorOf = async (res: Response): Promise<string> => ((await res.json()) as { error: string }).error;

describe("adding, editing, renaming and removing a provider", () => {
  test("each writes the file and keeps the rest of it, and the live providers follow (AC-1)", async () => {
    const { base, file, queueDefaults } = serve();
    const dir = folder();
    expect((await post(base, ADD, { tool: "claude", name: "Claude-Capra", configDir: dir })).status).toBe(200);
    expect(providersIn(file)?.["Claude-Capra"]).toEqual({ name: "Claude-Capra", tool: "claude", configDir: dir });
    expect(queueDefaults.providers?.["Claude-Capra"]?.configDir).toBe(dir);
    expect(readFileSync(file, "utf-8")).toContain("// the operator's own note");

    const other = folder();
    expect((await post(base, EDIT, { key: "Claude-Capra", configDir: other })).status).toBe(200);
    expect(queueDefaults.providers?.["Claude-Capra"]).toEqual({ name: "Claude-Capra", tool: "claude", configDir: other });

    expect((await post(base, RENAME, { key: "Claude-Capra", newName: "Capra" })).status).toBe(200);
    expect(providersIn(file)?.["Claude-Capra"]).toEqual({ name: "Capra", tool: "claude", configDir: other });
    expect(queueDefaults.providers?.["Claude-Capra"]?.name).toBe("Capra");

    expect((await post(base, REMOVE, { key: "Claude-Capra" })).status).toBe(200);
    expect(providersIn(file)?.["Claude-Capra"]).toBeUndefined();
    expect(queueDefaults.providers?.["Claude-Capra"]).toBeUndefined();
  });

  test("a key never changes: a name added after a renamed one gets its own key (AC-1)", async () => {
    const { base, queueDefaults } = serve();
    await post(base, ADD, { tool: "claude", name: "Capra", configDir: folder() });
    await post(base, RENAME, { key: "Capra", newName: "Other" });
    await post(base, ADD, { tool: "claude", name: "Capra", configDir: folder() });
    expect(Object.keys(queueDefaults.providers!)).toEqual(["Claude", "Codex", "Capra", "Capra-2"]);
    expect(queueDefaults.providers?.Capra?.name).toBe("Other");
  });

  test("a key made for a taken 64-character name stays within 64 characters (AC-2)", async () => {
    const { base, queueDefaults } = serve();
    const long = "x".repeat(64);
    await post(base, ADD, { tool: "claude", name: long, configDir: folder() });
    await post(base, RENAME, { key: long, newName: "Other" });
    expect((await post(base, ADD, { tool: "claude", name: long, configDir: folder() })).status).toBe(200);
    const keys = Object.keys(queueDefaults.providers!);
    expect(keys.every((k) => k.length <= 64)).toBe(true);
    expect(keys).toHaveLength(4);
  });

  test("a name with a character a provider cannot have is refused with the sentence, the file as it was (AC-2)", async () => {
    const { base, file } = serve();
    const before = readFileSync(file, "utf-8");
    for (const name of ["bad name", "a/b", "x".repeat(65)]) {
      const res = await post(base, ADD, { tool: "opencode", name });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain(`up to 64 letters, digits, ".", "_" or "-"`);
    }
    expect((await post(base, RENAME, { key: "Claude", newName: "no good" })).status).toBe(400);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("the provider the board has always used is renamed, then removed once nothing uses it, like any other (AC-5)", async () => {
    const { base, queueDefaults } = serve({ provider: { default: "Codex" } });
    expect((await post(base, RENAME, { key: "Claude", newName: "Default" })).status).toBe(200);
    expect(queueDefaults.providers?.Claude?.name).toBe("Default");
    expect((await post(base, REMOVE, { key: "Claude" })).status).toBe(200);
    expect(queueDefaults.providers?.Claude).toBeUndefined();
  });
});

describe("what a provider's folders have to be", () => {
  test("a folder not written from / or ~/, one that is not there, and one another provider logs in under are refused (AC-1)", async () => {
    const { base, file } = serve();
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: "One", configDir: dir });
    const before = readFileSync(file, "utf-8");
    for (const body of [
      { tool: "claude", name: "Two", configDir: "relative/dir" } as Record<string, string>,
      { tool: "claude", name: "Two", configDir: "/no/such/dir/anywhere" },
      { tool: "claude", name: "Two", configDir: dir },
      { tool: "claude", name: "Two", configDir: "~/.claude" },
      { tool: "codex", name: "Two", codexHome: "/no/such/dir/anywhere" },
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
    const { base, file, queueDefaults } = serve({ provider: { default: "Claude", implement: "Capra" } }, schedules);
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
  test("Add asks for the tool first and shows no field; a chosen tool shows only its own (AC-4)", async () => {
    const { base } = serve();
    const first = await (await fetch(`${base}/settings/providers/new`)).text();
    for (const tool of ["claude", "codex", "opencode"]) expect(first).toContain(`/settings/providers/new?tool=${tool}`);
    expect(first).not.toContain('name="name"');

    const codex = await (await fetch(`${base}/settings/providers/new?tool=codex`)).text();
    for (const field of ["name", "codexHome", "shadowHome"]) expect(codex).toContain(`name="${field}"`);
    expect(codex).not.toContain('name="configDir"');
    expect(codex).toContain(ADD);

    const open = await (await fetch(`${base}/settings/providers/new?tool=opencode`)).text();
    expect(open).toContain('name="name"');
    expect(open).not.toContain('name="configDir"');
    expect(open).not.toContain('name="codexHome"');
  });

  test("Edit shows the form filled in, with the tool shown and not asked (AC-4)", async () => {
    const { base } = serve();
    const dir = folder();
    await post(base, ADD, { tool: "claude", name: "Capra", configDir: dir });
    const html = await (await fetch(`${base}/settings/providers/edit?key=Capra`)).text();
    expect(html).toContain(`value="${dir}"`);
    expect(html).toContain(EDIT);
    expect(html).toContain('name="key" value="Capra"');
    expect(html).not.toContain('name="tool"');
  });

  test("an unknown provider has no edit page (AC-4)", async () => {
    const { base } = serve();
    expect((await fetch(`${base}/settings/providers/edit?key=Nobody`)).status).toBe(404);
  });

  test("the Providers tab lists every provider with Edit, Rename and Remove, and Add (AC-3)", async () => {
    const { base } = serve();
    const html = await (await fetch(`${base}/settings?tab=providers`)).text();
    for (const key of ["Claude", "Codex"]) {
      expect(html).toContain(`/settings/providers/edit?key=${key}`);
      expect(html).toContain(`name="key" value="${key}"`);
    }
    expect(html).toContain(RENAME);
    expect(html).toContain(REMOVE);
    expect(html).toContain("/settings/providers/new");
  });
});
