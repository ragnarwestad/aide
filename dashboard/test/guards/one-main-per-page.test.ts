// `pageShell` (render/ui/shell.ts) wraps every page's body in `<main>`,
// which carries the frame's padding. A page that opens one of its own
// inside it takes that padding twice: the Test servers table then sat
// 32 px inside the line every other page's content keeps, which is what
// spec 519's AC-1 measured and nothing else caught. The Settings and
// Schedule pages had the same second `<main>` with nothing measuring
// them at all — hence this, which reads the source rather than a page.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PAGES = join(import.meta.dir, "..", "..", "src", "render", "pages");
const SHELL = join(import.meta.dir, "..", "..", "src", "render", "ui", "shell.ts");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return entry.endsWith(".ts") ? [path] : [];
  });
}

describe("one <main> per page", () => {
  test("the shell is the one place that opens it", () => {
    expect(readFileSync(SHELL, "utf-8")).toContain("<main>");
  });

  test("no page under render/pages opens a second one", () => {
    const offenders = sources(PAGES).filter((path) => {
      const text = readFileSync(path, "utf-8");
      // Comments name the element freely; what matters is markup written
      // into a template string.
      return text
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .some((line) => line.includes("<main>"));
    });
    expect(offenders.map((p) => p.slice(p.indexOf("render/pages")))).toEqual([]);
  });
});
