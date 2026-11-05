// The one-time conversion from tools and Claude accounts to providers: a pure
// function from what is stored to what replaces it.

import { describe, expect, test } from "bun:test";
import { convertToProviders } from "../../../src/queue/providers/convert.ts";
import { resolveStepProvider } from "../../../src/queue/providers/index.ts";
import type { Job, QueueDefaults } from "../../../src/queue/types.ts";

const HOME = "/home/ragnar";
const defaults = (extra: Partial<QueueDefaults> = {}): QueueDefaults =>
  ({
    timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
    model: { default: "Opus", implement: "gpt-6" },
    modelChoices: { Opus: {}, "gpt-6": { tool: "codex" }, Scripted: { tool: "fake-claude" } },
    ...extra,
  }) as QueueDefaults;

const job = (extra: Record<string, unknown> = {}): Job =>
  ({
    id: "j", project: "aide", specFolder: "703-x", steps: ["analyze", "implement"], stepIndex: 0, state: "queued",
    model: {}, timeoutSec: {}, permissionMode: {}, createdAt: "", results: [], spentUsd: 0, ...extra,
  }) as unknown as Job;

const ACCOUNTS = { Work: { configDir: "~/.claude-2" }, Spare: { configDir: "/opt/claude-3" } };
const convert = (jobs: Job[], d = defaults(), schedules = {}, claudeAccounts: Record<string, { configDir: string }> = ACCOUNTS) =>
  convertToProviders({ defaults: d, claudeAccounts, jobs, schedules, home: HOME });

describe("convertToProviders", () => {
  test("makes a provider for each tool and one for each Claude account, with the account's name and folder (AC-7)", () => {
    const { providers } = convert([]);
    expect(providers).toEqual({
      Claude: { name: "Claude", tool: "claude" },
      Codex: { name: "Codex", tool: "codex" },
      OpenCode: { name: "OpenCode", tool: "opencode" },
      Work: { name: "Work", tool: "claude", configDir: "~/.claude-2" },
      Spare: { name: "Spare", tool: "claude", configDir: "/opt/claude-3" },
    });
  });

  test("an account named like a tool keeps its name and the tool's provider takes the next free one (AC-7)", () => {
    const { providers } = convert([], defaults(), {}, { Claude: { configDir: "~/.claude-2" } });
    expect(providers["Claude"]).toEqual({ name: "Claude", tool: "claude", configDir: "~/.claude-2" });
    expect(providers["Claude-2"]).toEqual({ name: "Claude-2", tool: "claude" });
  });

  test("each phase default points at the tool provider of its model's tool, a stand-in at Claude's, and no `default` is written (AC-7, AC-23)", () => {
    const { provider } = convert([], defaults({ model: { default: "Opus", implement: "gpt-6", review: "Scripted" } }));
    expect(provider).toEqual({ implement: "Codex", review: "Claude" });
  });

  test("a schedule entry that names a model gets its tool's provider, one that names none is left alone (AC-8)", () => {
    const entry = { name: "n", cron: "0 3 * * *", prompt: "p.md", enabled: true };
    const { schedules } = convert([], defaults(), { aide: [{ ...entry, model: "gpt-6" }, entry] });
    expect(schedules.aide).toEqual([{ ...entry, model: "gpt-6", provider: "Codex" }, entry]);
  });

  test("every job's steps name a provider: the account's for a job moved to it, else the tool's; the legacy fields go (AC-7, AC-8)", () => {
    const moved = job({
      claudeAccount: { name: "Work", configDir: `${HOME}/.claude-2` },
      usageLimitLeft: { hold: "claude:x", until: "", resetKnown: true, since: "" },
      usageLimitLeftBefore: [],
    });
    const plain = job({ id: "p" });
    const { jobs } = convert([moved, plain]);
    expect(jobs[0]!.provider).toEqual({ analyze: "Work", implement: "Codex" });
    expect(jobs[1]!.provider).toEqual({ analyze: "Claude", implement: "Codex" });
    for (const j of jobs) {
      expect(j).not.toHaveProperty("claudeAccount");
      expect(j).not.toHaveProperty("usageLimitLeft");
      expect(j).not.toHaveProperty("usageLimitLeftBefore");
    }
  });

  test("each result that ran on an AI names its provider, one that ran none does not (AC-7)", () => {
    const j = job({
      state: "done",
      claudeAccount: { name: "Work", configDir: `${HOME}/.claude-2` },
      results: [
        { step: "analyze", ok: true, tool: "claude", claudeAccount: "Work" },
        { step: "implement", ok: true, tool: "codex" },
        { step: "create", ok: true, tool: "none" },
        { step: "archive", ok: true, tool: "claude", claudeAccount: "Gone" },
      ],
    });
    const { jobs } = convert([j]);
    const results = jobs[0]!.results as unknown as Record<string, unknown>[];
    expect(results.map((r) => r.provider)).toEqual([
      { key: "Work", name: "Work" }, { key: "Codex", name: "Codex" }, undefined, { key: "Gone", name: "Gone" },
    ]);
    expect(results.every((r) => !("claudeAccount" in r))).toBe(true);
  });

  test("every converted phase default, schedule entry and job resolves to the login it ran on before (AC-8)", () => {
    const d = defaults();
    const converted = convert([job({ claudeAccount: { name: "Work", configDir: `${HOME}/.claude-2` } }), job({ id: "p" })], d);
    const after = { ...d, providers: converted.providers, provider: converted.provider };
    const folderOf = (key: string | undefined) => (key ? converted.providers[key]?.configDir : undefined);
    expect(folderOf(resolveStepProvider(job(), "analyze", after))).toBeUndefined();
    expect(resolveStepProvider(job(), "implement", after)).toBe("Codex");
    expect(folderOf(resolveStepProvider(converted.jobs[0]!, "analyze", after))).toBe("~/.claude-2");
    expect(folderOf(resolveStepProvider(converted.jobs[1]!, "analyze", after))).toBeUndefined();
  });

  test("a job that will still run on an account no longer configured gets a provider of its own; a finished one does not (AC-8)", () => {
    const gone = { name: "Old", configDir: "/opt/old" };
    const queued = job({ claudeAccount: gone });
    const finished = job({ id: "f", state: "done", claudeAccount: gone });
    const { providers, jobs } = convert([queued, finished]);
    expect(providers["Old"]).toEqual({ name: "Old", tool: "claude", configDir: "/opt/old" });
    expect(jobs[0]!.provider?.analyze).toBe("Old");
    expect(Object.keys(providers).filter((k) => k.startsWith("Old"))).toEqual(["Old"]);
    expect(jobs[1]!.provider?.analyze).toBe("Claude");
  });

  test("converting again keeps the providers a job already carries and makes the same providers (AC-7)", () => {
    const once = convert([job({ claudeAccount: { name: "Work", configDir: `${HOME}/.claude-2` } })]);
    const again = convert(once.jobs);
    expect(again.providers).toEqual(once.providers);
    expect(again.jobs[0]!.provider).toEqual(once.jobs[0]!.provider);
  });
});
