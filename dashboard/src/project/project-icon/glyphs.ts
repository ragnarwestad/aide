// The board's built-in project icons: a fixed set of stroke drawings on a
// 24 × 24 view box, drawn in `currentColor` so the square they sit on — one
// of the six initials colours — decides how they look in either theme.

const GLYPHS = {
  rocket: `<path d="M12 3c3 2 5 5.5 5 9.5L15 16H9l-2-3.5C7 8.5 9 5 12 3Z"/><circle cx="12" cy="10" r="1.5"/><path d="M9 16l-2 4 3-1.5M15 16l2 4-3-1.5"/>`,
  star: `<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9Z"/>`,
  heart: `<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/>`,
  bolt: `<path d="M13 3L5 13.5h6L10 21l8-10.5h-6Z"/>`,
  leaf: `<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14Z"/><path d="M5 19l8-8"/>`,
  cube: `<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>`,
  globe: `<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5Z"/>`,
  code: `<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14"/>`,
  book: `<path d="M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3Z"/><path d="M5 16.5a3 3 0 0 1 3-3h10.5"/>`,
  flag: `<path d="M5 21V4M5 4.5h11l-2 4 2 4H5"/>`,
  bell: `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>`,
  cloud: `<path d="M7.5 18.5a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5 3.3 3.3 0 0 1-.6 6.5Z"/>`,
  music: `<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>`,
  camera: `<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4Z"/><circle cx="12" cy="13" r="3.5"/>`,
  map: `<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2Z"/><path d="M9 4.5v13M15 6.5v13"/>`,
  terminal: `<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4"/>`,
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** Every built-in icon's name, in the order the picker offers them. */
export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

export function isGlyph(name: string): name is GlyphName {
  return Object.hasOwn(GLYPHS, name);
}

/** The built-in icon `name` as inline SVG, or "" for a name not in the set. */
export function glyphSvg(name: string): string {
  if (!isGlyph(name)) return "";
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`
  );
}
