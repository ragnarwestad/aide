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
    // The About item opens the dialog in place. Escape and the cross are
    // the platform's own once the box is modal — a click on the backdrop
    // is not, so it is handled here: the dialog element itself is only
    // ever the click target when the click landed outside the panel.
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
  // The phone menu's language is a dropdown (spec 507), which does not
  // navigate by itself as the header's links do. The page reloads, so a
  // one-shot flag asks the next load to open the "…" menu again: a
  // setting changed in the menu leaves the menu open.
  document.addEventListener("change", (e) => {
    const select = (e.target as Element | null)?.closest?.("select[data-lang-select]") as HTMLSelectElement | null;
    if (!select) return;
    try {
      sessionStorage.setItem("menu-open", "1");
    } catch {
      /* no storage: the menu just comes back closed */
    }
    window.location.href = select.value;
  });
  document.addEventListener("DOMContentLoaded", () => {
    let flagged = false;
    try {
      flagged = sessionStorage.getItem("menu-open") === "1";
      sessionStorage.removeItem("menu-open");
    } catch {
      /* no storage: nothing to reopen */
    }
    const menu = flagged ? (document.querySelector(".morerows")?.closest("details.menu") as HTMLDetailsElement | null) : null;
    if (menu) menu.open = true;
  });
  document.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    closeAll();
    closeBoxes();
  });
  // Spec 477: each "(?)" popover has a static default side (CSS alone).
  // On open, measure it against the viewport and flip it to the other
  // side when the default would run past the left or right edge — the
  // only two edges a popover's own icon can be positioned near enough
  // to matter (vertical overflow is unchanged, out of scope for this
  // spec). Delegated from `document`, in the CAPTURE phase, rather than
  // a listener per `details.intro` found by an up-front
  // `querySelectorAll`: this combined script sits in `<head>` (shell.ts),
  // which runs before `<body>` — and its elements with it — exist, so
  // that up-front lookup always found zero elements and the flip never
  // ran anywhere (found only once a real page's own "(?)" popovers were
  // tested, not the fake DOM in menu-script.test.ts, which builds its
  // elements before running the script). Capture still reaches the
  // target regardless of whether "toggle" itself bubbles.
  document.addEventListener(
    "toggle",
    (e) => {
      const details = e.target as Element | null;
      if (!details?.matches?.("details.intro")) return;
      const el = details as HTMLDetailsElement;
      el.classList.remove("intro-flip");
      const p = el.querySelector(":scope > p") as HTMLElement | null;
      if (!p) return;
      p.style.removeProperty("transform");
      if (!el.open) return;
      let rect = p.getBoundingClientRect();
      if (rect.left < 0 || rect.right > window.innerWidth) {
        el.classList.add("intro-flip");
        rect = p.getBoundingClientRect();
      }
      // Neither side has room on a narrow enough window (a popover
      // near the middle of a 760px window can be too wide for either
      // side of its own icon) — a plain flip cannot fix that, so shift
      // it the rest of the way by the exact overflow, right edge
      // first: the left edge is checked again afterwards, since a
      // popover wider than the window itself would otherwise clear the
      // right edge only by running past the left one instead.
      let shift = 0;
      if (rect.right > window.innerWidth) shift -= rect.right - window.innerWidth;
      if (rect.left + shift < 0) shift = -rect.left;
      if (shift !== 0) p.style.transform = `translateX(${shift}px)`;
    },
    true,
  );
})();
