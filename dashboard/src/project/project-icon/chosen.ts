// The icon a reader chose for a project on its Config tab: a built-in icon
// and a colour, or a file of their own. Kept beside the board's checkouts of
// the project, `<base>/<project>/icon.json` and, for a file, `icon.svg`,
// `icon.png` or `icon.ico` — never inside either clone, so nothing is
// committed. A choice that is refused writes nothing.

import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomically } from "../project-admin/settings-state.ts";
import { isGlyph } from "./glyphs.ts";

/** The largest file an icon may be: 512 KB. */
export const ICON_FILE_MAX = 524_288;

/** How many colours a built-in icon may be drawn on (`--initials-1` to `-6`). */
const HUES = 6;

const FILE_TYPES = { svg: "image/svg+xml", png: "image/png", ico: "image/x-icon" } as const;
type FileExt = keyof typeof FILE_TYPES;
const EXTS = Object.keys(FILE_TYPES) as FileExt[];

export type ChosenIcon =
  | { kind: "glyph"; glyph: string; hue: number }
  | { kind: "file"; path: string; type: string; mtime: number };

const choiceFile = (base: string, project: string): string => join(base, project, "icon.json");
const iconFile = (base: string, project: string, ext: FileExt): string => join(base, project, `icon.${ext}`);

const NOT_AN_IMAGE = "The file is not an SVG, PNG or ICO image.";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** "IHDR", the chunk every PNG opens with, after its 4-byte length. */
const PNG_IHDR = [0x49, 0x48, 0x44, 0x52];

const startsWith = (bytes: Uint8Array, at: number, want: number[]): boolean => want.every((b, i) => bytes[at + i] === b);

/** Whether the bytes are what the extension says: a PNG's whole signature
 *  and its header chunk, an ICO's header naming at least one image, or
 *  text holding an `<svg` element anywhere in the file. */
function looksLike(ext: FileExt, bytes: Uint8Array): boolean {
  if (ext === "png") return startsWith(bytes, 0, PNG_SIGNATURE) && startsWith(bytes, 12, PNG_IHDR);
  if (ext === "ico") return bytes.length >= 6 && startsWith(bytes, 0, [0x00, 0x00, 0x01, 0x00]) && (bytes[4]! | (bytes[5]! << 8)) > 0;
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, "").trimStart();
  return text.startsWith("<") && /<svg[\s>/]/i.test(text);
}

/** Whether `bytes` may be a project's icon: an SVG, PNG or ICO by both its
 *  name and its first bytes, of at most 512 KB. A refusal says why in one
 *  sentence. */
export function checkIconFile(filename: string, bytes: Uint8Array): { ok: true; ext: FileExt } | { ok: false; error: string } {
  const ext = filename.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (!ext || !(EXTS as string[]).includes(ext)) return { ok: false, error: NOT_AN_IMAGE };
  if (bytes.length > ICON_FILE_MAX) {
    return { ok: false, error: `The file is ${Math.ceil(bytes.length / 1024)} KB; an icon may be at most 512 KB.` };
  }
  if (!looksLike(ext as FileExt, bytes)) return { ok: false, error: NOT_AN_IMAGE };
  return { ok: true, ext: ext as FileExt };
}

/** The project's chosen icon, or null for none — a choice file that cannot
 *  be read, or names what is not there, counts as none. */
export function readChosenIcon(base: string, project: string): ChosenIcon | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(choiceFile(base, project), "utf-8"));
  } catch {
    return null;
  }
  const choice = raw as { kind?: unknown; glyph?: unknown; hue?: unknown; file?: unknown };
  if (choice.kind === "glyph" && typeof choice.glyph === "string" && isGlyph(choice.glyph) && validHue(choice.hue)) {
    return { kind: "glyph", glyph: choice.glyph, hue: choice.hue };
  }
  if (choice.kind === "file") {
    const ext = EXTS.find((e) => choice.file === `icon.${e}`);
    if (!ext) return null;
    const path = iconFile(base, project, ext);
    try {
      return { kind: "file", path, type: FILE_TYPES[ext], mtime: Math.floor(statSync(path).mtimeMs) };
    } catch {
      return null;
    }
  }
  return null;
}

function validHue(hue: unknown): hue is number {
  return typeof hue === "number" && Number.isInteger(hue) && hue >= 1 && hue <= HUES;
}

/** Remove every icon file but `keep`. */
function removeFiles(base: string, project: string, keep?: FileExt): void {
  for (const ext of EXTS) if (ext !== keep) rmSync(iconFile(base, project, ext), { force: true });
}

/** Choose a built-in icon on one of the six colours. Null when it is kept,
 *  else why it was refused. */
export function writeChosenGlyph(base: string, project: string, glyph: string, hue: number): string | null {
  if (!isGlyph(glyph)) return "There is no built-in icon by that name.";
  if (!validHue(hue)) return `The colour must be one of 1 to ${HUES}.`;
  writeAtomically(choiceFile(base, project), JSON.stringify({ kind: "glyph", glyph, hue }) + "\n");
  removeFiles(base, project);
  return null;
}

/** Choose a file of the reader's own. Null when it is kept, else why it
 *  was refused (`checkIconFile`). */
export function writeChosenFile(base: string, project: string, filename: string, bytes: Uint8Array): string | null {
  const checked = checkIconFile(filename, bytes);
  if (!checked.ok) return checked.error;
  writeAtomically(iconFile(base, project, checked.ext), bytes);
  writeAtomically(choiceFile(base, project), JSON.stringify({ kind: "file", file: `icon.${checked.ext}` }) + "\n");
  removeFiles(base, project, checked.ext);
  return null;
}

/** Automatic: no chosen icon, so the project's own is shown again. */
export function clearChosenIcon(base: string, project: string): void {
  rmSync(choiceFile(base, project), { force: true });
  removeFiles(base, project);
}

