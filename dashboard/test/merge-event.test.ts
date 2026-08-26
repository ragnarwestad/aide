// Spec 158: the dashboard merges in its own process, so no transcript
// says a branch landed. The reporter is how it says so itself — opt-in,
// bounded, and never able to turn a merge that happened into a failure.
import { describe, expect, test } from "bun:test";
import { MergeEventReporter, type MergeEvent } from "../src/integrations/merge-event.ts";

const event: MergeEvent = {
  project: "aide",
  specFolder: "158-a-merge-is-an-event-claude-usage-can-see",
  branch: "aide/158-a-merge-is-an-event-claude-usage-can-see",
  repoRoot: "/repos/aide-specs",
  step: "analyze",
  jobId: "job-1",
  timestamp: "2026-08-21T10:00:00.000Z",
};

/** A fetch that records what it was asked to do. */
function capturing(answer: () => Response | Promise<Response> = () => new Response("{}")) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return answer();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("MergeEventReporter", () => {
  test("a reporter with no url is unconfigured and makes no request", async () => {
    const { calls, fetchImpl } = capturing();
    const reporter = new MergeEventReporter({ fetch: fetchImpl });
    expect(reporter.configured).toBe(false);
    await reporter.report(event);
    expect(calls).toEqual([]);
  });

  test("an empty url counts as absent, not as a url to post to", async () => {
    const { calls, fetchImpl } = capturing();
    const reporter = new MergeEventReporter({ url: "", fetch: fetchImpl });
    expect(reporter.configured).toBe(false);
    await reporter.report(event);
    expect(calls).toEqual([]);
  });

  test("a configured reporter POSTs the event as JSON", async () => {
    const { calls, fetchImpl } = capturing();
    const reporter = new MergeEventReporter({ url: "http://x/ingest", fetch: fetchImpl });
    expect(reporter.configured).toBe(true);
    await reporter.report(event);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://x/ingest");
    expect(calls[0].init.method).toBe("POST");
    expect(new Headers(calls[0].init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0].init.body as string)).toEqual(event);
  });

  test("the request carries an abort signal, so an unanswered POST cannot hang a landing", async () => {
    const { calls, fetchImpl } = capturing();
    const reporter = new MergeEventReporter({ url: "http://x/ingest", fetch: fetchImpl, timeoutMs: 50 });
    await reporter.report(event);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  test("a fetch that never answers is abandoned at the timeout rather than awaited", async () => {
    const hang = (async (_url: unknown, init: unknown) => {
      const signal = (init as RequestInit).signal!;
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;
    const reporter = new MergeEventReporter({ url: "http://x/ingest", fetch: hang, timeoutMs: 30 });
    const started = Date.now();
    await reporter.report(event);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("a throwing fetch is swallowed — the merge already happened", async () => {
    const thrower = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const reporter = new MergeEventReporter({ url: "http://x/ingest", fetch: thrower });
    expect(await reporter.report(event)).toBeUndefined();
  });

  test("a refused report is swallowed too", async () => {
    const { fetchImpl } = capturing(() => new Response("no", { status: 500 }));
    const reporter = new MergeEventReporter({ url: "http://x/ingest", fetch: fetchImpl });
    expect(await reporter.report(event)).toBeUndefined();
  });

  test("no retry: one report is one request, however it went", async () => {
    let attempts = 0;
    const failing = (async () => {
      attempts++;
      throw new Error("down");
    }) as unknown as typeof fetch;
    const reporter = new MergeEventReporter({ url: "http://x/ingest", fetch: failing });
    await reporter.report(event);
    expect(attempts).toBe(1);
  });
});
