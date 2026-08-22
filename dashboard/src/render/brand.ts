// The Aide mark: three bars, one tone, darkest to lightest — analyze,
// implement, archive. The order is carried by the colour, so the mark
// reads as a direction and not just as three shapes.
//
// Three bars, not four (spec 181): `review-plan` folded into `analyze`
// and is no longer a phase of its own, so the mark that used to stand
// for four workflow phases now stands for three.
//
// Everything here is a STRING, for the same reason css.ts is a string:
// the generated site is published as plain files by rsync, and a page
// that references /aide-mark.svg is a page that breaks the moment it is
// opened from a folder. Inline SVG in the nav, data URIs for the icons,
// no second request.

const LIGHT = ["#6B1D0C", "#D8492A", "#E8A491"];
const DARK = ["#8E2A12", "#F0663F", "#F5B7A3"];

// Bars are 9px wide on the 64 grid, 10px below 32px — otherwise the
// lightest one disappears. That is the only permitted deviation.
function bars(c: string[], w: number): string {
  const r = w / 2;
  return (
    `<rect x="14" y="26" width="${w}" height="12" rx="${r}" fill="${c[0]}"/>` +
    `<rect x="32" y="14" width="${w}" height="36" rx="${r}" fill="${c[1]}"/>` +
    `<rect x="50" y="26" width="${w}" height="12" rx="${r}" fill="${c[2]}"/>`
  );
}

function svg(c: string[], w: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bars(c, w)}</svg>`;
}

const dataUri = (c: string[]) => `data:image/svg+xml,${encodeURIComponent(svg(c, 10))}`;

/** The mark at nav size, both themes. The dark copy is hidden by
 *  default and swapped by the media query in css.ts — `content: url()`
 *  would need a file, and there is no file. */
export const MARK = `<span class="mark" aria-hidden="true">` +
  `<span class="mark-l">${svg(LIGHT, 9)}</span>` +
  `<span class="mark-d">${svg(DARK, 9)}</span>` +
  `</span>`;

/** Goes in <head>. Two icons with fixed fills rather than one with a
 *  prefers-color-scheme block inside it: favicon tooling strips <style>
 *  from SVGs, and the mark then renders as four black bars. */
export const ICON_LINKS =
  `<link rel="icon" href="${dataUri(LIGHT)}">\n` +
  `<link rel="icon" href="${dataUri(DARK)}" media="(prefers-color-scheme: dark)">`;

/** The wordmark, for the top of the nav.
 *
 *  The MARK is aide's and unchanged — the CLI and this page are one
 *  product. What the surface name adds is which of the two you are
 *  looking at: `-board`, in the ordinary weight and `--muted`, one word
 *  space from the name and tight against the dash, so the two read as
 *  one token — the shape a CLI flag has, which on a tool that IS a CLI
 *  is the joke rather than a misreading. Spoken "aide dash board".
 *
 *  The dash is deliberately NOT accented: in the accent it became the
 *  first thing the eye found, ahead of the `i`, and the `i` is the pun
 *  that carries the meaning. Two red marks, and the one that matters
 *  loses. */
export const WORDMARK =
  `<a class="brand" href="/">${MARK}` +
  `<span>a<i>i</i>de <span class="surface">-board</span></span></a>`;

/** The bounding box `bars()` actually covers on the 64 grid: x 14 to
 *  59, y 14 to 50. Written down because the icons below centre the
 *  MARK on the canvas, not the grid — the bars sit 14 units in from
 *  the left and 5 from the right, which nobody can see at favicon size
 *  and everybody can see at 512. */
const BBOX = { x0: 14, x1: 59, y0: 14, y1: 50 };

/** The mark as an app icon: the same three bars, centred on a filled
 *  canvas, for a launcher rather than a tab.
 *
 *  `fit` is how much of the canvas the mark takes. The bars are not
 *  redrawn at any of it — `bars()` stays the one description of the
 *  mark's shape, and the group around them is moved and scaled whole.
 *  The canvas colour comes from the caller: it is the PAGE's
 *  background, and that lives in `css.ts` with the rest of the tokens,
 *  not here with the brand's own four. */
function icon(background: string, fit: number): string {
  const round = (v: number) => Number(v.toFixed(2));
  const tx = round(32 - fit * ((BBOX.x0 + BBOX.x1) / 2));
  const ty = round(32 - fit * ((BBOX.y0 + BBOX.y1) / 2));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${background}"/>` +
    `<g transform="translate(${tx} ${ty}) scale(${fit})">${bars(LIGHT, 9)}</g>` +
    `</svg>`
  );
}

/** For the manifest's `any` purpose, and for iOS, which draws the icon
 *  as given and rounds the corners itself. */
export const appIcon = (background: string): string => icon(background, 0.86);

/** For the manifest's `maskable` purpose: the OS may crop this one to
 *  a circle or a squircle, so the mark keeps well clear of the edges.
 *  Same bars, less of the canvas. */
export const appIconMaskable = (background: string): string => icon(background, 0.7);
