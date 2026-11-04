// The Accounts tab of Claude Code under Settings → AI: the Claude logins the
// board may run a step on. Default is the login the board uses today and is
// always listed first; every account a person added has its directory, a
// field to rename it and a Remove. Under the list is Add.

import { esc } from "../../ui/html.ts";
import { buttonForm, facts, messageSlot } from "../../ui/components";
import { t, type Language } from "../../../i18n";
import { rowForm } from "./models.ts";

export const ACCOUNTS_ADD_ROUTE = "/api/queue/settings/accounts/add";
export const ACCOUNTS_RENAME_ROUTE = "/api/queue/settings/accounts/rename";
export const ACCOUNTS_REMOVE_ROUTE = "/api/queue/settings/accounts/remove";

/** The default account's directory, as it is shown. */
const DEFAULT_DIR = "~/.claude";

const field = (id: string, name: string, label: string, extra = ""): string =>
  `<label for="${esc(id)}">${esc(label)}</label> <input id="${esc(id)}" name="${name}" type="text" required${extra}>`;

/** One account's row: its directory, then a form to give it a new name and
 *  a Remove. The ids carry the row's place, since a name may hold
 *  characters an id should not. */
function accountValue(name: string, dir: string, i: number, lang: Language): string {
  const rename = buttonForm({
    id: `accounts-rename-${i}`,
    action: ACCOUNTS_RENAME_ROUTE,
    hook: "reloadform",
    hidden: { name },
    before: field(`accounts-rename-${i}-name`, "newName", t(lang, "settings.accounts.newName"), ` maxlength="64" autocomplete="off"`),
    button: { id: `accounts-rename-${i}-run`, label: t(lang, "settings.accounts.rename"), pending: t(lang, "settings.accounts.renaming") },
    after: messageSlot("refused"),
  });
  const remove = rowForm(
    ACCOUNTS_REMOVE_ROUTE,
    `accounts-remove-${i}`,
    { name },
    { label: t(lang, "project.remove"), pending: t(lang, "dialog.removing") },
    name,
  );
  return `<code>${esc(dir)}</code> ${rename}${remove}`;
}

/** The tab: Default, every added account, and the form that adds one. */
export function accountsBlock(accounts: Record<string, { configDir: string }> | undefined, lang: Language = "en"): string {
  const added = Object.entries(accounts ?? {});
  const list = facts([
    { label: esc(t(lang, "settings.accounts.default")), value: `<code>${DEFAULT_DIR}</code>` },
    ...added.map(([name, a], i) => ({ label: esc(name), value: accountValue(name, a.configDir, i, lang) })),
  ]);
  const add = buttonForm({
    id: "accounts-add",
    action: ACCOUNTS_ADD_ROUTE,
    hook: "reloadform",
    before:
      `<p>${field("accounts-add-name", "name", t(lang, "settings.accounts.name"), ` maxlength="64" autocomplete="off"`)}</p>` +
      `<p>${field("accounts-add-dir", "configDir", t(lang, "settings.accounts.dir"), ` placeholder="~/.claude-2" autocomplete="off"`)}</p>`,
    button: { id: "accounts-add-run", label: t(lang, "settings.accounts.add"), variant: "primary", pending: t(lang, "settings.accounts.adding") },
    after: messageSlot("refused"),
  });
  return (
    `<p>${esc(t(lang, "settings.accounts.intro"))}</p>` +
    list +
    (added.length ? "" : `<p class="muted">${esc(t(lang, "settings.accounts.none"))}</p>`) +
    `<h3>${esc(t(lang, "settings.accounts.addHeading"))}</h3>` +
    add
  );
}
