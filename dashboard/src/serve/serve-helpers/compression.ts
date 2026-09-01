// Gzips a compressible response when the client asked for it (spec 315,
// REQ-3). Applied once, centrally, in serve.ts — not threaded into
// every route, so a route's own body never has to know this happens.

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
