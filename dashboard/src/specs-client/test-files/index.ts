// The files under an acceptance criterion the reader has open
// (`render/ui/ac-tests.ts`). The server always draws a file shut, so a
// redraw of the list would shut it again; the page script reads which are
// open just before the swap and opens them after.

const FOLD = "details[data-testcriterion]";

/** The criterion test folds the reader has open, by `data-testcriterion`. */
export function openTestFiles(body: ParentNode): Set<string> {
  const open = new Set<string>();
  for (const el of body.querySelectorAll(FOLD)) {
    if ((el as HTMLDetailsElement).open) open.add(el.getAttribute("data-testcriterion")!);
  }
  return open;
}

/** Opens each fold whose `data-testcriterion` is in `keys`; a fold no longer drawn is passed over. */
export function reopenTestFiles(body: ParentNode, keys: ReadonlySet<string>): void {
  if (!keys.size) return;
  for (const el of body.querySelectorAll(FOLD)) {
    if (keys.has(el.getAttribute("data-testcriterion")!)) (el as HTMLDetailsElement).open = true;
  }
}
