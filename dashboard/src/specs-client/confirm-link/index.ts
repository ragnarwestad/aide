// A link with a confirmation box beside it: the click opens the box over the
// page instead of following the link. The link's `href` is the confirmation
// PAGE and stays exactly that with no script: this only intercepts the click
// where a dialog can actually be opened. Used by the schedule's Delete and
// by Close on the spec page.

// The dialog is looked up in the link's own parent, because a list has one per
// row: a page-wide lookup would open the first row's box from every row's link.
export function bindConfirmLink(link: HTMLAnchorElement): void {
  const box = link.parentElement?.querySelector("dialog") as HTMLDialogElement | null;
  if (!box || typeof box.showModal !== "function") return;
  link.addEventListener("click", (event: Event) => {
    event.preventDefault();
    box.showModal();
  });
}
