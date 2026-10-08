// The reader's place across a swap: how far down the page is, how far from
// its end each log box is, and whether a selection sits in what would be
// replaced.

/** Where a log box was: at its end, or how far from its top. A box is laid out
 *  `column-reverse`, so its `scrollTop` is 0 at its end and runs negative (or,
 *  in an older browser, positive) as the reader scrolls up; the distance from
 *  the top is measured the same way either way. */
export interface BoxPlace {
  atEnd: boolean;
  fromTop: number;
  negative: boolean;
}

export const boxesIn = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".logbox")];

export function measureBox(box: HTMLElement): BoxPlace {
  const away = Math.abs(box.scrollTop);
  return { atEnd: away <= 1, fromTop: box.scrollHeight - box.clientHeight - away, negative: box.scrollTop <= 0 };
}

/** Put a box back where it was: at its end, or the same distance from its top. */
export function restoreBox(box: HTMLElement, place: BoxPlace): void {
  if (place.atEnd) {
    box.scrollTop = 0;
    return;
  }
  const away = Math.max(0, box.scrollHeight - box.clientHeight - place.fromTop);
  box.scrollTop = place.negative ? -away : away;
}

/** Whether a question (a `<dialog>`) is open inside `node`. */
export const dialogOpenIn = (node: ParentNode): boolean => node.querySelector("dialog[open]") !== null;

/** A non-collapsed selection that reaches into `node`. */
export function selectionHolds(win: Pick<Window, "getSelection"> | undefined, node: Node): boolean {
  const selection = win?.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let i = 0; i < selection.rangeCount; i++) if (selection.getRangeAt(i).intersectsNode(node)) return true;
  return false;
}
