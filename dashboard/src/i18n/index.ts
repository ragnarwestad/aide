// The one function every render function that draws user-facing text
// reaches for (spec 350). No `LanguageContext`/`useTranslation` hook,
// unlike PaceUp's own barrel: `lang` is resolved once per request,
// server-side, so a plain function taking it as its first argument is
// the whole of what PaceUp's hook gave it that this has any use for.
export type { Language, TranslationKey } from "./translations.ts";

import { translations, type Language, type TranslationKey } from "./translations.ts";

export function t(
  lang: Language,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let text: string = translations[lang][key];
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
