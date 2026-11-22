// A Run dialog's "Run together with" list, put in when the dialog opens. The
// page holds each project's list once (`runPeerLists`, render/pages/specs-list)
// rather than one in every row's dialog; the dialog takes its project's and
// leaves its own spec out.

/** Fills `dialog`'s empty peer slot from its project's list on the page. */
export function fillRunPeers(dialog: Element): void {
  const slot = dialog.querySelector<HTMLElement>("[data-run-peers]");
  if (!slot || slot.childElementCount > 0) return;
  const list = [...dialog.ownerDocument.querySelectorAll<HTMLTemplateElement>("template[data-run-peers-of]")]
    .find((template) => template.dataset.runPeersOf === slot.dataset.runPeers);
  if (!list) return;
  const own = slot.dataset.runSelf;
  for (const label of list.content.querySelectorAll("label")) {
    if (label.querySelector<HTMLInputElement>('input[name="member"]')?.value === own) continue;
    slot.append(dialog.ownerDocument.importNode(label, true));
  }
}
