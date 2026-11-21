// A project's icon: the image the server serves for it, or, for a project
// with none, its first two letters on a square whose colour is fixed by its
// name. Always an `<img>` for an image, so nothing in the file runs here.

import { esc } from "../../html.ts";

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

/** The icon, before a project's name. `icon` is where the server answers
 *  with its image, or null for a project that has none. */
export function projectIcon(name: string, icon: { src: string } | null): string {
  if (icon) return `<img class="projicon" src="${esc(icon.src)}" alt="" width="28" height="28">`;
  return `<span class="projicon projinitials" data-hue="${initialsHue(name)}" aria-hidden="true">${esc(projectInitials(name))}</span>`;
}
