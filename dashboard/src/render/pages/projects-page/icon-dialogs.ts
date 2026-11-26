// The Config tab's icon row's own controls: the current icon, the word for
// where it comes from, Choose icon and Choose file, and Automatic while a
// choice is set. The two dialogs and Automatic's form are drawn after the
// settings cards, since a dialog's form cannot sit inside the card's form;
// all three post to `POST /projects/<name>/icon` and load the page again
// (`reloadform`), as the Providers page's Add does.

import { t, type Language, type TranslationKey } from "../../../i18n";
import { GLYPH_NAMES, glyphSvg } from "../../../project/project-icon/glyphs.ts";
import { askButton, btn, field, formDialog, initialsHue, messageSlot, projectIcon, radioCards } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import type { ProjectPageOptions } from "./types.ts";

export const ICON_GLYPH_DIALOG = "projecticon-glyph";
export const ICON_FILE_DIALOG = "projecticon-file";
const AUTOMATIC_FORM = "projecticon-automatic";
const AUTOMATIC_LINE = "projecticon-refused";

const iconAction = (name: string): string => `/projects/${encodeURIComponent(name)}/icon`;

const SOURCE_WORD: Record<NonNullable<ProjectPageOptions["iconSource"]>, TranslationKey> = {
  automatic: "setting.icon.source.automatic",
  glyph: "setting.icon.source.glyph",
  file: "setting.icon.source.file",
};

/** The line above the `icon` setting's field: the icon, its source, and the buttons. */
export function iconChoiceLine(name: string, opts: ProjectPageOptions, lang: Language): string {
  const source = opts.iconSource ?? "automatic";
  return (
    `<div class="iconchoice">` +
    projectIcon(name, opts.icon ?? null) +
    `<span class="muted">${esc(t(lang, SOURCE_WORD[source]))}</span>` +
    askButton({ label: t(lang, "setting.icon.chooseIcon"), dialogId: ICON_GLYPH_DIALOG }) +
    askButton({ label: t(lang, "setting.icon.chooseFile"), dialogId: ICON_FILE_DIALOG }) +
    (source === "automatic" ? "" : btn({ label: t(lang, "setting.icon.automatic"), form: AUTOMATIC_FORM })) +
    `</div>`
  );
}

const hidden = (fieldName: string, value = ""): string =>
  `<input type="hidden" name="${fieldName}" value="${esc(value)}">`;

/** Choose icon: the built-in icons and the six colours, the current choice checked. */
function glyphDialog(name: string, opts: ProjectPageOptions, lang: Language): string {
  const chosen = opts.icon && "glyph" in opts.icon ? opts.icon : null;
  const hue = chosen?.hue ?? initialsHue(name);
  const glyphs = radioCards({
    label: t(lang, "setting.icon.glyphs"),
    name: "glyph",
    cards: GLYPH_NAMES.map((glyph, i) => ({
      value: glyph,
      ariaLabel: t(lang, `setting.icon.glyph.${glyph}` as TranslationKey),
      required: true,
      checked: chosen ? chosen.glyph === glyph : i === 0,
      content: `<span class="projicon projinitials" data-hue="${hue}" aria-hidden="true">${glyphSvg(glyph)}</span>`,
    })),
  });
  const hues = radioCards({
    label: t(lang, "setting.icon.hues"),
    name: "hue",
    cards: [1, 2, 3, 4, 5, 6].map((n) => ({
      value: String(n),
      ariaLabel: t(lang, "setting.icon.hue", { n: String(n) }),
      required: true,
      checked: n === hue,
      content: `<span class="projicon projinitials" data-hue="${n}" aria-hidden="true"></span>`,
    })),
  });
  return formDialog(lang, {
    id: ICON_GLYPH_DIALOG,
    title: t(lang, "setting.icon.glyphTitle"),
    action: iconAction(name),
    hook: "reloadform",
    fields:
      hidden("choice", "glyph") +
      `<div class="iconpicker">${field(t(lang, "setting.icon.glyphs"), glyphs, { group: true })}</div>` +
      `<div class="iconpicker">${field(t(lang, "setting.icon.hues"), hues, { group: true })}</div>`,
  });
}

/** Choose file: the page script reads the picked file into `filename` and
 *  `data` (`specs-client/icon-file/`), and Save stays shut until it has. */
function fileDialog(name: string, lang: Language): string {
  return formDialog(lang, {
    id: ICON_FILE_DIALOG,
    title: t(lang, "setting.icon.fileTitle"),
    action: iconAction(name),
    hook: "reloadform",
    data: { "read-failed": t(lang, "setting.icon.readFailed") },
    fields:
      hidden("choice", "file") + hidden("filename") + hidden("data") +
      field(t(lang, "setting.icon.file"), `<input type="file" accept=".svg,.png,.ico" data-icon-file>`) +
      `<p class="muted">${esc(t(lang, "setting.icon.fileHelp"))}</p>`,
    saveDisabled: true,
  });
}

/** The two dialogs and Automatic's form, drawn after the settings cards. */
export function iconDialogs(name: string, opts: ProjectPageOptions, lang: Language): string {
  return (
    glyphDialog(name, opts, lang) +
    fileDialog(name, lang) +
    `<form id="${AUTOMATIC_FORM}" method="post" action="${esc(iconAction(name))}" class="reloadform" data-line="${AUTOMATIC_LINE}">` +
    hidden("choice", "automatic") +
    `</form>` +
    messageSlot("refused", "failed", { id: AUTOMATIC_LINE })
  );
}
