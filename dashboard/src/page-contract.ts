export const SPEC_HEAD_CLASS = "spechead";
export const REFUSAL_ROW_TEMPLATE_ID = "refusal-row";
export const SPEC_LOADING_ROW_ID = "spec-loading-row";
export const SERVED_BY_META = "aide-served-by";
export const ROW_MESSAGE_CLASS = "rowmsg";

export const PAGE_LEAVE = "aide-page-leave";
export const PAGE_FETCHING = "aide-page-fetching";
export const PAGE_DRAWN = "aide-page-drawn";
export const SPEC_DETAIL_DRAWN = "spec-detail-drawn";

export const ACTION_FORM_SELECTOR = "form.rowrun, form.actionform";
export const FORM_HOOKS = [
  "actionform",
  "actionform schedulerun",
  "actionform reloadform",
  "reloadform",
  "removeform",
  "configactions reloadform",
] as const;
export type FormHook = (typeof FORM_HOOKS)[number];
export const FORM_ACTION_PREFIXES = [
  "specform", "settingsform", "providerform", "projectsettingsform", "scheduleform",
] as const;
export const TRACKED_FORM_SELECTOR =
  ".specform, .settingsform, .providerform, .pageform, .scheduleform";

export const SPINNER = '<span class="spin" aria-hidden="true"></span>';

export function compactModelLabels(
  configuredNames: readonly string[],
  chosen: { model: string; short: string } | undefined,
): { short: string; full: string } {
  if (!chosen) return { short: "", full: "" };
  const full = `${chosen.short} · ${chosen.model}`;
  const collides = configuredNames.filter((name) => name === chosen.model).length > 1;
  return { short: collides ? full : chosen.model, full };
}
