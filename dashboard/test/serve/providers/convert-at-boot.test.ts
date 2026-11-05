// The conversion applied to the board's own files: the queue config, the
// schedules in it and the mirror of the queue.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { convertProvidersAtBoot } from "../../../src/serve/providers/convert-at-boot.ts";
import { QUEUE_DEFAULTS } from "../../../src/serve/serve-helpers/config.ts";
import type { ServerOptions } from "../../../src/serve/options.ts";

const HOME = "/home/ragnar";
let dir: string;
let config: string;
let mirror: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "convert-at-boot-"));
  config = join(dir, "queue-config.json");
  mirror = join(dir, "queue.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const OLD_CONFIG = {
  model: { default: "Opus", implement: "gpt-6" },
  modelChoices: { Opus: {}, "gpt-6": { tool: "codex" } },
  claudeAccounts: { Work: { configDir: "~/.claude-2" }, Spare: { configDir: "/opt/claude-3" } },
  schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "p.md", model: "Opus" }] },
};
const job = (id: string, extra: Record<string, unknown> = {}) => ({
  id, project: "aide", specFolder: "703-x", steps: ["analyze", "implement"], state: "queued", stepIndex: 0,
  model: {}, timeoutSec: {}, permissionMode: {}, createdAt: "2026-11-05T08:00:00Z", results: [], spentUsd: 0, ...extra,
});
const options = (): ServerOptions => ({ queueConfigFile: config, queueMirrorPath: mirror } as ServerOptions);
const readConfig = () => JSON.parse(readFileSync(config, "utf-8")) as Record<string, any>;
const readMirror = () => JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, any>[];

describe("convertProvidersAtBoot", () => {
  test("a config with no providers is rewritten, its schedules, jobs and results with it, and the live defaults follow (AC-7)", () => {
    writeFileSync(config, JSON.stringify(OLD_CONFIG, null, 2));
    writeFileSync(mirror, JSON.stringify([
      job("moved", { claudeAccount: { name: "Work", configDir: `${HOME}/.claude-2` }, usageLimitLeft: { hold: "h", until: "", resetKnown: true, since: "" } }),
      job("done", { state: "done", results: [{ step: "implement", ok: true, tool: "codex" }] }),
    ]));
    const opts = options();

    convertProvidersAtBoot(opts, HOME);

    const written = readConfig();
    expect(Object.keys(written.providers)).toEqual(["Claude", "Codex", "OpenCode", "Work", "Spare"]);
    expect(written.provider).toEqual({ default: "Claude", implement: "Codex" });
    expect(written).not.toHaveProperty("claudeAccounts");
    expect(written.schedules.aide[0].provider).toBe("Claude");
    const [moved, done] = readMirror();
    expect(moved!.provider).toEqual({ analyze: "Work", implement: "Codex" });
    expect(moved).not.toHaveProperty("claudeAccount");
    expect(moved).not.toHaveProperty("usageLimitLeft");
    expect(done!.results[0].provider).toEqual({ key: "Codex", name: "Codex" });
    expect(Object.keys(opts.queueDefaults!.providers!)).toEqual(["Claude", "Codex", "OpenCode", "Work", "Spare"]);
  });

  test("a config that already has providers is left alone, written or not (AC-7)", () => {
    const source = JSON.stringify({ ...OLD_CONFIG, providers: { Mine: { name: "Mine", tool: "claude" } } }, null, 2);
    writeFileSync(config, source);
    writeFileSync(mirror, JSON.stringify([job("q", { claudeAccount: { name: "Work", configDir: `${HOME}/.claude-2` } })]));
    const before = readFileSync(mirror, "utf-8");
    const opts = options();

    convertProvidersAtBoot(opts, HOME);

    expect(readFileSync(config, "utf-8")).toBe(source);
    expect(readFileSync(mirror, "utf-8")).toBe(before);
    expect(opts.queueDefaults).toBeUndefined();
  });

  test("a board started with no config file converts nothing, and makes none", () => {
    const opts = options();
    convertProvidersAtBoot(opts, HOME);
    expect(existsSync(config)).toBe(false);
    expect(existsSync(mirror)).toBe(false);
  });

  test("a start with no mirror still converts the config", () => {
    writeFileSync(config, JSON.stringify(OLD_CONFIG, null, 2));
    convertProvidersAtBoot(options(), HOME);
    expect(Object.keys(readConfig().providers)).toContain("Work");
    expect(existsSync(mirror)).toBe(false);
  });

  test("built-in defaults carry providers, so the check reads the file and not the merged defaults", () => {
    expect(QUEUE_DEFAULTS.providers).toBeDefined();
  });
});
