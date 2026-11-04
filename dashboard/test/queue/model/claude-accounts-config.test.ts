// The Claude accounts in `queue-config.json`: read at boot field by field,
// written one key at a time, a rename as one write.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { mergeQueueDefaults, persistQueueSettings, type QueueDefaults } from "../../../src/queue/queue.ts";

const BASE: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-claude-accounts-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reading the accounts", () => {
  test("a file without them leaves the defaults as they were (AC-1)", () => {
    const merged = mergeQueueDefaults(BASE, { modelChoices: { Opus: { model: "opus" } } });
    expect(merged.claudeAccounts).toBeUndefined();
    expect(merged.timeoutSec).toEqual(BASE.timeoutSec);
  });

  test("Default in any case, a bad name, an entry without a directory and a repeated directory are dropped (AC-1)", () => {
    const merged = mergeQueueDefaults(BASE, {
      claudeAccounts: {
        default: { configDir: "~/.claude-9" },
        "bad name": { configDir: "~/.claude-8" },
        NoDir: { note: "x" },
        Work: { configDir: "~/.claude-2" },
        Twin: { configDir: "~/.claude-2" },
        Spare: { configDir: "/opt/claude-3" },
      },
    });
    expect(merged.claudeAccounts).toEqual({ Work: { configDir: "~/.claude-2" }, Spare: { configDir: "/opt/claude-3" } });
  });
});

describe("writing the accounts", () => {
  const write = (text: string): string => {
    const file = join(dir, "queue-config.json");
    writeFileSync(file, text);
    return file;
  };
  const accountsIn = (file: string) => (parse(readFileSync(file, "utf-8")) as { claudeAccounts?: unknown }).claudeAccounts;

  test("an entry is added by its key, kept beside the rest of the file, and null removes it (AC-1)", () => {
    const file = write('{\n  // keep me\n  "modelChoices": { "Opus": { "model": "opus" } }\n}\n');
    expect(persistQueueSettings(file, { claudeAccounts: { Work: { configDir: "~/.claude-2" } } })).toBeNull();
    expect(accountsIn(file)).toEqual({ Work: { configDir: "~/.claude-2" } });
    expect(readFileSync(file, "utf-8")).toContain("// keep me");
    expect(persistQueueSettings(file, { claudeAccounts: { Work: null } })).toBeNull();
    expect(accountsIn(file)).toEqual({});
  });

  test("a rename is one write that removes the old key and adds the new (AC-1)", () => {
    const file = write('{ "claudeAccounts": { "Work": { "configDir": "~/.claude-2" } } }\n');
    expect(persistQueueSettings(file, { claudeAccounts: { Work: null, Spare: { configDir: "~/.claude-2" } } })).toBeNull();
    expect(accountsIn(file)).toEqual({ Spare: { configDir: "~/.claude-2" } });
  });
});
