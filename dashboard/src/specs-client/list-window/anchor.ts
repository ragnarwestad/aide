const HEADS = "tr.spechead[id], tr.execution-group[id]";

/** The rows that kept their order through a redraw: the longest run of
 *  rows present on both sides whose order did not change. A row outside
 *  it is one the sort moved. */
export function keptOrder(before: readonly string[], after: readonly string[]): Set<string> {
  const placeAfter = new Map(after.map((key, index) => [key, index]));
  const common = before.filter((key) => placeAfter.has(key));
  const places = common.map((key) => placeAfter.get(key)!);
  // Longest increasing subsequence of the after-places, in before order.
  const tails: number[] = [];
  const parent: number[] = [];
  for (let i = 0; i < places.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (places[tails[mid]!]! < places[i]!) lo = mid + 1;
      else hi = mid;
    }
    parent[i] = lo ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const kept = new Set<string>();
  for (let i = tails.length ? tails.at(-1)! : -1; i >= 0; i = parent[i]!) kept.add(common[i]!);
  return kept;
}

/** The row the page holds on screen: the first row from the top of the
 *  view down that is still on the list and was not moved by the sort. */
export function heldRow(seen: readonly string[], before: readonly string[], after: readonly string[]): string | undefined {
  const kept = keptOrder(before, after);
  return seen.find((key) => kept.has(key));
}

/** Keep the list where the reader has it while rows change. At the top
 *  of the page it stays at the top. Further down, the first visible row
 *  keeps its offset while rows above it come and go; a row the sort
 *  moves away is not followed, and the row below it is held instead. */
export function holdListAnchor(body: Element): () => void {
  const wrap = body.querySelector(".tablewrap") as HTMLElement | null;
  if (!wrap || typeof wrap.getBoundingClientRect !== "function") return () => {};
  const win = body.ownerDocument.defaultView;
  const scrolls = wrap.scrollHeight > wrap.clientHeight && /auto|scroll/.test(getComputedStyle(wrap).overflowY);
  if ((scrolls ? wrap.scrollTop : win?.scrollY ?? 0) <= 0) return () => {};
  const top = scrolls ? wrap.getBoundingClientRect().top : 0;
  const bottom = scrolls ? wrap.getBoundingClientRect().bottom : win?.innerHeight ?? 0;
  const heads = [...body.querySelectorAll<HTMLElement>(HEADS)];
  const before = heads.map((row) => row.id);
  const offsets = new Map<string, number>();
  for (const row of heads) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > top && rect.top < bottom) offsets.set(row.id, rect.top);
  }
  if (!offsets.size) return () => {};
  return () => {
    const rows = [...body.querySelectorAll<HTMLElement>(HEADS)];
    const key = heldRow([...offsets.keys()], before, rows.map((row) => row.id));
    const row = rows.find((r) => r.id === key);
    if (!key || !row) return;
    const delta = row.getBoundingClientRect().top - offsets.get(key)!;
    const nextWrap = body.querySelector(".tablewrap") as HTMLElement | null;
    if (scrolls && nextWrap) nextWrap.scrollTop += delta;
    else if (delta && typeof win?.scrollBy === "function") win.scrollBy(0, delta);
  };
}
