// What a provider's row on Settings → AI → Providers says about its tool
// and its login. The decision is made by one function, so it is proven there,
// in one language.

import { describe, expect, test } from "bun:test";
import { providerLoginState, providerRows, providerStatusLines, type ProviderStatus } from "../../../src/render/pages/settings-page/providers.ts";
import type { ExtraCheck } from "../../../src/render/pages/settings-page/tools.ts";
import type { Provider } from "../../../src/queue/providers/index.ts";

const CLAUDE: Provider = { name: "Claude-2", tool: "claude", configDir: "~/.claude-2" };

const login = (over: Partial<ExtraCheck>): ExtraCheck => ({ question: "Is it logged in?", ok: true, detail: "", ...over });
const status = (over: Partial<ProviderStatus> = {}): ProviderStatus => ({
  key: "Claude-2", at: "2026-11-05T09:00:00.000Z", installed: true, version: "2.1.318 (Claude Code)", ...over,
});
const said = (s: ProviderStatus, provider: Provider = CLAUDE): string => providerStatusLines(s, provider, "en").join("\n");

describe("what a provider's row says", () => {
  test("an installed tool is shown with the version as printed (AC-1)", () => {
    expect(providerStatusLines(status(), CLAUDE, "en")[0]).toBe("Installed, version 2.1.318 (Claude Code)");
  });

  test("a tool that is not installed says so, and says nothing of a login (AC-1)", () => {
    const lines = providerStatusLines(status({ installed: false, version: undefined }), CLAUDE, "en");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not installed");
    expect(lines[0]).toContain("Claude Code");
  });

  test("a login with a method and an account says both (AC-2)", () => {
    const answer = { key: "login.inWithAs", values: { method: "claude.ai", account: "a@b.no, Max" } } as const;
    expect(said(status({ login: login({ answer }) }))).toContain("Logged in with claude.ai as a@b.no, Max");
  });

  test("a login Codex reports names the method and no account (AC-2)", () => {
    const text = said(status({ login: login({ answer: { key: "login.inWith", values: { method: "ChatGPT" } } }) }), { name: "Codex", tool: "codex" });
    expect(text).toContain("Logged in with ChatGPT");
    expect(text).not.toContain(" as ");
  });

  test("a login that could not be read says to open the page again, never that it is not logged in (AC-2)", () => {
    const answer = { key: "login.timedOut", values: { command: "claude auth status" } } as const;
    const text = said(status({ login: login({ ok: null, answer }) }));
    expect(text).toContain("could not be read");
    expect(text).toContain("open the page again");
    expect(text.toLowerCase()).not.toContain("not logged in");
    expect(text).not.toContain("press Check");
  });

  test("a login that ends is shown with the date to the second, in UTC (AC-3)", () => {
    const answer = { key: "login.in" } as const;
    expect(said(status({ login: login({ answer, ends: "2026-12-01T09:00:00.000Z" }) }))).toContain("2026-12-01 09:00:00 UTC");
  });

  test("a login with no end date shows none (AC-3)", () => {
    expect(said(status({ login: login({ answer: { key: "login.in" } }) }))).not.toContain("UTC");
  });

  test("a provider that is not logged in is shown with the command that logs it in, folder filled in (AC-4)", () => {
    const answer = { key: "login.out", values: { command: "CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login" } } as const;
    const text = said(status({ login: login({ ok: false, answer }) }));
    expect(text).toContain("Not logged in");
    expect(text).toContain("CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login");
  });
});

describe("the login state of a row", () => {
  const answered = (key: string, ok: boolean | null, values?: Record<string, string>): ProviderStatus =>
    status({ login: login({ ok, answer: { key, ...(values ? { values } : {}) } as never }) });

  test("a login that is out is out; any login.in answer is in, a mixed Claude login included; unreadable, none and no status are unread; not installed wins (AC-6, AC-20)", () => {
    expect(providerLoginState(answered("login.out", false, { command: "claude auth login" }))).toBe("out");
    expect(providerLoginState(answered("login.in", true))).toBe("in");
    expect(providerLoginState(answered("login.inWithAs", false, { method: "api", account: "a" }))).toBe("in");
    expect(providerLoginState(answered("login.timedOut", null, { command: "claude auth status" }))).toBe("unread");
    expect(providerLoginState(status())).toBe("unread");
    expect(providerLoginState(undefined)).toBe("unread");
    expect(providerLoginState(status({ installed: false, version: undefined }))).toBe("notInstalled");
  });
});

describe("the rows of the providers table", () => {
  const providers: Record<string, Provider> = {
    Claude: { name: "Claude", tool: "claude" },
    "Codex-p": { name: "Codex-p", tool: "codex", codexHome: "~/.codex-p" },
    OpenCode: { name: "OpenCode", tool: "opencode" },
  };

  test("each row holds the provider's name, its tool's name, its login state and the address of its page, in config order (AC-6, AC-7)", () => {
    const statuses = { Claude: status({ key: "Claude", login: login({ ok: false, answer: { key: "login.out", values: { command: "x" } } }) }) };
    expect(providerRows(providers, statuses)).toEqual([
      { key: "Claude", name: "Claude", tool: "Claude Code", login: "out", href: "/settings/providers/edit?key=Claude" },
      { key: "Codex-p", name: "Codex-p", tool: "Codex", login: "unread", href: "/settings/providers/edit?key=Codex-p" },
      { key: "OpenCode", name: "OpenCode", tool: "OpenCode", login: "unread", href: "/settings/providers/edit?key=OpenCode" },
    ]);
  });

  test("no providers, no rows", () => {
    expect(providerRows(undefined, {})).toEqual([]);
  });
});
