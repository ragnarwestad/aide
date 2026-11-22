// A project's icon: the image the server serves for it, or, for a project
// with none, its first two letters on a square whose colour is fixed by its
// name, or a built-in icon the reader chose, drawn on one of the same
// squares. Always an `<img>` for an image, so nothing in the file runs here.

import { glyphSvg } from "../../../../project/project-icon/glyphs.ts";
import { esc } from "../../html.ts";

/** What a page knows of a project's icon: where its image is served, a
 *  built-in icon and its colour, 1 to 6, or null to draw the initials. */
export type ProjectIconView = { src: string } | { glyph: string; hue: number } | null;

/** How many initials colours the tokens hold (`--initials-1` to `-6`). */
const HUES = 6;

/** The name's first two letters or digits, upper-cased; one where the name
 *  has only one. */
export function projectInitials(name: string): string {
  return (name.match(/[\p{L}\p{N}]/gu) ?? []).slice(0, 2).join("").toUpperCase();
}

/** Which of the six initials colours a name gets, 1 to 6: the same on every
 *  call for the same name. */
export function initialsHue(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return (hash % HUES) + 1;
}

/** The icon, before a project's name. */
export function projectIcon(name: string, icon: ProjectIconView): string {
  if (icon && "src" in icon) return `<img class="projicon" src="${esc(icon.src)}" alt="" width="28" height="28">`;
  if (icon) {
    return `<span class="projicon projinitials" data-hue="${Math.trunc(icon.hue)}" aria-hidden="true">${glyphSvg(icon.glyph)}</span>`;
  }
  return `<span class="projicon projinitials" data-hue="${initialsHue(name)}" aria-hidden="true">${esc(projectInitials(name))}</span>`;
}
