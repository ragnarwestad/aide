// One held-open `/api/queue/events` connection, read frame by frame.
// Pulled out of queue-events.test.ts (spec 275) so a second suite that
// needs to watch for `event: changed` — cache-warmer.test.ts, checking
// that a background poll's own correction reaches an open tab — does
// not carry a second copy of the same parser.

export interface Stream {
  contentType: string | null;
  /** The next real event. Keep-alive comments are skipped: they are the
   *  connection breathing, not news. */
  next(ms?: number): Promise<string>;
  /** That nothing arrives inside `ms` — criterion 1's own assertion. */
  quiet(ms: number): Promise<void>;
  close(): Promise<void>;
}

/** The server writes a `: open` comment as soon as the subscriber is
 *  registered, and this waits for it before returning — otherwise a
 *  test could post its change into a server that had not yet added the
 *  listener, and the event it was waiting for would never have been
 *  meant for it. */
export async function connect(base: string, query: string): Promise<Stream> {
  const res = await fetch(`${base}/api/queue/events${query}`);
  if (res.status !== 200) throw new Error(`connect failed: ${res.status}`);
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
  // The handshake comment, so the caller knows it is subscribed.
  const first = await frame(4000);
  if (!first?.startsWith(":")) throw new Error(`expected the handshake comment, got: ${JSON.stringify(first)}`);
  return stream;
}
