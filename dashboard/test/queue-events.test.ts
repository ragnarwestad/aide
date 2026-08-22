// Spec 189: the page stopped asking. `GET /api/queue/events` is held
// open, says nothing at all while nothing is happening, and writes one
// `changed` event the moment the server's own picture of a job moves.
// The browser answers that by fetching the rows it already knows how to
// fetch — the event carries no payload, so nothing here has to be kept
// in step with what a row looks like.
//
// Every read in this file is BOUNDED. A regression that stops the
// server writing has to fail the test promptly; it must never sit on
// the suite waiting out Bun's 120-second idle timeout.
import { afterEach, describe, expect, test } from "bun:test";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";

const harness = queueHarness("aide-queue-events-");

/** Every stream this suite opened, closed before the servers are, so a
 *  reader is never left holding a socket into the next file. */
const open_: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  while (open_.length) await open_.pop()!.close();
  harness.cleanup();
});

const JOB = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

const auth = { "x-aide-token": TOKEN };
const postJson = { "content-type": "application/json", accept: "application/json", ...auth };

interface Stream {
  contentType: string | null;
  /** The next real event. Keep-alive comments are skipped: they are the
   *  connection breathing, not news. */
  next(ms?: number): Promise<string>;
  /** That nothing arrives inside `ms` — criterion 1's own assertion. */
  quiet(ms: number): Promise<void>;
  close(): Promise<void>;
}

/** One held-open connection, read frame by frame. The server writes a
 *  `: open` comment as soon as the subscriber is registered, and this
 *  waits for it before returning — otherwise a test could post its
 *  change into a server that had not yet added the listener, and the
 *  event it was waiting for would never have been meant for it. */
async function connect(base: string, query = `?token=${TOKEN}`): Promise<Stream> {
  const res = await fetch(`${base}/api/queue/events${query}`);
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let ended = false;

  const frame = async (ms: number): Promise<string | null> => {
    for (;;) {
      const at = buf.indexOf("\n\n");
      if (at !== -1) {
        const out = buf.slice(0, at + 2);
        buf = buf.slice(at + 2);
        return out;
      }
      if (ended) return null;
      const got = await Promise.race([
        reader.read(),
        Bun.sleep(ms).then(() => "timeout" as const),
      ]);
      if (got === "timeout") return null;
      if (got.done) {
        ended = true;
        return null;
      }
      buf += decoder.decode(got.value, { stream: true });
    }
  };

  const stream: Stream = {
    contentType: res.headers.get("content-type"),
    async next(ms = 4000) {
      for (;;) {
        const f = await frame(ms);
        if (f === null) throw new Error(`no event within ${ms}ms (buffered: ${JSON.stringify(buf)})`);
        if (!f.startsWith(":")) return f;
      }
    },
    async quiet(ms) {
      const f = await frame(ms);
      if (f !== null && !f.startsWith(":")) throw new Error(`an idle stream spoke: ${JSON.stringify(f)}`);
    },
    async close() {
      await reader.cancel().catch(() => {});
    },
  };
  open_.push(stream);
  // The handshake comment, so the caller knows it is subscribed.
  const first = await frame(4000);
  expect(first).toStartWith(":");
  return stream;
}

async function enqueue(base: string): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: postJson,
    body: JSON.stringify(JOB),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { job: { id: string } }).job.id;
}

describe("GET /api/queue/events", () => {
  test("is behind the token like every other queue route (criterion 9)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    expect((await fetch(`${base}/api/queue/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue/events?token=wrong`)).status).toBe(401);
  });

  test("is 503, not a held-open stream, when no token is configured", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/api/queue/events`);
    expect(res.status).toBe(503);
    expect((await res.text()).toLowerCase()).toContain("token");
  });

  test("the cookie the page already carries is enough — EventSource cannot send a header", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/api/queue/events`, { headers: { cookie: `aide_token=${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body!.cancel();
  });

  test("answers as an event stream, not as a page", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    expect(s.contentType).toContain("text/event-stream");
  });

  // The whole point of the spec: an open page that is looking at
  // nothing in particular makes no noise and redraws not at all.
  test("says nothing at all while nothing changes (criterion 1)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    await s.quiet(400);
  });

  test("a `changed` event follows an enqueue (criterion 2)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    await enqueue(base);
    expect(await s.next()).toContain("event: changed");
  });

  test("a `changed` event follows a cancel (criterion 2)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    const id = await enqueue(base);
    expect(await s.next()).toContain("event: changed");
    const cancelled = await fetch(`${base}/api/queue/${id}/cancel`, { method: "POST", headers: postJson });
    expect(cancelled.status).toBe(200);
    expect(await s.next()).toContain("event: changed");
  });

  // The second change source (spec 80's emitter). Cost, subagent count
  // and live state reach a row through a store the queue knows nothing
  // about — before this, the browser's own five-second poll kept them
  // fresh by accident, and a push driven by the queue alone would have
  // let them sit still for the whole of a long step.
  test("a `changed` event follows POST /api/aide-run (criterion 3)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    const reported = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "implement", spec: "81" }),
    });
    expect(reported.status).toBe(200);
    expect(await s.next()).toContain("event: changed");
  });

  test("every open page is told, not just the first", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const a = await connect(base);
    const b = await connect(base);
    await enqueue(base);
    expect(await a.next()).toContain("event: changed");
    expect(await b.next()).toContain("event: changed");
  });

  // A subscriber that is never removed is a leak that grows for as long
  // as the server is up, and a broadcast that throws on the first dead
  // one would stop the live ones being told at all.
  test("a page that goes away does not take the others with it", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const gone = await connect(base);
    const still = await connect(base);
    await gone.close();
    // Give the cancel a moment to reach the server's own stream.
    await Bun.sleep(50);
    await enqueue(base);
    expect(await still.next()).toContain("event: changed");
    // And again, so a registry left in a broken state after the first
    // broadcast is caught rather than passed over.
    await fetch(`${base}/api/queue/${await enqueueOther(base)}/cancel`, { method: "POST", headers: postJson });
    expect(await still.next()).toContain("event: changed");
  });
});

/** A second job, in a spec folder of its own — the first one's analyze
 *  is still unfinished, and the queue refuses the same step twice. */
async function enqueueOther(base: string): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: postJson,
    body: JSON.stringify({ ...JOB, steps: ["review-plan"] }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { job: { id: string } }).job.id;
}
