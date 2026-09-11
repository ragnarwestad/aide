// Ticking a dependency lifts it to the picked block, and unticking it
// drops it back — without waiting for Save.
//
// The two blocks are one control (spec 404, REQ-3): the page renders
// the ticked ones above the scrolling list so what a spec depends on
// can be read without scrolling. That partition was server-rendered
// only, so a click changed nothing until the form was saved and the
// page came back — the reader ticked a box and the page said nothing
// had happened.
//
// Like nav-busy.ts and form-busy.ts, this file can neither import nor
// export anything: the shell transpiles it into the same inline classic
// <script>, which runs before the body is parsed. ONE listener on
// `document`, for the same reason — there are no boxes yet to attach to.
//
// A locked chip (an archived dependency) has no `name`, so it never
// matches the selector and cannot be moved.

(() => {
  document.addEventListener("change", (event: Event) => {
    const box = event.target as HTMLInputElement | null;
    if (box?.name !== "dependsOn") return;
    const chip = box.closest("[data-project]");
    const field = chip?.closest(".field");
    if (!chip || !field) return;
    const picked = field.querySelector(".phases.picked");
    const rest = field.querySelector(".phases:not(.picked)");
    const target = box.checked ? picked : rest;
    if (!target || chip.parentElement === target) return;
    target.appendChild(chip);
  });
})();
