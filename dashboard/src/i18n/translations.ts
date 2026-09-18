// The type-level plumbing between the source language and every other
// one (spec 350). `TranslationKey` comes from `en.ts` alone — English is
// the source here (REQ-9), the opposite of PaceUp's own `nb`-as-source
// shape — so `nb.ts`'s `Record<TranslationKey, string>` is what makes an
// incomplete translation a compile error rather than a runtime gap.
import { en } from "./en.ts";
import { nb } from "./nb.ts";
import { es } from "./es.ts";
import { de } from "./de.ts";
import { fr } from "./fr.ts";

export type TranslationKey = keyof typeof en;
export type Language = "en" | "nb" | "es" | "de" | "fr";

export const translations = { en, nb, es, de, fr } as const;

// The one list every N-way language choice (the header menu, `http.ts`'s
// query/cookie validation) reads instead of naming languages by hand — a
// sixth language needs a line here and nowhere else (AC-4).
export const LANGUAGES = Object.keys(translations) as Language[];
