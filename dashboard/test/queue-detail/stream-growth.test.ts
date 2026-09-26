// Spec 500: only a tab that named the growing step hears a transcript grow.

import { afterEach, describe, expect, test } from "bun:test";
import { createStreamGrowth, type SseWatchersContext } from "../../src/serve/sse-watchers.ts";
import { queueHarness } from "../helpers/queue-server.ts";
import { connect as connectStream, type Stream } from "../helpers/sse.ts";

type Controller = ReadableStreamDefaultController<Uint8Array>;
const decoder = new TextDecoder();

/** A subscriber that only remembers what it was told. */
const subscriber = (): { c: Controller; told: () => number } => {
  const chunks: string[] = [];
  const c = { enqueue: (b: Uint8Array) => void chunks.push(decoder.decode(b)) } as unknown as Controller;
  return { c, told: () => chunks.filter((x) => x.includes("event: changed")).length };
};

const KEY = "aide/500-x:analyze";
const running = (file: string, step = "analyze", folder = "500-x") =>
  ({ id: `job-${file}`, project: "aide", specFolder: folder, steps: [step], stepIndex: 0, state: "running", streamFile: file }) as never;

function setup(keysOf: Record<string, string[]>) {
  const subs = Object.fromEntries(Object.keys(keysOf).map((name) => [name, subscriber()]));
  const ctx = {
    encoder: new TextEncoder(),
    watchers: new Set(Object.values(subs).map((s) => s.c)),
    phaseWatchers: new Map(Object.entries(keysOf).filter(([, k]) => k.length).map(([n, k]) => [subs[n]!.c, new Set(k)])),
  } as unknown as SseWatchersContext;
  return { subs, ctx };
}

describe("the growth check on the two-second tick (AC-3)", () => {
  test("only the tab that named the running step is told, and only when the file grew (AC-3)", () => {
    const { subs, ctx } = setup({ named: [KEY], other: ["aide/500-x:implement"], elsewhere: ["aide/501-y:analyze"], none: [] });
    const sizes: Record<string, number> = { "/t/a": 10 };
    const growth = createStreamGrowth(ctx, () => [running("/t/a")], (f) => sizes[f] ?? 0);
    growth.tick();
    expect(subs.named!.told()).toBe(1);
    for (const n of ["other", "elsewhere", "none"]) expect(subs[n]!.told()).toBe(0);
    growth.tick();
    expect(subs.named!.told()).toBe(1);
    sizes["/t/a"] = 25;
    growth.tick();
    expect(subs.named!.told()).toBe(2);
  });

  test("the first sight of an empty file is not growth (AC-3)", () => {
    const { subs, ctx } = setup({ named: [KEY] });
    createStreamGrowth(ctx, () => [running("/t/a")], () => 0).tick();
    expect(subs.named!.told()).toBe(0);
  });

  test("a file whose job stopped running is forgotten, so a fresh sight counts as growth again (AC-3)", () => {
    const { subs, ctx } = setup({ named: [KEY] });
    let jobs = [running("/t/a")];
    const growth = createStreamGrowth(ctx, () => jobs, () => 10);
    growth.tick();
    jobs = [];
    growth.tick();
    jobs = [running("/t/a")];
    growth.tick();
    expect(subs.named!.told()).toBe(2);
  });

  test("while no subscriber has keys, no file is measured (AC-3)", () => {
    const { ctx } = setup({ none: [] });
    const measured: string[] = [];
    createStreamGrowth(ctx, () => [running("/t/a")], (f) => {
      measured.push(f);
      return 5;
    }).tick();
    expect(measured).toEqual([]);
  });
});

describe("GET /api/queue/events?phases=… (AC-3)", () => {
  const harness = queueHarness("aide-stream-growth-");
  const opened: Stream[] = [];
  afterEach(async () => {
    while (opened.length) await opened.pop()!.close();
    harness.cleanup();
  });

  test("registers its keys, closing the request removes them, and shutting down clears them (AC-3)", async () => {
    const { base, server } = harness.start();
    const s = await connectStream(base, `?phases=${encodeURIComponent(KEY)}`);
    opened.push(s);
    const plain = await connectStream(base, "");
    opened.push(plain);
    expect(server.phaseWatchCount()).toBe(1);
    await s.close();
    await Bun.sleep(50);
    expect(server.phaseWatchCount()).toBe(0);
    const again = await connectStream(base, `?phases=${encodeURIComponent(KEY)}`);
    opened.push(again);
    expect(server.phaseWatchCount()).toBe(1);
    server.stop();
    expect(server.phaseWatchCount()).toBe(0);
  });
});
