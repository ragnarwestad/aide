// The count and the over-the-bound line under the Description tab's editor.
// The editor types into a contenteditable surface, not a field, so the
// limits script (specs-client/limits) cannot draw them; they use its words
// and the same `data-limit` / `data-limit-note` look. Drawn after the raw
// textarea, never between it and the editor's mount, which the stylesheet
// reads as adjacent siblings.

import { DESCRIPTION_MAX, descriptionPart } from "../project/description-bound.ts";
import { countText, limitState, overText } from "../specs-client/limits/measure.ts";

const DESCRIPTION_FILE = "1-description.md";

export interface DescriptionCount {
  /** Count `fileText`'s description and draw it. True while it is over the bound. */
  show(fileText: string): boolean;
}

/** The count for the form `raw` sits in, or `null` when that form saves any
 *  file but `1-description.md`: the other tabs are never bounded. */
export function mountDescriptionCount(raw: HTMLTextAreaElement): DescriptionCount | null {
  const file = raw.form?.querySelector<HTMLInputElement>('input[name="file"]');
  if (file?.value !== DESCRIPTION_FILE) return null;
  const count = document.createElement("span");
  const note = document.createElement("span");
  note.setAttribute("data-limit-note", "");
  note.setAttribute("role", "status");
  return {
    show(fileText) {
      const part = descriptionPart(fileText);
      // A file with no Description heading has nothing to count.
      if (part === null) {
        count.remove();
        note.remove();
        return false;
      }
      if (!count.isConnected) raw.after(count, note);
      const length = part.length;
      const over = length > DESCRIPTION_MAX;
      count.textContent = countText(length, DESCRIPTION_MAX);
      count.setAttribute("data-limit", limitState(length, DESCRIPTION_MAX));
      note.textContent = over ? overText(length - DESCRIPTION_MAX, DESCRIPTION_MAX) : "";
      if (over) note.setAttribute("data-over", "");
      else note.removeAttribute("data-over");
      return over;
    },
  };
}
