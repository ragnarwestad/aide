// "A path on this board", decided once for the server and the page script.

/** A path on this board: one leading `/`, never `//` or `/\`, and no
 *  control character. A string from the browser that passes cannot take
 *  a link or a redirect to another host, a scheme, or across a header. */
export function isBoardPath(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return false;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return false;
  return !/[\u0000-\u001f\u007f]/.test(raw);
}
