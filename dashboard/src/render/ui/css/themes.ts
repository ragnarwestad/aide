export const THEMES = ["ember", "mono", "maroon", "grove", "ocean", "iris"] as const;
export type Theme = (typeof THEMES)[number];
/** The theme a browser that has chosen none gets: the root token block's. */
export const DEFAULT_THEME: Theme = "ember";
/** A choice stored under an older name, read as the theme it became. */
export const RENAMED_THEMES: Readonly<Record<string, Theme>> = { default: "mono" };
