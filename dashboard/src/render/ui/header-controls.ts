// The header's theme and language controls (spec 475): split out of
// shell.ts, which sits at the 500-line cap code-health-limits.test.ts
// enforces, so marking which option is chosen had somewhere to add its
// checkmark and its heading.
import { LANGUAGES, t, type Language, type TranslationKey } from "../../i18n";
import { esc } from "./html.ts";
import { ICON_CHECK, ICON_THEME_AUTO, ICON_THEME_DARK, ICON_THEME_LIGHT } from "./components";

// Dark, Light, Auto. Not tabs: they are not a page to go to, so they
// sit inside the "…" menu rather than in the tab bar, and mark the
// chosen one with `aria-current` rather than the `current` class,
// which means "the page you are on".
const THEME_CHOICES: [string, string][] = [["dark", "Dark"], ["light", "Light"], ["auto", "Auto"]];

// Each language's own flag — PaceUp's own picker (`ViewControls.tsx`)
// draws every choice as a flag plus a name, never a bare two-letter
// code (REQ-1, spec 409).
const LANGUAGE_FLAGS: Record<Language, string> = {
  en: "🇬🇧", nb: "🇳🇴", es: "🇪🇸", de: "🇩🇪", fr: "🇫🇷",
};
// Each language's OWN name, in its own spelling — never translated into
// the reader's language (spec 484, AC-1, reversing spec 413's own
// choice): "Español" reads "Español" whether the reader has chosen
// English, Norwegian or Spanish itself.
const LANGUAGE_NATIVE_NAMES: Record<Language, string> = {
  en: "English", nb: "Norsk", es: "Español", de: "Deutsch", fr: "Français",
};

// Icons keyed by choice — the header control below draws no text label
// of its own, so the icon is what says which button is which (the
// `aria-label`/`title` on each button carry the same word for anyone
// who cannot see the icon).
const THEME_ICONS: Record<string, string> = {
  dark: ICON_THEME_DARK, light: ICON_THEME_LIGHT, auto: ICON_THEME_AUTO,
};

// Auto is marked here, on the row AND on the trigger's icon, because the
// server has no way to know what this reader picked — theme-script.ts
// moves both once it does, the same mark() call doing the row's
// aria-current and the trigger's icon together. Module-scoped (spec
// 436), not function-local: themeChoiceRows() needs to read it too, and
// a function-local const is invisible outside its own function.
const THEME_LABELS: Record<string, TranslationKey> = {
  dark: "shell.themeDark", light: "shell.themeLight", auto: "shell.themeAuto",
};

// The check mark beside the chosen row (spec 475, AC-1/AC-2): always
// rendered — `.menucheck`'s own CSS hides it by opacity, never
// `display`, so AC-3's reserved column holds whether the mark shows or
// not. `ICON_CHECK` carries no width/height of its own, the same as
// every other icon here — `.menucheck` sizes it (rows-and-forms.css).
function checkMark(): string {
  return `<span class="menucheck">${ICON_CHECK}</span>`;
}

// The theme choice rows, shared (spec 436) by themeControl()'s own
// standalone panel (desktop) and the "…" menu's flat mobile copy — the
// same markup either way, so a reader's choice looks identical wherever
// it is reached from.
export function themeChoiceRows(lang: Language): string {
  return THEME_CHOICES.map(
    ([choice]) =>
      `<button type="button" data-theme-choice="${choice}"` +
      `${choice === "auto" ? ' aria-current="true"' : ""}>${checkMark()}` +
      `${THEME_ICONS[choice]}<span>${t(lang, THEME_LABELS[choice]!)}</span></button>`,
  ).join("");
}

// The header-level switch (spec 243, moved out of the "…" menu; a
// popup of its own since PaceUp's own header is the reference for HOW,
// not just where — one icon that names the current choice, a dropdown
// underneath for the other two). Its own `.menu`, distinct from the
// "…" one, so it gets the same outside-click/Escape close for free:
// `menu-script.ts`'s `closeAll` already targets every `details.menu`,
// not one in particular.
export function themeControl(lang: Language): string {
  const trigger = THEME_CHOICES.map(
    ([choice]) =>
      `<span data-theme-icon="${choice}"${choice === "auto" ? "" : " hidden"}>${THEME_ICONS[choice]}</span>`,
  ).join("");
  const theme = t(lang, "shell.theme");
  return (
    `<details class="menu theme"><summary aria-label="${theme}" title="${theme}">${trigger}</summary>` +
    // `.lbl` (spec 475, AC-5): the caption class already built for this
    // ("Repos, Show, Theme, Units", text-roles.css) — first use of it
    // for either word.
    `<div class="menupanel"><span class="lbl">${theme}</span>${themeChoiceRows(lang)}</div>` +
    `</details>`
  );
}

// The header-level language switch (spec 350), beside the theme control
// (REQ-3) and built the same way: a `<details class="menu">` trigger +
// panel, so it gets the same outside-click/Escape close for free. Each
// link targets the CALLER's own current address — `pageShell`'s
// `currentUrl` opt — with only `lang` swapped, so switching language
// keeps the reader on the page, tab, sort and filter they were already
// on. Absent `currentUrl` (the two build-time pages in `projects-page.ts`,
// which have no request to read one from) falls back to `/`.
function languageHref(currentUrl: string, target: Language): string {
  const [path, search = ""] = currentUrl.split("?");
  const kept = search.split("&").filter((pair) => pair && !pair.startsWith("lang="));
  kept.push(`lang=${target}`);
  return esc(`${path}?${kept.join("&")}`);
}

// The language choice links, shared (spec 436) by languageControl()'s own
// standalone panel (desktop) and the "…" menu's flat mobile copy — the
// same markup either way, each targeting `currentUrl` with only `lang`
// swapped (spec 435), so switching language keeps the reader on the
// page, tab, sort and filter they were already on, wherever the link is
// reached from.
export function languageChoiceLinks(lang: Language, currentUrl: string): string {
  const choice = (l: Language) => `${checkMark()}${LANGUAGE_FLAGS[l]} ${LANGUAGE_NATIVE_NAMES[l]}`;
  return LANGUAGES.map(
    (l) =>
      `<a href="${languageHref(currentUrl, l)}"${l === lang ? ' aria-current="true"' : ""}>${choice(l)}</a>`,
  ).join("");
}

export function languageControl(lang: Language, currentUrl: string): string {
  const langLabel = t(lang, "shell.language");
  return (
    `<details class="menu lang"><summary aria-label="${langLabel}" title="${langLabel}">${LANGUAGE_FLAGS[lang]}</summary>` +
    `<div class="menupanel"><span class="lbl">${langLabel}</span>${languageChoiceLinks(lang, currentUrl)}</div></details>`
  );
}
