// The Add spec dialog's form on a group's card on the Jobs tab
// (`addToGroupDialog()` draws it): a dialog that closes starts over empty.

import { writeLine } from "../press.ts";

/** A `close` event from a dialog that holds an Add spec form: the form is
 *  emptied, its reason with it. Says whether the event was such a dialog's. */
export function closeGroupAddDialog(event: Event): boolean {
  const form = (event.target as Element | null)?.querySelector?.("form[data-group-add]") as HTMLFormElement | null;
  if (!form) return false;
  form.reset();
  writeLine(form.querySelector(".refused"), "");
  return true;
}
