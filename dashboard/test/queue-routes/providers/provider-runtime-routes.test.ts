// What Settings → Providers saves beyond the name and the folders: the ID a
// provider is stored under, its binary path, Claude Code's auto-compact
// threshold, and the on/off switch.

import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import type { Provider } from "../../../src/queue/providers/index.ts";
import type { QueueDefaults } from "../../../src/queue/types.ts";
import type { ProviderStatus } from "../../../src/render";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { defaultsOf, ownFiles, post } from "../settings-models/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-provider-runtime-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length)
    rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const ADD = "/api/queue/settings/providers/add";
const EDIT = "/api/queue/settings/providers/edit";
const SWITCH = "/api/queue/settings/providers/switch";

const stubProbe = async (key: string): Promise<ProviderStatus> => ({
  key,
  at: "2026-11-06T09:00:00.000Z",
  installed: true,
});

function serve() {
  const { file, modelIdsPath } = ownFiles(
    `{ "model": { "default": "Opus" } }\n`,
    ownDirs,
  );
  const queueDefaults = {
    ...defaultsOf(
      { Opus: {}, "gpt-6": { tool: "codex" } },
      { default: "Opus" },
    ),
    providers: {
      Claude: { name: "Claude", tool: "claude" },
      Codex: { name: "Codex", tool: "codex" },
    },
  } as QueueDefaults;
  const { base } = start({
    queueDefaults,
    queueConfigFile: file,
    modelIdsPath,
    providerProbe: stubProbe,
  });
  return { base, file, queueDefaults };
}

/** An executable file of the test's own, standing in for a tool's program. */
function program(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-provider-bin-"));
  ownDirs.push(dir);
  const path = join(dir, "claude-next");
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

const providersIn = (file: string) =>
  (
    parse(readFileSync(file, "utf-8")) as {
      providers?: Record<string, Provider>;
    }
  ).providers;
const errorOf = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: string }).error;

describe("the ID a provider is stored under", () => {
  test("Add stores it under the ID given, and the name may have spaces", async () => {
    const { base, queueDefaults } = serve();
    const res = await post(base, ADD, {
      tool: "opencode",
      name: "Open Code (work)",
      providerId: "opencode_work",
    });
    expect(res.status).toBe(200);
    expect(queueDefaults.providers?.opencode_work?.name).toBe(
      "Open Code (work)",
    );
  });

  test("with no ID given, one is made from the name", async () => {
    const { base, queueDefaults } = serve();
    await post(base, ADD, { tool: "opencode", name: "Open Code (work)" });
    expect(queueDefaults.providers?.["open-code-work"]?.name).toBe(
      "Open Code (work)",
    );
  });

  test("an ID with another character, or one another provider has, is refused and nothing is written", async () => {
    const { base, file } = serve();
    const before = readFileSync(file, "utf-8");
    for (const id of ["two words", "a.b", "x".repeat(65), "claude"]) {
      expect(
        (
          await post(base, ADD, {
            tool: "opencode",
            name: "Mine",
            providerId: id,
          })
        ).status,
      ).toBe(400);
    }
    expect(readFileSync(file, "utf-8")).toBe(before);
  });
});

describe("a binary path", () => {
  test("is saved on Add and on Edit, and an empty one removes it", async () => {
    const { base, file, queueDefaults } = serve();
    const bin = program();
    expect(
      (await post(base, EDIT, { key: "Claude", name: "Claude", binary: bin }))
        .status,
    ).toBe(200);
    expect(providersIn(file)?.Claude?.binary).toBe(bin);
    expect(
      (await post(base, EDIT, { key: "Claude", name: "Claude", binary: "" }))
        .status,
    ).toBe(200);
    expect(queueDefaults.providers?.Claude?.binary).toBeUndefined();
  });

  test("a path not written from / or ~/, a folder and a file that is not there are refused", async () => {
    const { base, file } = serve();
    const before = readFileSync(file, "utf-8");
    const folder = mkdtempSync(join(tmpdir(), "aide-provider-binfolder-"));
    ownDirs.push(folder);
    mkdirSync(join(folder, "sub"));
    for (const binary of ["bin/claude", folder, join(folder, "missing")]) {
      const res = await post(base, EDIT, {
        key: "Claude",
        name: "Claude",
        binary,
      });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain(binary);
    }
    expect(readFileSync(file, "utf-8")).toBe(before);
  });
});

describe("auto-compact", () => {
  test("a Claude Code provider saves a number of tokens, and an empty field removes it", async () => {
    const { base, queueDefaults } = serve();
    expect(
      (
        await post(base, EDIT, {
          key: "Claude",
          name: "Claude",
          autoCompact: "200000",
        })
      ).status,
    ).toBe(200);
    expect(queueDefaults.providers?.Claude?.autoCompact).toBe(200000);
    expect(
      (
        await post(base, EDIT, {
          key: "Claude",
          name: "Claude",
          autoCompact: "",
        })
      ).status,
    ).toBe(200);
    expect(queueDefaults.providers?.Claude?.autoCompact).toBeUndefined();
  });

  test("a number outside 100000 to 1000000, or no number, is refused", async () => {
    const { base, queueDefaults } = serve();
    for (const autoCompact of ["99999", "1000001", "lots"]) {
      expect(
        (await post(base, EDIT, { key: "Claude", name: "Claude", autoCompact }))
          .status,
      ).toBe(400);
    }
    expect(queueDefaults.providers?.Claude?.autoCompact).toBeUndefined();
  });
});

describe("the on/off switch", () => {
  test("off is written as enabled: false, on removes it, and an Edit keeps what the switch says", async () => {
    const { base, file, queueDefaults } = serve();
    expect(
      (await post(base, SWITCH, { key: "Codex", enabled: "false" })).status,
    ).toBe(200);
    expect(providersIn(file)?.Codex).toEqual({
      name: "Codex",
      tool: "codex",
      enabled: false,
    });
    await post(base, EDIT, { key: "Codex", name: "Codex 2" });
    expect(queueDefaults.providers?.Codex?.enabled).toBe(false);
    expect(
      (await post(base, SWITCH, { key: "Codex", enabled: "true" })).status,
    ).toBe(200);
    expect(providersIn(file)?.Codex).toEqual({
      name: "Codex 2",
      tool: "codex",
    });
  });

  test("an unknown provider is refused", async () => {
    const { base } = serve();
    expect(
      (await post(base, SWITCH, { key: "Gone", enabled: "false" })).status,
    ).toBe(400);
  });
});
