// The "…" menu and the "?" run-info popup are both native <details>,
// which stay open until clicked again — a box, not a menu. A menu
// closes when the reader clicks anywhere else or presses Escape
// (PaceUp's header menu is the reference). Same contract as the theme
// script: one small IIFE on every page, no elements invented, nothing
// else touched.
(() => {
  const DISCLOSURES = "details.menu, details.intro";
  const closeAll = (except?: Element | null): void => {
    for (const d of Array.from(document.querySelectorAll("details.menu[open], details.intro[open]"))) {
      if (d !== except) (d as HTMLDetailsElement).open = false;
    }
  };
  // The compact AI/model picker on a phase line (a narrow screen only)
  // is a checkbox and a label, not a <details> — a <details> that has to
  // be OPEN at desktop width cannot be, since a closed one's content is
  // not rendered at all. It closes the same way this menu does: a click
  // anywhere outside the picker it belongs to, or Escape.
  const closeBoxes = (target?: Element | null): void => {
    for (const el of Array.from(document.querySelectorAll(".aimodelopen"))) {
      const box = el as HTMLInputElement;
      if (!box.checked) continue;
      const mine = box.closest(".aimodel");
      if (!target || !mine || !mine.contains(target)) box.checked = false;
    }
  };
  document.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    closeBoxes(target);
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
    closeAll(target?.closest?.(DISCLOSURES) ?? null);
  });
  document.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    closeAll();
    closeBoxes();
  });
})();
