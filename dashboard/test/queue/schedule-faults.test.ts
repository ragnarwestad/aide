import { expect, test } from "bun:test";
import { scheduleFaults } from "../../src/queue/schedule-faults.ts";
import type { ScheduleEntry } from "../../src/queue/schedule.ts";

const defaults = {
  modelChoices: { Opus: {}, "gpt-6.1-sol": { tool: "codex" as const } },
  providers: { Claude: { name: "Claude-Personal", tool: "claude" as const }, Codex: { name: "Codex", tool: "codex" as const } },
};
const entry = (fields: Partial<ScheduleEntry>): ScheduleEntry => ({ name: "Untangle", cron: "0 6 * * *", prompt: "p.md", enabled: true, ...fields });
const problems = (...entries: ScheduleEntry[]) => scheduleFaults([["aide", entries]], defaults).map((f) => f.problem);

test("a Codex model under a Claude provider is a fault, named as the fire would refuse it", () => {
  expect(problems(entry({ model: "gpt-6.1-sol", provider: "Claude" }))).toEqual([
    expect.stringContaining("gpt-6.1-sol is a Codex model and Claude-Personal is a Claude Code provider"),
  ]);
});

test("a model or a provider the board does not offer is a fault", () => {
  expect(problems(entry({ model: "gpt-5.6-sol" }), entry({ name: "Other", provider: "Gone" }))).toEqual([
    "gpt-5.6-sol is not a model this dashboard offers",
    "Gone is not a provider this dashboard offers",
  ]);
});

test("a matching pair, an entry on the defaults and a disabled entry are no fault", () => {
  expect(problems(
    entry({ model: "gpt-6.1-sol", provider: "Codex" }),
    entry({ name: "Defaults" }),
    entry({ name: "Off", model: "gpt-6.1-sol", provider: "Claude", enabled: false }),
  )).toEqual([]);
});
