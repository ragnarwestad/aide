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
    // The About item opens the dialog in place; its href stays as the
    // no-JS fallback. Escape and the cross are the platform's own once
    // the box is modal — a click on the backdrop is not, so it is
    // handled here: the dialog element itself is only ever the click
    // target when the click landed outside the panel.
    if (target?.closest?.("[data-about]")) {
      e.preventDefault();
      closeAll();
      document.querySelector<HTMLDialogElement>("dialog.about")?.showModal();
      return;
    }
    if (target instanceof HTMLDialogElement && target.classList.contains("about")) {
      target.close();
      return;
    }
    closeAll(target?.closest?.("details.menu") ?? null);
  });
  document.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") closeAll();
  });
})();
