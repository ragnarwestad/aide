import { describe, expect, test } from "bun:test";
import { providerLimitSentence } from "../../../../src/render/ui/job-state/provider-limit.ts";
import type { ProviderLimit } from "../../../../src/queue/queue.ts";

// The usage limit that stopped a step, said the way a person needs it:
// which AI, which window, when it starts over, and what else the tool
// reported beside it. Every part comes from the tool's own record —
// the model is spent by the time it matters.
describe("the sentence a provider's usage limit is shown as", () => {
  const TZ = "Europe/Oslo";
  // 2026-09-17 09:54 in Oslo.
  const NOW = Date.parse("2026-09-17T07:54:00Z");

  const claude: ProviderLimit = {
    tool: "claude",
    window: "five_hour",
    resetsAt: "2026-09-17T10:10:00Z",
    windows: [
      { name: "five_hour", usedPercent: 100, resetsAt: "2026-09-17T10:10:00Z" },
      { name: "seven_day", usedPercent: 23, resetsAt: "2026-09-20T01:00:00Z" },
    ],
    credit: "out_of_credits",
  };

  test("names the AI and model, the window, and a same-day reset as a clock time", () => {
    expect(providerLimitSentence(claude, "Sonnet", "en", NOW, TZ)).toBe(
      "Claude (Sonnet): the five-hour limit is used up — resets 12:10. " +
        "The weekly limit: 23 % used. No extra usage is left.",
    );
  });

  test("says the same in Norwegian", () => {
    expect(providerLimitSentence(claude, "Sonnet", "nb", NOW, TZ)).toBe(
      "Claude (Sonnet): femtimersgrensen er brukt opp — nullstilles 12:10. " +
        "Ukesgrensen: 23 % brukt. Det er ikke mer ekstra forbruk igjen.",
    );
  });

  test("a reset on another day carries the day too", () => {
    const weekly: ProviderLimit = { tool: "claude", window: "seven_day", resetsAt: "2026-09-20T01:00:00Z" };
    expect(providerLimitSentence(weekly, undefined, "en", NOW, TZ)).toBe(
      "Claude: the weekly limit is used up — resets Sun 20 Sep, 03:00.",
    );
  });

  test("Codex names its plan, and a window the tool named in minutes", () => {
    const codex: ProviderLimit = {
      tool: "codex",
      window: "90_minutes",
      resetsAt: "2026-09-17T10:10:00Z",
      windows: [{ name: "90_minutes", usedPercent: 100, resetsAt: "2026-09-17T10:10:00Z" }],
      plan: "plus",
    };
    expect(providerLimitSentence(codex, "gpt-6-astra", "en", NOW, TZ)).toBe(
      "Codex (gpt-6-astra): the 90-minute limit is used up — resets 12:10. Plan: plus.",
    );
  });

  test("with no reset time it still says which limit ran out", () => {
    const bare: ProviderLimit = { tool: "claude", window: "provider" };
    expect(providerLimitSentence(bare, "Opus", "en", NOW, TZ)).toBe("Claude (Opus): the usage limit is used up.");
  });
});
