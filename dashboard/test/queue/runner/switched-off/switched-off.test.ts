// A step whose provider is switched off is held, and says which provider to
// switch on; a job on a provider that is on, a running job and a board step
// are left alone.

import { describe, expect, test } from "bun:test";
import type { Job } from "../../../../src/queue/queue.ts";
import type { Provider } from "../../../../src/queue/providers/index.ts";
import { switchedOffHolds } from "../../../../src/queue/runner/switched-off.ts";
import { renderMessage } from "../../../../src/messages/render.ts";

const PROVIDERS: Record<string, Provider> = {
  off: { name: "Claude Capra", tool: "claude", enabled: false },
  on: { name: "Codex", tool: "codex" },
};

const job = (id: string, over: Record<string, unknown> = {}): Job =>
  ({ id, project: "aide", specFolder: "703-x", steps: ["analyze"], stepIndex: 0, state: "queued", ...over }) as unknown as Job;

describe("a step on a switched-off provider", () => {
  test("is held with the provider's name; one on a provider that is on is not", () => {
    const providerOf = (j: Job): string => (j.id === "a" ? "off" : "on");
    const held = switchedOffHolds([job("a"), job("b")], providerOf, PROVIDERS);
    expect([...held.keys()]).toEqual(["a"]);
    expect(held.get("a")).toEqual({ key: "runner.providerSwitchedOff", values: { provider: "Claude Capra" } });
  });

  test("a running job, a landing one and a board step are not held", () => {
    const jobs = [job("r", { state: "running" }), job("l", { landing: { step: "archive" } }), job("d", { steps: ["deploy"] })];
    expect(switchedOffHolds(jobs, () => "off", PROVIDERS).size).toBe(0);
  });

  test("a step with no provider, or one that has been removed, is not held here", () => {
    expect(switchedOffHolds([job("a")], () => "claude", PROVIDERS).size).toBe(0);
    expect(switchedOffHolds([job("a")], () => "gone", PROVIDERS).size).toBe(0);
  });
});

describe("the sentence a held step shows", () => {
  test("is a Problem line and a Solution line naming the provider to switch on", () => {
    const text = renderMessage("en", { key: "runner.providerSwitchedOff", values: { provider: "Claude Capra" } });
    expect(text.split("\n")).toHaveLength(2);
    expect(text.split("\n")[1]).toContain("Claude Capra");
  });
});
