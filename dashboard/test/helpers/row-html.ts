// Reading the action stack out of a queue row's HTML. Three suites ask
// for it — render, design-system and queue-routes — and a harness kept
// in three copies is a harness that will one day disagree with itself
// about where a row's buttons are.
//
// Until spec 126 the stack had a `<td class="stackcell">` all to
// itself, spanning the phase lines beside it, so one lazy regex found
// it. It shares the LEADING phase line's cell now, which means there is
// no cell boundary to stop at: the scan below counts spans to the
// matching close instead, because the stack nests them.

const OPEN = '<span class="stack">';

/** Where the stack starts and ends in a chunk of row HTML, or nothing
 *  when the chunk draws no stack (a collapsed row does not). */
export function stackSpan(html: string): { at: number; end: number } | undefined {
  const at = html.indexOf(OPEN);
  if (at < 0) return undefined;
  let depth = 0;
  const tag = /<(\/?)span\b[^>]*>/g;
  tag.lastIndex = at;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { at, end: m.index + m[0].length };
  }
  return undefined;
}

/** The same chunk with the stack taken off — for a test about the
 *  phase line the stack happens to lead. */
export function withoutStack(html: string): string {
  const span = stackSpan(html);
  return span ? html.slice(0, span.at) + html.slice(span.end) : html;
}

/** The stack's own HTML, tags included, or "" where there is none. */
export function stackOf(html: string): string {
  const span = stackSpan(html);
  return span ? html.slice(span.at, span.end) : "";
}
