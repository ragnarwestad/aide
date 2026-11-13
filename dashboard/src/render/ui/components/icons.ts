// The inline SVGs the pages draw, and the one spinner.
//
// Split out of components.ts 2026-09-04 (510 lines). Every icon is
// unchanged and keeps its name; a colour is never the only signal,
// which is why each state has a SHAPE of its own here.

import type { ProviderTool } from "../../../queue/providers/tools.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { esc } from "../html.ts";
import { TOOL_ICONS as CONTRACT_TOOL_ICONS, toolIcon } from "../../../page-contract.ts";
export { SPINNER } from "../../../page-contract.ts";



// --- icons -------------------------------------------------------------------

// Inline, like everything else here: the generated site is published as
// plain files by rsync and has to work opened from a folder, so there
// is no second request to make.

/** A finished phase. */
export const ICON_CHECK =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M3 8.5l3 3 7-7"></path></svg>`;

/** A control that will not take a click, and says why in its `title`. */
export const ICON_LOCK =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" aria-hidden="true">` +
  `<rect x="3.5" y="7" width="9" height="6" rx="1"></rect>` +
  `<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"></path></svg>`;

/** The mark on a refusal or a warning. Colour is never the only signal:
 *  a reader who cannot tell red from amber still sees this. */
export const ICON_WARN =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M8 2.5l6 11H2z"></path><path d="M8 6.5v3.2M8 12h.01"></path></svg>`;

/** Something is happening. A span, not an SVG: it is one CSS rotation. */
/** The spec page's PDF control: Bootstrap Icons' `file-earmark-pdf`
 *  (MIT), a document with the PDF mark on it — the one icon here that
 *  is NOT stroke-only and NOT the text colour: it is filled, and red,
 *  the way a PDF is recognised everywhere else (`.icon-pdf`, button.css).
 *  Sized on the tag: it sits in an `.iconlink`, where no CSS sizes it. */
export const ICON_PDF =
  `<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" class="icon-pdf" aria-hidden="true">` +
  `<path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2M9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5z"></path>` +
  `<path d="M4.603 14.087a.8.8 0 0 1-.438-.42c-.195-.388-.13-.776.08-1.102.198-.307.526-.568.897-.787a7.7 7.7 0 0 1 1.482-.645 20 20 0 0 0 1.062-2.227 7.3 7.3 0 0 1-.43-1.295c-.086-.4-.119-.796-.046-1.136.075-.354.274-.672.65-.823.192-.077.4-.12.602-.077a.7.7 0 0 1 .477.365c.088.164.12.356.127.538.007.188-.012.396-.047.614-.084.51-.27 1.134-.52 1.794a11 11 0 0 0 .98 1.686 5.8 5.8 0 0 1 1.334.05c.364.066.734.195.96.465.12.144.193.32.2.518.007.192-.047.382-.138.563a1.04 1.04 0 0 1-.354.416.86.86 0 0 1-.51.138c-.331-.014-.654-.196-.933-.417a5.7 5.7 0 0 1-.911-.95 11.7 11.7 0 0 0-1.997.406 11.3 11.3 0 0 1-1.02 1.51c-.292.35-.609.656-.927.787a.8.8 0 0 1-.58.029m1.379-1.901q-.25.115-.459.238c-.328.194-.541.383-.647.547-.094.145-.096.25-.04.361q.016.032.026.044l.035-.012c.137-.056.355-.235.635-.572a8 8 0 0 0 .45-.606m1.64-1.33a13 13 0 0 1 1.01-.193 12 12 0 0 1-.51-.858 21 21 0 0 1-.5 1.05zm2.446.45q.226.245.435.41c.24.19.407.253.498.256a.1.1 0 0 0 .07-.015.3.3 0 0 0 .094-.125.44.44 0 0 0 .059-.2.1.1 0 0 0-.026-.063c-.052-.062-.2-.152-.518-.209a4 4 0 0 0-.612-.053zM8.078 7.8a7 7 0 0 0 .2-.828q.046-.282.038-.465a.6.6 0 0 0-.032-.198.5.5 0 0 0-.145.04c-.087.035-.158.106-.196.283-.04.192-.03.469.046.822q.036.167.09.346z"></path></svg>`;

/** One chevron for every fold control on the site — the specs list's own
 *  row, a phase, and (on the Steps tab) a step's own log.
 *  Shared rather than redefined per file: the `.fold`/`.fold.shut`
 *  rotate-in-CSS pair in css.ts is already one shared pattern, and a
 *  second copy of the SVG that drew it would be the same shape of
 *  duplication one layer up. Stroke-based so it takes the text colour
 *  and scales with the flat. */
export const ICON_CHEVRON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 6l4 4 4-4"></path></svg>';

