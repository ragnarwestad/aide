(() => {
  let opening = 0;
  const dialog = () => document.querySelector<HTMLDialogElement>("#usage-dialog");
  const pending = (root: ParentNode): string[] => [...root.querySelectorAll<HTMLElement>("[data-usage-pending]")].map((el) => el.dataset.usagePending!).filter(Boolean);
  const load = async (box: HTMLDialogElement, url: string, generation: number): Promise<void> => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("request failed");
      const html = await response.text();
      if (generation !== opening) return;
      const content = box.querySelector<HTMLElement>("[data-usage-content]")!;
      const before = pending(content).length;
      const holder = document.createElement("div");
      holder.innerHTML = html;
      if (before && pending(holder).length > before) return;
      content.innerHTML = html;
      const keys = pending(content);
      await Promise.all(keys.map((key) => load(box, `${box.dataset.src}?read=${encodeURIComponent(key)}`, generation)));
    } catch {
      location.reload();
    }
  };
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const box = dialog();
    if (!box) return;
    if (target?.closest?.("[data-usage-open]")) {
      const generation = ++opening;
      box.showModal();
      void load(box, box.dataset.src!, generation);
    } else if (target === box) box.close();
  });
})();
