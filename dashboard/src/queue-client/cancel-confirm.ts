// The one thing this file does (spec 423): stop a Cancel press from
// reaching the server until the reader has confirmed it in the dialog
// `row-controls.ts` now draws beside the form. Delegated on `#jobrows`,
// not bound per element the way `bindScheduleDelete` is — this page's
// own rows are replaced wholesale on every five-second poll
// (`row-swap.ts`), which a per-element binding would not survive.
//
// Registered on `#jobrows` BEFORE `submitAction` (`queue-client.ts`), so
// its own `preventDefault()` is seen by that listener's `if
// (event.defaultPrevented) return;` guard (`forms.ts:23`) — same
// element, same event type, same-type listeners run in registration
// order.

export function interceptCancelSubmit(event: Event): void {
  const form = (event.target as Element | null)?.closest?.("form.cancelform") as HTMLFormElement | null;
  if (!form || event.defaultPrevented) return;
  // The dialog is the outer form's own sibling — both are written by
  // the same `actionForm()` call into the same cell — never a
  // page-wide lookup, which would open the first row's dialog from
  // every row's press.
  const dialog = form.parentElement?.querySelector("dialog.confirmdialog") as HTMLDialogElement | null;
  if (!dialog || typeof dialog.showModal !== "function") return;
  event.preventDefault();
  dialog.showModal();
}
