// Gzips a compressible response when the client asked for it (spec 315,
// REQ-3). Applied once, centrally, in serve.ts — not threaded into
// every route, so a route's own body never has to know this happens.

import { constants, createGzip } from "node:zlib";
import { pipeline, Readable } from "node:stream";
import { isStreamedPage } from "./streamed-page.ts";

const COMPRESSIBLE_PREFIXES = [
  "text/html", "text/javascript", "application/json",
  "application/manifest+json", "image/svg+xml",
];
// Below this, gzip's own overhead can cost more than it saves.
const MIN_COMPRESSIBLE_BYTES = 1024;

export async function compressResponse(req: Request, res: Response): Promise<Response> {
  if (req.method === "HEAD" || !res.body) return res;
  if (res.status === 204 || res.status === 304) return res;
  if (!/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) return res;
  if (res.headers.has("content-encoding")) return res;
  const contentType = res.headers.get("content-type") ?? "";
  if (!COMPRESSIBLE_PREFIXES.some((p) => contentType.startsWith(p))) return res;

  // A streamed page (spec 515) is gzipped as it goes, with a sync flush after
  // every chunk: `CompressionStream` holds back the tail of the head, which is
  // where the loading element sits, until the next chunk pushes it out.
  if (isStreamedPage(res)) {
    const gzip = createGzip({ flush: constants.Z_SYNC_FLUSH });
    // pipeline, not .pipe: a closed connection destroys gzip, which cancels
    // the source stream. The casts are the web/node stream typings' gap.
    pipeline(Readable.fromWeb(res.body as never), gzip, () => {});
    const headers = new Headers(res.headers);
    headers.set("content-encoding", "gzip");
    headers.set("vary", "accept-encoding");
    headers.delete("content-length");
    return new Response(Readable.toWeb(gzip) as never, { status: res.status, statusText: res.statusText, headers });
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < MIN_COMPRESSIBLE_BYTES) {
    return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  const gzipped = Bun.gzipSync(buf);
  const headers = new Headers(res.headers);
  headers.set("content-encoding", "gzip");
  headers.set("vary", "accept-encoding");
  headers.delete("content-length");
  return new Response(gzipped, { status: res.status, statusText: res.statusText, headers });
}
