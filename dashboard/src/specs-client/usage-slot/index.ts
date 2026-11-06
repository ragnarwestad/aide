// The chosen provider's usage on the Providers tab, read after the tab has
// drawn: reading it runs the tool and takes seconds, and the tab does not
// wait for it. Each place drawn with `data-usage-from` is filled with what
// that address answers; a place whose read fails keeps its line.

export async function fillUsage(root: ParentNode, fetchImpl: typeof fetch = fetch): Promise<void> {
  const slots = Array.from(root.querySelectorAll("[data-usage-from]")) as HTMLElement[];
  await Promise.all(slots.map(async (slot) => {
    const from = slot.dataset.usageFrom;
    if (!from) return;
    try {
      const res = await fetchImpl(from, { headers: { accept: "text/html" } });
      if (!res.ok) return;
      slot.innerHTML = await res.text();
      slot.removeAttribute("data-usage-from");
      slot.removeAttribute("aria-busy");
    } catch {
      // The line already drawn stays: the usage is read again on the next visit.
    }
  }));
}
