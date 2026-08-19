// The "…" menu is a native <details>, which stays open until clicked
// again — a box, not a menu. A menu closes when the reader clicks
// anywhere else or presses Escape (PaceUp's header menu is the
// reference). Same contract as the theme script: one small IIFE on
// every page, no elements invented, nothing else touched.
(() => {
  const closeAll = (except?: Element | null): void => {
    for (const d of Array.from(document.querySelectorAll("details.menu[open]"))) {
      if (d !== except) (d as HTMLDetailsElement).open = false;
    }
  };
  document.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    closeAll(target?.closest?.("details.menu") ?? null);
  });
  document.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") closeAll();
  });
})();
