// A page sent in two halves (spec 515): the head at once, the rest when it
// is ready. The status is fixed at the first byte, so a page that has begun
// can no longer become a 404 or a 500 — the route decides those first, and
// a rest that fails ends the page with a fallback instead.

const STREAMED = new WeakSet<Response>();

export function streamedPage(o: {
  head: string;
  rest: () => Promise<string>;
  /** Sent in place of the rest when it rejects. */
  failedRest: string;
  headers: Headers;
}): Response {
  const enc = new TextEncoder();
  // Started NOW, not when the head has been read: the total time stays the
  // view's time plus a few milliseconds.
  const rest = o.rest().catch((err) => {
    console.error("spec page failed after its head was sent:", err);
    return o.failedRest;
  });
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(o.head));
    },
    async pull(c) {
      c.enqueue(enc.encode(await rest));
      c.close();
    },
  });
  const res = new Response(body, { headers: o.headers });
  STREAMED.add(res);
  return res;
}

/** Whether `res` came from `streamedPage`: `compressResponse` gzips such a
 *  response as a stream rather than reading it whole. */
export const isStreamedPage = (res: Response): boolean => STREAMED.has(res);
