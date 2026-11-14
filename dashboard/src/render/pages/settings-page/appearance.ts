import { t, type Language, type TranslationKey } from "../../../i18n";
import { esc } from "../../ui/html.ts";
import { radioCards } from "../../ui/components";
import { THEMES } from "../../ui/css/themes.ts";

export function appearancePanel(lang: Language): string {
  const schemes = ["light", "dark", "auto"] as const;
  const schemeCards = radioCards({ label: t(lang, "shell.colorScheme"), name: "colorscheme", cards: schemes.map((scheme) => ({
    value: scheme, checked: scheme === "auto", data: { "theme-choice": scheme },
    content: `<span class="schemepreview ${scheme}" aria-hidden="true"><i></i><i></i></span><strong>${esc(t(lang, `shell.theme${scheme[0]!.toUpperCase()}${scheme.slice(1)}` as TranslationKey))}</strong>`,
  })) });
  const themeCards = radioCards({ label: t(lang, "settings.appearance.themes"), name: "palette", cards: THEMES.map((theme) => ({
    value: theme, checked: theme === "default", data: { "palette-choice": "" },
    content: `<span class="themeswatches" data-palette="${theme}" aria-hidden="true"><i class="light"></i><i class="dark"></i></span>` +
      `<strong>${esc(t(lang, `settings.appearance.theme.${theme}` as TranslationKey))}</strong>`,
  })) });
  return `<section class="toolpanel appearancepanel"><h3>${esc(t(lang, "shell.colorScheme"))}</h3>${schemeCards}` +
    `<h3>${esc(t(lang, "settings.appearance.themes"))}</h3>${themeCards}</section>`;
}
