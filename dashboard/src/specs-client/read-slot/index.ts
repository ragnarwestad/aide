// A provider's readings (the usage, the models, the installation) on the
// Providers tab, read after the page has drawn: reading one runs the tool
// and takes seconds, and the page does not wait for it. Each place drawn
// with `data-read-from` is filled with what that address answers; a place
// whose read fails shows its own `data-read-failed` sentence instead.

export async function fillReadings(root: ParentNode, fetchImpl: typeof fetch = fetch): Promise<void> {
  const slots = Array.from(root.querySelectorAll("[data-read-from]")) as HTMLElement[];
  await Promise.all(slots.map(async (slot) => {
    const from = slot.dataset.readFrom;
    if (!from) return;
    let html: string | undefined;
    try {
      const res = await fetchImpl(from, { headers: { accept: "text/html" } });
      if (res.ok) html = await res.text();
    } catch {
      // Said in the place's own line, below.
    }
    if (html === undefined) {
      const line = slot.ownerDocument.createElement("p");
      line.className = "muted";
      line.textContent = slot.dataset.readFailed ?? "";
      slot.replaceChildren(line);
    } else {
      slot.innerHTML = html;
    }
    slot.removeAttribute("data-read-from");
    slot.removeAttribute("aria-busy");
  }));
}
