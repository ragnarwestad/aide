// Spec 446, AC-1/AC-2/AC-3/AC-4/AC-5: guards the rename of the routing
// dispatcher away from the "handleQueue"/"handle-queue" name, so the
// distinction between routing (renamed) and the queue itself (untouched)
// stays true permanently, not just at the moment of the rename.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full, ext);
    return name.endsWith(ext) ? [full] : [];
  });
}

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "src");
const TEST = join(ROOT, "test");
const DOCS = join(ROOT, "docs");
const ROOT_CLAUDE_MD = join(ROOT, "CLAUDE.md");

describe("route naming (spec 446)", () => {
  test("the old handle-queue dispatcher paths are gone, the routes paths exist (AC-1, AC-3)", () => {
    expect(existsSync(join(SRC, "serve", "handle-queue.ts"))).toBe(false);
    expect(existsSync(join(SRC, "serve", "handle-queue"))).toBe(false);
    expect(existsSync(join(TEST, "handle-queue"))).toBe(false);
    expect(existsSync(join(SRC, "serve", "routes.ts"))).toBe(true);
    expect(existsSync(join(SRC, "serve", "routes"))).toBe(true);
  });

  test("no source or test file contains the old dispatcher identifiers (AC-2)", () => {
    const bad: string[] = [];
    const self = join(import.meta.dir, "route-naming.test.ts");
    for (const file of [...filesUnder(SRC, ".ts"), ...filesUnder(TEST, ".ts")]) {
      if (file === self) continue;
      const content = readFileSync(file, "utf-8");
      if (/\bhandleQueue\b/.test(content) || /\bHandleQueueContext\b/.test(content)) {
        bad.push(file.slice(ROOT.length + 1));
      }
    }
    expect(bad).toEqual([]);
  });

  test("the genuinely queue-scoped route names are untouched (AC-5)", () => {
    const queueAdmin = readFileSync(join(SRC, "serve", "routes", "queue-admin.ts"), "utf-8");
    expect(queueAdmin).toContain("handleQueueAdminRoutes");
    const sse = readFileSync(join(SRC, "serve", "routes", "sse.ts"), "utf-8");
    expect(sse).toContain("handleQueueEvents");
  });

  test("no doc under docs/ or the root CLAUDE.md mentions the old handle-queue path (AC-4)", () => {
    const docFiles = [...filesUnder(DOCS, ".md"), ROOT_CLAUDE_MD];
    const bad: string[] = [];
    for (const file of docFiles) {
      if (readFileSync(file, "utf-8").includes("handle-queue")) {
        bad.push(file.slice(ROOT.length + 1));
      }
    }
    expect(bad).toEqual([]);
  });
});
