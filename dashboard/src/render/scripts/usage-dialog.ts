(() => {
  let opening = 0;

  const load = async (box: HTMLDetailsElement, generation: number): Promise<void> => {
    try {
      const response = await fetch(box.dataset.src!);
      if (!response.ok) throw new Error("request failed");
      const html = await response.text();
      if (generation === opening) box.querySelector<HTMLElement>("[data-usage-content]")!.innerHTML = html;
    } catch {
      location.reload();
    }
  };
  document.addEventListener("toggle", (event) => {
    const box = event.target as HTMLDetailsElement;
    if (!box?.matches?.("#usage-dialog")) return;
    const generation = ++opening;
    if (box.open) void load(box, generation);
  }, true);
})();
