// Which Claude logins a stopped step may be moved to, the key a login is
// held under, and how `~/…` is read. All three are pure.

import { describe, expect, test } from "bun:test";
import { expandConfigDir, holdKey, runOnAccounts } from "../../../../src/queue/runner/claude-accounts.ts";
import type { Job } from "../../../../src/queue/queue.ts";

const HOME = "/home/ragnar";
const ACCOUNTS = { Work: { configDir: "~/.claude-2" }, Spare: { configDir: "/opt/claude-3" } };

const stoppedOnLimit = (over: Record<string, unknown> = {}): Job =>
  ({ id: "j", state: "stopped", stopReason: "provider-limit", ...over }) as unknown as Job;

describe("which accounts a stopped step may be moved to", () => {
  test("every account but its own, the default included once it is on another (AC-2)", () => {
    expect(runOnAccounts(stoppedOnLimit(), "claude", ACCOUNTS, HOME)).toEqual(["Work", "Spare"]);
    const onWork = stoppedOnLimit({ claudeAccount: { name: "Work", configDir: "/home/ragnar/.claude-2" } });
    expect(runOnAccounts(onWork, "claude", ACCOUNTS, HOME)).toEqual(["Default", "Spare"]);
  });

  test("nothing unless the job stopped on a usage limit on a Claude step (AC-2)", () => {
    for (const job of [
      stoppedOnLimit({ stopReason: "cap" }),
      stoppedOnLimit({ state: "queued" }),
      stoppedOnLimit({ state: "running" }),
    ]) {
      expect(runOnAccounts(job, "claude", ACCOUNTS, HOME)).toEqual([]);
    }
    expect(runOnAccounts(stoppedOnLimit(), "codex", ACCOUNTS, HOME)).toEqual([]);
  });

  test("nothing when no other account is configured (AC-9)", () => {
    expect(runOnAccounts(stoppedOnLimit(), "claude", undefined, HOME)).toEqual([]);
    expect(runOnAccounts(stoppedOnLimit(), "claude", {}, HOME)).toEqual([]);
  });

  test("an account whose directory is the job's own is not offered, however it is written (AC-2)", () => {
    const onWork = stoppedOnLimit({ claudeAccount: { name: "Old name", configDir: "/home/ragnar/.claude-2" } });
    expect(runOnAccounts(onWork, "claude", { Work: { configDir: "~/.claude-2" } }, HOME)).toEqual(["Default"]);
  });
});

describe("the key a login is held under", () => {
  test("the AI alone, unless a Claude step of a job on another account (AC-4)", () => {
    expect(holdKey({} as Job, "claude")).toBe("claude");
    expect(holdKey({} as Job, "codex")).toBe("codex");
    const onWork = { claudeAccount: { name: "Work", configDir: "/home/ragnar/.claude-2" } } as Job;
    expect(holdKey(onWork, "claude")).toBe("claude:/home/ragnar/.claude-2");
    expect(holdKey(onWork, "codex")).toBe("codex");
  });
});

describe("a configuration directory", () => {
  test("~ is read against the home directory, anything else is kept", () => {
    expect(expandConfigDir("~/.claude-2", HOME)).toBe("/home/ragnar/.claude-2");
    expect(expandConfigDir("~", HOME)).toBe(HOME);
    expect(expandConfigDir("/opt/claude-3", HOME)).toBe("/opt/claude-3");
  });
});
