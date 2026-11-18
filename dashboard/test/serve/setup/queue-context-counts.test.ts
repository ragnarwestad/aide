import { afterEach, describe, expect, test } from "bun:test";
import { setupQueueContext, type QueueContextInputs } from "../../../src/serve/setup/queue-context.ts";
import type { ServerState } from "../../../src/serve/state.ts";
import { setSpecActivityCounts } from "../../../src/render/ui/running-specs";
import { setWaitingCount } from "../../../src/render/ui/pwa.ts";

afterEach(() => {
  setSpecActivityCounts(undefined);
  setWaitingCount(null);
});

// A route that changes what a page shows without moving a job (a spec made
// by `aide create`, say) tells open pages through this notice, and the tab
// counts ride on it: without them "Specs (n)" keeps its old number.
describe("the notice a route sends to open pages", () => {
  test("carries the tab counts", () => {
    setSpecActivityCounts(() => ({ needsAttention: 1, openSpecs: 7 }));
    setWaitingCount(() => 3);
    const sent: string[] = [];
    const watcher = {} as ReadableStreamDefaultController;
    const ctx = setupQueueContext({} as ServerState, {
      opts: {}, watchers: new Set([watcher]),
      writeTo: (_c: ReadableStreamDefaultController, event: string) => { sent.push(event); },
    } as unknown as QueueContextInputs);
    ctx.notifyQueueChanged();
    const data = JSON.parse(sent[0]!.match(/^data: (.*)$/m)![1]!);
    expect(sent[0]).toStartWith("event: changed\n");
    expect(data).toEqual({ waiting: 3, needsAttention: 1, openSpecs: 7 });
  });
});
