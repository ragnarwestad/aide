/** Keep the first visible row at its offset while rows above it change. */
export function holdListAnchor(body: Element): () => void {
  const wrap = body.querySelector(".tablewrap") as HTMLElement | null;
  if (!wrap || typeof wrap.getBoundingClientRect !== "function") return () => {};
  const scrolls = wrap.scrollHeight > wrap.clientHeight && /auto|scroll/.test(getComputedStyle(wrap).overflowY);
  const top = scrolls ? wrap.getBoundingClientRect().top : 0;
  const heads = [...body.querySelectorAll<HTMLElement>("tr.spechead[id], tr.execution-group[id]")];
  const anchor = heads.find((row) => row.getBoundingClientRect().bottom > top);
  const key = anchor?.id;
  const offset = anchor?.getBoundingClientRect().top;
  return () => {
    if (!key || offset === undefined) return;
    const row = [...body.querySelectorAll<HTMLElement>("tr.spechead[id], tr.execution-group[id]")].find((row) => row.id === key);
    if (!row) return;
    const delta = row.getBoundingClientRect().top - offset;
    const nextWrap = body.querySelector(".tablewrap") as HTMLElement | null;
    if (scrolls && nextWrap) nextWrap.scrollTop += delta;
    else if (delta && typeof window.scrollBy === "function") window.scrollBy(0, delta);
  };
}