/** A magnifying glass, left-aligned inside the specs-search field
 *  (design handoff, 2026-08-25) — same inline-SVG, stroke-only pattern
 *  as `ICON_CHEVRON`. */
export const ICON_SEARCH =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6">' +
  '<circle cx="7" cy="7" r="4.5"></circle><path d="M10.5 10.5L14 14" stroke-linecap="round"></path></svg>';

/** The header's theme switch: a sun, a crescent moon, and a half-filled circle for Auto. */
export const ICON_THEME_DARK =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.2 4.2 0 0 0 6.5 6.5z"></path></svg>';

export const ICON_THEME_LIGHT =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<circle cx="8" cy="8" r="3"></circle>' +
  '<path d="M8 1.5v1.5M8 13v1.5M2.5 8H1M15 8h-1.5M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1"></path></svg>';

export const ICON_THEME_AUTO =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6">' +
  '<circle cx="8" cy="8" r="5.5"></circle>' +
  '<path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"></path></svg>';

export const ICON_USAGE =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<path d="M3 11a5.5 5.5 0 1 1 10 0"></path><path d="M8 8l3-2"></path></svg>';

/** The cross that closes a dialog: the About box's. */
export const ICON_CLOSE =
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ` +
  `stroke="currentColor" stroke-width="1.8" stroke-linecap="round">` +
  `<path d="M4 4l8 8M12 4l-8 8"></path></svg>`;

export const ICON_MORE =
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">` +
  `<circle cx="8" cy="3" r="1.4"></circle><circle cx="8" cy="8" r="1.4"></circle>` +
  `<circle cx="8" cy="13" r="1.4"></circle></svg>`;

export type RowKind = "spec" | "deploy" | "schedule" | "cleanup" | "group";

const stroke = (body: string): string =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const KIND_ICONS: Record<RowKind, string> = {
  spec: stroke('<path d="M4 2.5h5l3 3V13.5H4zM9 2.5v3h3"></path>'),
  deploy: stroke('<path d="M8 10.5v-8M5 5.5l3-3 3 3M3 9.5v4h10v-4"></path>'),
  schedule: stroke('<rect x="2.5" y="3.5" width="11" height="10" rx="1"></rect><path d="M5 2v3M11 2v3M2.5 6.5h11M5 9h2M9 9h2M5 11.5h2"></path>'),
  cleanup: stroke('<path d="M6.5 2.5h3l.5 4H6zM5.5 6.5h5l1.5 7H4zM6 10h4"></path>'),
  group: stroke('<path d="M3 3h10v3H3zM4.5 6v3h7V6M6 9v3h4V9"></path>'),
};

const KIND_KEYS: Record<RowKind, TranslationKey> = {
  spec: "jobs.kindSpec",
  deploy: "jobs.kindDeploy",
  schedule: "jobs.kindSchedule",
  cleanup: "jobs.kindCleanup",
  group: "jobs.kindGroup",
};

export function kindIcon(kind: RowKind, lang: Language = "en"): string {
  const label = t(lang, KIND_KEYS[kind]);
  return `<span class="kindicon" data-kind="${kind}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${KIND_ICONS[kind]}</span>`;
}

export type SiteTab = "jobs" | "specs" | "projects" | "schedule";

export const TAB_ICONS: Record<SiteTab, string> = {
  jobs: stroke('<path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5M2.75 4.5h.5M2.75 8h.5M2.75 11.5h.5"></path>'),
  specs: KIND_ICONS.spec,
  projects: stroke('<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"></path>'),
  schedule: KIND_ICONS.schedule,
};

export function tabIcon(tab: SiteTab): string {
  return `<span class="kindicon" data-tab="${tab}" aria-hidden="true">${TAB_ICONS[tab]}</span>`;
}

/** The three tools' marks, written once in the page contract so the browser
 *  can draw them too; typed here by the tools a provider runs, so a tool
 *  with no mark fails the type check. */
export const TOOL_ICONS: Record<ProviderTool, string> = CONTRACT_TOOL_ICONS;
export { toolIcon };

/** A provider as a closed picker names it: its tool's mark and its short
 *  name, hidden from a screen reader, since the select it lies over says
 *  the provider's full name. The mark alone without a short name, the
 *  short name alone without a tool. */
export function providerFace(tool: ProviderTool | undefined, short: string | undefined): string {
  return (
    `<span class="providerface" aria-hidden="true">` +
    (tool ? toolIcon(tool) : "") +
    (short ? `<span class="providershort">${esc(short)}</span>` : "") +
    `</span>`
  );
}

/** A provider select with the face of the provider it shows laid over its
 *  own text, which the stylesheet hides. The browser redraws the face when
 *  the select's value changes (`paintProviderFace`). */
export function providerPick(select: string, tool: ProviderTool | undefined, short: string | undefined): string {
  return `<span class="providerpick">${providerFace(tool, short)}${select}</span>`;
}
