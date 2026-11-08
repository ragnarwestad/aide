// The providers in `queue-config.json`: read at boot field by field, written
// one key at a time, a rename as one write of the name.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import {
  mergeQueueDefaults,
  persistQueueSettings,
  type QueueDefaults,
} from "../../../src/queue/queue.ts";
import { QUEUE_DEFAULTS } from "../../../src/serve/serve-helpers";

const BASE: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-providers-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (text: string): string => {
  const file = join(dir, "queue-config.json");
  writeFileSync(file, text);
  return file;
};

describe("reading the providers", () => {
  test("a Claude Code, a Codex with a shadow home and an OpenCode provider keep their fields and nothing else (AC-1)", () => {
    const merged = mergeQueueDefaults(BASE, {
      providers: {
        Capra: {
          name: "Claude-Capra",
          tool: "claude",
          configDir: "~/.claude-capra",
          note: "x",
        },
        Personal: {
          name: "Codex-personal",
          tool: "codex",
          codexHome: "~/.codex-main",
          shadowHome: "~/.codex-p",
          configDir: "~/nope",
        },
        Oc: { name: "OpenCode", tool: "opencode", configDir: "~/nope" },
      },
    });
    expect(merged.providers).toEqual({
      Capra: {
        name: "Claude-Capra",
        tool: "claude",
        configDir: "~/.claude-capra",
      },
      Personal: {
        name: "Codex-personal",
        tool: "codex",
        codexHome: "~/.codex-main",
        shadowHome: "~/.codex-p",
      },
      Oc: { name: "OpenCode", tool: "opencode" },
    });
  });

  test("a bad key, a bad name, a name another entry has in any case, an unknown tool and a wrong field type are dropped (AC-1)", () => {
    const merged = mergeQueueDefaults(BASE, {
      providers: {
        "bad key": { name: "A", tool: "claude" },
        BadName: { name: "two\nlines", tool: "claude" },
        One: { name: "Same", tool: "claude" },
        Two: { name: "same", tool: "claude" },
        Odd: { name: "Odd", tool: "gemini" },
        Typed: { name: "Typed", tool: "claude", configDir: 7 },
        Nameless: { tool: "claude" },
      },
    });
    expect(Object.keys(merged.providers ?? {})).toEqual(["One"]);
  });

  test("no valid entry keeps the built-in providers, and a provider called Default is an ordinary one (AC-5)", () => {
    const withBuiltIn = mergeQueueDefaults(QUEUE_DEFAULTS, {
      providers: { x: { tool: "nope" } },
    });
    expect(Object.keys(withBuiltIn.providers ?? {})).toEqual([
      "Claude",
      "Codex",
      "OpenCode",
    ]);
    const merged = mergeQueueDefaults(BASE, {
      providers: { Default: { name: "Default", tool: "claude" } },
    });
    expect(merged.providers).toEqual({
      Default: { name: "Default", tool: "claude" },
    });
  });

  test("the phase defaults per step are read like the models, strings only, and a `default` entry is left out (AC-23)", () => {
    const merged = mergeQueueDefaults(BASE, {
      provider: { default: "Claude", implement: "Codex", analyze: 3 },
    });
    expect(merged.provider).toEqual({ implement: "Codex" });
  });

  test("the board's built-in defaults carry a provider for each tool and no phase default (AC-23)", () => {
    expect(
      Object.values(QUEUE_DEFAULTS.providers ?? {}).map((p) => p.tool),
    ).toEqual(["claude", "codex", "opencode"]);
    expect(QUEUE_DEFAULTS.provider).toBeUndefined();
  });

  test("a providers table with no entry stays empty, and one whose entries are all invalid keeps the built-in three (AC-22)", () => {
    expect(
      mergeQueueDefaults(QUEUE_DEFAULTS, { providers: {} }).providers,
    ).toBeUndefined();
    expect(
      Object.keys(
        mergeQueueDefaults(QUEUE_DEFAULTS, {
          providers: { x: { tool: "nope" } },
        }).providers ?? {},
      ),
    ).toEqual(["Claude", "Codex", "OpenCode"]);
    expect(
      Object.keys(mergeQueueDefaults(QUEUE_DEFAULTS, {}).providers ?? {}),
    ).toEqual(["Claude", "Codex", "OpenCode"]);
  });
});

describe("writing the providers", () => {
  const providersIn = (file: string) =>
    (parse(readFileSync(file, "utf-8")) as { providers?: unknown }).providers;

  test("an entry is written by its key beside the rest of the file, and null removes it (AC-1)", () => {
    const file = write(
      '{\n  // keep me\n  "model": { "default": "Opus" }\n}\n',
    );
    const entry = {
      name: "Codex-a",
      tool: "codex" as const,
      codexHome: "~/.codex-shared",
      shadowHome: "~/.codex-a",
    };
    expect(
      persistQueueSettings(file, { providers: { "Codex-a": entry } }),
    ).toBeNull();
    expect(providersIn(file)).toEqual({ "Codex-a": entry });
    expect(readFileSync(file, "utf-8")).toContain("// keep me");
    expect(
      persistQueueSettings(file, { providers: { "Codex-a": null } }),
    ).toBeNull();
    expect(providersIn(file)).toEqual({});
  });

  test("a rename writes the name alone and keeps the key (AC-1)", () => {
    const file = write(
      '{ "providers": { "Work": { "name": "Work", "tool": "claude", "configDir": "~/.claude-2" } } }\n',
    );
    expect(
      persistQueueSettings(file, {
        providers: {
          Work: { name: "Capra", tool: "claude", configDir: "~/.claude-2" },
        },
      }),
    ).toBeNull();
    expect(providersIn(file)).toEqual({
      Work: { name: "Capra", tool: "claude", configDir: "~/.claude-2" },
    });
  });

  test("a phase default is removed with null, the others kept (AC-23)", () => {
    const file = write(
      '{ "provider": { "default": "Claude", "implement": "Codex" } }\n',
    );
    expect(
      persistQueueSettings(file, { provider: { default: null } }),
    ).toBeNull();
    expect(
      (parse(readFileSync(file, "utf-8")) as { provider?: unknown }).provider,
    ).toEqual({ implement: "Codex" });
  });

  test("the phase default of a step is written under provider (AC-1)", () => {
    const file = write("{}\n");
    expect(
      persistQueueSettings(file, { provider: { implement: "Codex" } }),
    ).toBeNull();
    expect(
      (parse(readFileSync(file, "utf-8")) as { provider?: unknown }).provider,
    ).toEqual({ implement: "Codex" });
  });
});
