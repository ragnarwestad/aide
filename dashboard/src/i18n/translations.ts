// The type-level plumbing between the source language and every other
// one (spec 350). `TranslationKey` comes from `en.ts` alone — English is
// the source here (REQ-9), the opposite of PaceUp's own `nb`-as-source
// shape — so `nb.ts`'s `Record<TranslationKey, string>` is what makes an
// incomplete translation a compile error rather than a runtime gap.
import { en } from "./en.ts";
import { nb } from "./nb.ts";

export type TranslationKey = keyof typeof en;
export type Language = "en" | "nb";

export const translations = { en, nb } as const;
