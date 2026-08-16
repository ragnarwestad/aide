// Criterion 6 of aide-dashboard/01: writeSite writes every page and
// removes ONLY .html files not in the produced page set — a bounded
// delete; everything else in the directory is untouched.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSite } from "../src/main.ts";

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
});
