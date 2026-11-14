// The Add dialog on the Providers tab, in three steps on one form: Provider,
// a card for each tool; Identity, the display name and the ID; and Config,
// the chosen tool's runtime fields and the command that logs the provider
// in on the serving host. The steps are switched by the page's script
// (`specs-client/provider-add`); every tool's fields are drawn disabled, and
// the script turns on the chosen tool's, so only those are posted. A save
// that works goes to the new provider; a refused one stays in step 3 with
// the reason. The dialog itself, its refusal line and its Cancel are the
// form dialog's (`formDialog()`).

import { esc } from "../../ui/html.ts";
import { btn, formDialog, radioCards, toolIcon } from "../../ui/components";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { PROVIDER_TOOLS } from "../../../queue/providers/index.ts";
import { TOOL_NAMES } from "../specs-list";
import { PROVIDERS_ADD_ROUTE, PROVIDERS_TAB_PATH } from "./providers.ts";
import { fieldRow, runtimeRows } from "./provider-detail.ts";

/** The dialog's id, which the Add buttons name with `data-ask`. */
export const PROVIDER_ADD_DIALOG = "provider-add";
const ID_PATTERN = "[A-Za-z0-9_\\-]{1,64}";
const STEPS: TranslationKey[] = ["settings.providers.stepProvider", "settings.providers.stepIdentity", "settings.providers.stepConfig"];

function toolCards(lang: Language): string {
  return radioCards({ label: t(lang, "settings.providers.chooseTool"), name: "tool", cards: PROVIDER_TOOLS.map((tool) => ({
    value: tool, required: true, content: toolIcon(tool) + `<span class="providertext"><strong>${esc(TOOL_NAMES[tool] ?? tool)}</strong>` +
      `<span class="muted small">${esc(t(lang, `settings.providers.card.${tool}` as TranslationKey))}</span></span>`,
  })) });
}

function identity(lang: Language): string {
  return (
    fieldRow({
      id: "provider-add-name", name: "name", label: t(lang, "settings.providers.displayName"),
      help: t(lang, "settings.providers.displayNameHelp"), value: "", extra: ` maxlength="64" required`,
    }) +
    fieldRow({
      id: "provider-add-id", name: "providerId", label: t(lang, "settings.providers.id"),
      help: t(lang, "settings.providers.idHelp"), value: "", extra: ` maxlength="64" pattern="${ID_PATTERN}" required`,
    })
  );
}

/** Every tool's fields, disabled until the script turns on the chosen one's. */
function config(lang: Language): string {
  return (
    PROVIDER_TOOLS.map((tool) =>
      `<div class="addtool" data-tool="${esc(tool)}" hidden><fieldset disabled>` +
      runtimeRows(tool, undefined, lang, `provider-add-${tool}`) +
      `</fieldset></div>`,
    ).join("") +
    `<div class="logincommand"><strong>${esc(t(lang, "settings.providers.loginCommand"))}</strong>` +
    `<span class="muted small">${esc(t(lang, "settings.providers.loginCommandHelp"))}</span>` +
    `<code data-login-command></code></div>`
  );
}

export function providerAddDialog(lang: Language): string {
  const step = (n: number, body: string): string =>
    `<section class="addstep" data-step="${n}"${n === 1 ? "" : " hidden"}>${body}</section>`;
  return formDialog(lang, {
    id: PROVIDER_ADD_DIALOG,
    title: t(lang, "settings.providers.addProvider"),
    action: PROVIDERS_ADD_ROUTE,
    hook: "reloadform",
    data: { done: `${PROVIDERS_TAB_PATH}&provider={key}` },
    fields:
      `<ol class="addsteps">${STEPS.map((k, i) => `<li data-step="${i + 1}"${i === 0 ? ` aria-current="step"` : ""}>${esc(t(lang, k))}</li>`).join("")}</ol>` +
      step(1, `<p class="muted">${esc(t(lang, "settings.providers.chooseTool"))}</p>` + toolCards(lang)) +
      step(2, identity(lang)) +
      step(3, config(lang)),
    save: { label: t(lang, "settings.providers.add"), pending: t(lang, "settings.providers.adding") },
    between:
      btn({ label: t(lang, "settings.providers.next"), variant: "primary", type: "button", data: { "add-next": "" } }) +
      btn({ label: t(lang, "nav.back"), type: "button", data: { "add-back": "" } }),
  });
}
