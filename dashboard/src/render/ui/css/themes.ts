export const THEMES = ["default", "maroon", "grove", "ocean", "ember", "iris"] as const;
export type Theme = (typeof THEMES)[number];
