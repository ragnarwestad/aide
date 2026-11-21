// The Config tab's settings: one card per settings file, each its own form
// with a row per setting and Save and Cancel at its foot. Every field is
// editable as the tab opens; Save posts only that card's settings.

import type { PreviewFrom } from "../../../project/parse-manifest.ts";
import {
  EDITABLE_FIELD,
  SETTING_GROUPS,
  type ProjectSettingsView,
  type SettingRow,
  type SettingsGroupFile,
} from "../../../project/project-settings.ts";
import { settingLabel } from "../../../project/setting-labels.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { formatSentence } from "../../../messages/format.ts";
import { btn, cardRow, cardSection, messageSlot, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import type { ProjectPageOptions } from "./types.ts";

/** The test command's explanation when nothing is configured. A run and a
 *  landing test with a configured command ONLY (`aide-resolve-test-cmd`),
 *  so a worked-out one runs nothing: the row says so, and names the
 *  worked-out command as the suggestion the field offers. */
function unsetTestComment(r: SettingRow, lang: Language): string {
  const none = esc(t(lang, "setting.noTests"));
  if (r.origin !== "derived" || r.value === null) return none;
  // The command is placed into the sentence after escaping, as a `<code>`.
  const MARK = "\u0000";
  const suggested = esc(t(lang, "setting.suggested", { source: r.source ?? "", toolchain: r.toolchain ?? "", command: MARK }))
    .replace(MARK, `<code>${esc(r.value)}</code>`);
  return `${none}. ${suggested}`;
}

/** `defaultBranch` is the project's OWN branch name, off `origin/HEAD`
 *  — "the default branch" is GitHub's term for it, not a name anybody
 *  reading this row is looking at. `null` where there is no name to
 *  give: the checkout could not be asked, or — the Add form — the
 *  project is not on this machine yet.
 *
 *  "Create", not "leave it for": a `pr` landing runs `gh pr create`
 *  (`aide-run-spec`), so the pull request is made for you. */
export const codeLandingChoices = (
  defaultBranch: string | null, lang: Language = "en",
): { value: "merge" | "pr"; label: string }[] => [
  {
    value: "merge",
    label: t(lang, "setting.landing.merge", { branch: defaultBranch ?? t(lang, "setting.landing.mainBranch") }),
  },
  { value: "pr", label: t(lang, "setting.landing.pr") },
];

/** The words for the three ways a branch can be tried, in the order the
 *  parser lists them (`PREVIEW_FROMS`). The values are what the manifest
 *  stores and are not translated along with the labels. */
export const previewFromChoices = (lang: Language = "en"): { value: PreviewFrom; label: string }[] => [
  { value: "none", label: t(lang, "setting.preview.none") },
  { value: "command", label: t(lang, "setting.preview.command") },
  { value: "cloudflare-pages", label: t(lang, "setting.preview.cloudflare") },
];

/** The placeholder each text setting's field shows while it is empty. */
const PLACEHOLDER: Partial<Record<string, TranslationKey>> = {
  AIDE_SPECS_PATH: "setting.ph.specsPath",
  description: "setting.ph.description",
  acPrefix: "setting.ph.acPrefix",
  icon: "setting.ph.icon",
};

/** A setting's field: a one-line `<textarea data-oneline>` holding the
 *  row's own value. A textarea wraps a long value, which an `<input>`
 *  cannot; `bindOneLineFields` gives back what the input did (growth,
 *  Enter to save, no line break). */
function settingField(r: SettingRow, opts: ProjectPageOptions, lang: Language): string {
  // The test command: only a CONFIGURED value fills the field. A
  // worked-out one is the placeholder, so a save that never touched the
  // row does not quietly configure it.
  if (r.key === "AIDE_TEST_CMD" && r.origin !== "configured") {
    const hint = r.origin === "derived" && r.value ? ` placeholder="${esc(r.value)}"` : "";
    return `<textarea name="testCmd" data-oneline rows="1" maxlength="300"${hint}></textarea>`;
  }
  const field = EDITABLE_FIELD[r.key]!;
  const value = esc(r.value ?? "");
  if (r.key === "worktreeLinks") {
    // A `<datalist>` cannot be attached to a textarea, so the
    // candidates are text under the field, in the order and spacing a
    // value is typed.
    return (
      `<textarea name="${field}" data-oneline rows="1" maxlength="300" ` +
      `placeholder="${esc(t(lang, "setting.ph.worktreeLinks"))}">${value}</textarea>` +
      (opts.worktreeLinkCandidates.length
        ? `<span class="muted">${esc(t(lang, "setting.suggestedLinks", { list: opts.worktreeLinkCandidates.join(" ") }))}</span>`
        : "")
    );
  }
  const ph = PLACEHOLDER[r.key];
  const placeholder = ph ? ` placeholder="${esc(t(lang, ph))}"` : "";
  // The description's limit is Add's own, 500; every other row keeps 300.
  const maxlength = r.key === "description" ? 500 : 300;
  return `<textarea name="${field}" data-oneline rows="1" maxlength="${maxlength}"${placeholder}>${value}</textarea>`;
}

/** One setting's row: its name and key, what it is for and any problem
 *  with its value, and its field. */
function settingRow(r: SettingRow, opts: ProjectPageOptions, lang: Language): string {
  // A value that does not resolve is marked where it is shown, in
  // readiness's own sentence — never a second wording of the same fact
  // (`project-settings.ts` reads it verbatim). The check's `blocking`
  // flag decides the kind here exactly as it does above the cards.
  const problem = r.problem
    ? rowMessage(r.problem.blocking ? "failed" : "waiting", formatSentence(lang, r.problem.message ?? r.problem.text) ?? r.problem.text)
    : "";
  const unsetTest = r.key === "AIDE_TEST_CMD" && r.origin !== "configured";
  const purpose = [esc(t(lang, `setting.purpose.${r.key}` as TranslationKey)), unsetTest ? unsetTestComment(r, lang) : ""]
    .filter(Boolean)
    .join(" — ");
  return cardRow({
    title: esc(settingLabel(r.key, lang)),
    sub: r.key,
    explain: purpose + problem,
    control: settingField(r, opts, lang),
  });
}

/** A setting that is a choice of fixed values: a `<select>`. Not a
 *  `SettingRow` — it has no `key`/`origin` of its own, only what its
 *  resolver answers. */
function choiceRow(
  label: string,
  name: string,
  choices: { value: string; label: string }[],
  current: string,
  purpose: string,
): string {
  const select = `<select name="${name}">${choices.map(
    (o) => `<option value="${o.value}"${current === o.value ? " selected" : ""}>${esc(o.label)}</option>`,
  ).join("")}</select>`;
  return cardRow({ title: esc(label), explain: esc(purpose), control: select });
}

/** The manifest card's own file name: the project's tracked
 *  `.aide/project.yaml`, or the dashboard's own `settings.yaml` when the
 *  project tracks none — said once, in the card's heading. */
function manifestFileHeading(home: ProjectPageOptions["settingsHome"], lang: Language): string {
  return home === "dashboard" ? t(lang, "setting.dashboardFile") : ".aide/project.yaml";
}

/** The name each card's Save and Cancel ids start with, which the page
 *  script finds them by (`spec-form-actions.ts`, `data-actions-id`). */
const CARD_ID: Record<SettingsGroupFile, string> = {
  ".aide/config": "projectsettingsform-config",
  manifest: "projectsettingsform-manifest",
};

/** The Config tab's two settings cards, one form each. A form posts only
 *  its own card's fields, and the route stores only what a post carries,
 *  so Save stores only that card. Cancel is a reset: it puts the card's
 *  fields back to the values they were drawn with, its saved values. A
 *  card's form stays guarded against leaving until its Save went through
 *  (`data-dirty-until-saved`, `unsaved-changes.ts`). */
export function unifiedSettingsTable(
  settings: ProjectSettingsView,
  name: string,
  opts: ProjectPageOptions,
): string {
  const lang = opts.lang ?? "en";
  const rowFor = (key: string): SettingRow | undefined => settings.rows.find((r) => r.key === key);
  const action = `/api/queue/projects/${esc(encodeURIComponent(name))}/settings`;
  return SETTING_GROUPS.map((group) => {
    const id = CARD_ID[group.file];
    const rows = group.keys
      .map((key) => rowFor(key))
      .filter((r): r is SettingRow => r !== undefined)
      .map((r) => settingRow(r, opts, lang))
      .join("");
    const choices =
      group.file === "manifest"
        ? choiceRow(
            t(lang, "setting.label.codeLanding"), "codeLanding",
            codeLandingChoices(opts.defaultBranch ?? null, lang), opts.codeLanding ?? "merge",
            t(lang, "setting.purpose.codeLanding"),
          ) +
          choiceRow(
            t(lang, "setting.label.previewFrom"), "previewFrom", previewFromChoices(lang), opts.previewFrom ?? "none",
            t(lang, "setting.purpose.previewFrom"),
          )
        : "";
    const heading = group.file === ".aide/config" ? ".aide/config" : manifestFileHeading(opts.settingsHome, lang);
    const foot =
      btn({ id: `${id}-save`, label: t(lang, "list.checksSave"), variant: "primary", pending: t(lang, "list.checksSaving") }) +
      btn({ id: `${id}-cancel`, label: t(lang, "dialog.cancel"), type: "reset" }) +
      messageSlot("refused");
    return (
      `<form method="post" action="${action}" class="pageform projectsettingsform" data-actions-id="${id}" data-dirty-until-saved>` +
      cardSection({ heading, body: rows + choices, foot }) +
      `</form>`
    );
  }).join("");
}
