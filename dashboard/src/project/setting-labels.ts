// The one place a setting's plain-language name is written down.
// Every surface that names a setting to a reader — the
// Config tab's row, its checkout-level notes, the Deploy tab and its
// refusal path — reads it from the catalogue (`setting.label.<key>`), so
// introducing or changing a label is an edit there rather than a hunt
// across pages. This is the English reading, for the sentences the server
// writes itself; a page reads the key in the reader's language.
import { t, type TranslationKey } from "../i18n";

const KEYS = [
  "AIDE_SPECS_PATH",
  "worktreeLinks",
  "AIDE_TEST_CMD",
  "acPrefix",
  "AIDE_INSTALL_CMD",
  "previewCmd",
  "description",
] as const;

export const SETTING_LABELS: Record<string, string> = Object.fromEntries(
  KEYS.map((key) => [key, t("en", `setting.label.${key}` as TranslationKey)]),
);

/** A setting's name in the reader's language, or the key itself when it has none. */
export const settingLabel = (
  key: string,
  lang: import("../i18n").Language,
): string =>
  (KEYS as readonly string[]).includes(key)
    ? t(lang, `setting.label.${key}` as TranslationKey)
    : key;
