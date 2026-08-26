// Criterion 3 (spec 80): merging stored runs with claude-usage's
// /api/live rows — one fetch, injected; degrade without error.
import { describe, expect, test } from "bun:test";
import { AideRunStore } from "../../src/queue/aide-run-store.ts";
import { LiveEnricher } from "../../src/integrations/live.ts";

const run = {
  host: "laptop",
  sessionId: "abc-123",
  command: "implement" as const,
  spec: "80",
  project: "aide",
};

function storeWith() {
  const s = new AideRunStore();
  s.put(run, "2026-08-16T10:00:00Z");
  return s;
}

const liveAnswer = {
  generatedAt: "2026-08-16T10:00:05Z",
  hosts: [
    {
      host: "laptop",
      sessions: [
        {
          sessionId: "abc-123",
          state: "working",
          agents: [{ agentId: "a1" }, { agentId: "a2" }],
          sessionCostUSD: 1.5,
        },
      ],
    },
  ],
};

const okFetch = (async () =>
  new Response(JSON.stringify(liveAnswer), { status: 200 })) as unknown as typeof fetch;
const failFetch = (async () => {
  throw new Error("connection refused");
}) as unknown as typeof fetch;

describe("LiveEnricher.rows", () => {
  test("merges liveness, subagent count and cost from one /api/live fetch", async () => {
    const enricher = new LiveEnricher({ fetch: okFetch, baseUrl: "http://x" });
    const { rows, enriched } = await enricher.rows(storeWith());
    expect(enriched).toBe(true);
    expect(rows[0]).toMatchObject({
      spec: "80",
      command: "implement" as const,
      project: "aide",
      live: "working",
      subagents: 2,
      costUsd: 1.5,
      enriched: true,
    });
  });

  test("degrades when claude-usage is unreachable", async () => {
    const enricher = new LiveEnricher({ fetch: failFetch, baseUrl: "http://x" });
    const { rows, enriched } = await enricher.rows(storeWith());
    expect(enriched).toBe(false);
    expect(rows[0]).toMatchObject({ spec: "80", live: "unknown", enriched: false });
  });

  test("a session absent from /api/live is not-live", async () => {
    const empty = { ...liveAnswer, hosts: [] };
    const f = (async () => new Response(JSON.stringify(empty))) as unknown as typeof fetch;
    const enricher = new LiveEnricher({ fetch: f, baseUrl: "http://x" });
    const { rows } = await enricher.rows(storeWith());
    expect(rows[0].live).toBe("not-live");
  });

  test("fetch is lazy and cached — two calls within the TTL fetch once", async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response(JSON.stringify(liveAnswer));
    }) as unknown as typeof fetch;
    const enricher = new LiveEnricher({ fetch: counting, baseUrl: "http://x", ttlMs: 5000 });
    expect(calls).toBe(0);
    await enricher.rows(storeWith());
    await enricher.rows(storeWith());
    expect(calls).toBe(1);
  });
});
