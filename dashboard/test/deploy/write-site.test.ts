// Criterion 6 of aide-dashboard/01: writeSite writes every page and
// removes ONLY .html files not in the produced page set — a bounded
// delete; everything else in the directory is untouched.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSite } from "../../src/main.ts";
import { APPLE_TOUCH_ICON, PWA_FILES, PWA_LINKS, WEBMANIFEST } from "../../src/render";

describe("writeSite", () => {
  test("writes pages, removes stale .html, leaves other files alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-dash-out-"));
    try {
      writeFileSync(join(dir, "stale.html"), "old");
      writeFileSync(join(dir, "keep.txt"), "not a page");

      writeSite(
        [
          { path: "index.html", html: "<p>overview</p>" },
          { path: "a.html", html: "<p>a</p>" },
        ],
        dir,
      );

      expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe("<p>overview</p>");
      expect(readFileSync(join(dir, "a.html"), "utf-8")).toBe("<p>a</p>");
      expect(existsSync(join(dir, "stale.html"))).toBe(false);
      expect(readFileSync(join(dir, "keep.txt"), "utf-8")).toBe("not a page");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The pages link /manifest.webmanifest and /apple-touch-icon.png, and
  // the server answers those from memory. A site published by rsync has
  // no server in front of it, so the files have to be on disk beside
  // the pages.
  test("writes the files the pages' PWA links point at", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-dash-out-"));
    try {
      writeSite([{ path: "index.html", html: PWA_LINKS }], dir);
      const linked = [...PWA_LINKS.matchAll(/href="\/([^"]+)"/g)].map((m) => m[1]!);
      expect(linked.length).toBeGreaterThan(0);
      for (const file of linked) expect(existsSync(join(dir, file))).toBe(true);
      expect(readFileSync(join(dir, "manifest.webmanifest"), "utf-8")).toBe(WEBMANIFEST);
      expect(readFileSync(join(dir, "apple-touch-icon.png")).equals(APPLE_TOUCH_ICON)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The manifest names icons; a published copy has no server to compute them.
  test("writes every icon the manifest names, the PNGs with the bytes PWA_FILES holds (AC-1, AC-2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-dash-out-"));
    try {
      writeSite([{ path: "index.html", html: PWA_LINKS }], dir);
      for (const file of ["icon-192.png", "icon-512.png", "icon-512-maskable.png"])
        expect([file, readFileSync(join(dir, file)).equals(PWA_FILES[file] as Buffer)]).toEqual([file, true]);
      const icons = (JSON.parse(WEBMANIFEST) as { icons: { src: string }[] }).icons;
      for (const { src } of icons) expect([src, existsSync(join(dir, src.slice(1)))]).toEqual([src, true]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
