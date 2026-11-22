// The icon a reader chose for a project: kept beside the board's own
// checkouts, never inside a repository, and refused whole — nothing written —
// when the glyph, the colour or the file is not one the board takes.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ICON_FILE_MAX,
  checkIconFile,
  clearChosenIcon,
  readChosenIcon,
  writeChosenFile,
  writeChosenGlyph,
} from "../../../src/project/project-icon/chosen.ts";
import { GLYPH_NAMES, isGlyph } from "../../../src/project/project-icon/glyphs.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A checkouts base holding project `p`'s two clones, as the board keeps them. */
function base(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-chosen-icon-"));
  dirs.push(dir);
  mkdirSync(join(dir, "p", "code"), { recursive: true });
  mkdirSync(join(dir, "p", "specs"), { recursive: true });
  return dir;
}

const png = (size: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(size);
  // The signature, then the IHDR chunk's length and type.
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  return bytes;
};
const ICO = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
const SVG = new TextEncoder().encode(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
const glyph = GLYPH_NAMES[0]!;

describe("a chosen built-in icon", () => {
  test("is kept with its colour and read back (AC-2)", () => {
    const b = base();
    expect(writeChosenGlyph(b, "p", glyph, 3)).toBeNull();
    expect(readChosenIcon(b, "p")).toEqual({ kind: "glyph", glyph, hue: 3 });
  });

  test("a glyph not on the list, or a colour outside 1 to 6, is refused and nothing changes (AC-2)", () => {
    const b = base();
    writeChosenGlyph(b, "p", glyph, 2);
    expect(isGlyph("no-such-glyph")).toBe(false);
    for (const [name, hue] of [["no-such-glyph", 1], [glyph, 0], [glyph, 7], [glyph, 2.5]] as const) {
      expect(writeChosenGlyph(b, "p", name, hue)).toBeString();
    }
    expect(readChosenIcon(b, "p")).toEqual({ kind: "glyph", glyph, hue: 2 });
  });
});

describe("a chosen file", () => {
  test("is kept beside the checkouts, outside both clones, and read back with its type (AC-3)", () => {
    const b = base();
    const bytes = png(1024);
    expect(writeChosenFile(b, "p", "Logo.PNG", bytes)).toBeNull();
    const chosen = readChosenIcon(b, "p");
    expect(chosen).toMatchObject({ kind: "file", path: join(b, "p", "icon.png"), type: "image/png" });
    expect(new Uint8Array(readFileSync(join(b, "p", "icon.png")))).toEqual(bytes);
    expect(readdirSync(join(b, "p", "code"))).toEqual([]);
    expect(readdirSync(join(b, "p", "specs"))).toEqual([]);
  });

  test("takes SVG, PNG and ICO, each by its extension and its first bytes (AC-3)", () => {
    expect(checkIconFile("a.svg", SVG)).toEqual({ ok: true, ext: "svg" });
    expect(checkIconFile("a.png", png(16))).toEqual({ ok: true, ext: "png" });
    expect(checkIconFile("a.ico", ICO)).toEqual({ ok: true, ext: "ico" });
  });

  test("an SVG whose element sits behind a long comment is taken (AC-3)", () => {
    const svg = new TextEncoder().encode(`<!--${"x".repeat(5000)}-->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
    expect(checkIconFile("a.svg", svg)).toEqual({ ok: true, ext: "svg" });
  });

  test("a .png carrying only the first four bytes of a PNG's signature is refused, and the icon is unchanged (AC-4)", () => {
    const b = base();
    const first = png(64);
    writeChosenFile(b, "p", "first.png", first);
    expect(writeChosenFile(b, "p", "logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("The file is not an SVG, PNG or ICO image.");
    expect(new Uint8Array(readFileSync(join(b, "p", "icon.png")))).toEqual(first);
  });

  test("a JPEG, or a .png whose bytes are not a PNG, is refused as not an SVG, PNG or ICO image (AC-4)", () => {
    for (const [name, bytes] of [["logo.jpg", png(16)], ["logo.png", SVG], ["logo.svg", png(16)], ["logo", png(16)]] as const) {
      const checked = checkIconFile(name, bytes);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.error).toBe("The file is not an SVG, PNG or ICO image.");
    }
  });

  test("a file over 512 KB is refused with its size and the limit; exactly 512 KB is taken (AC-4)", () => {
    expect(ICON_FILE_MAX).toBe(524_288);
    const over = checkIconFile("big.png", png(600 * 1024));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toBe("The file is 600 KB; an icon may be at most 512 KB.");
    expect(checkIconFile("edge.png", png(ICON_FILE_MAX))).toEqual({ ok: true, ext: "png" });
  });

  test("a refused file leaves the earlier choice and its file as they were (AC-4)", () => {
    const b = base();
    const first = png(64);
    writeChosenFile(b, "p", "first.png", first);
    expect(writeChosenFile(b, "p", "second.jpg", png(64))).toBe("The file is not an SVG, PNG or ICO image.");
    expect(writeChosenFile(b, "p", "big.png", png(ICON_FILE_MAX + 1))).toBeString();
    expect(readChosenIcon(b, "p")).toMatchObject({ kind: "file", path: join(b, "p", "icon.png") });
    expect(new Uint8Array(readFileSync(join(b, "p", "icon.png")))).toEqual(first);
  });

  test("a new file of another type replaces the earlier one (AC-3)", () => {
    const b = base();
    writeChosenFile(b, "p", "a.png", png(64));
    writeChosenFile(b, "p", "a.svg", SVG);
    expect(readChosenIcon(b, "p")).toMatchObject({ kind: "file", type: "image/svg+xml" });
    expect(existsSync(join(b, "p", "icon.png"))).toBe(false);
  });
});

describe("Automatic", () => {
  test("removes the chosen icon and its file, leaving no choice (AC-6)", () => {
    const b = base();
    writeChosenFile(b, "p", "a.png", png(64));
    clearChosenIcon(b, "p");
    expect(readChosenIcon(b, "p")).toBeNull();
    expect(readdirSync(join(b, "p")).sort()).toEqual(["code", "specs"]);
    clearChosenIcon(b, "p");
  });

  test("a project with nothing chosen has no choice (AC-6)", () => {
    expect(readChosenIcon(base(), "p")).toBeNull();
  });
});
