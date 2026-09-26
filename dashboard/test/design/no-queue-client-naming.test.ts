// Spec 449: the Specs page's browser code moved from src/queue-client
// to src/specs-client so the name matches specs-list rather than the
// queue concept. This guard makes that permanent — a rename that half
// completes (a stale import, a glob that quietly matches zero files)
// shows up here instead of staying silent.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const OWN_FILE = join(import.meta.dir, "no-queue-client-naming.test.ts");

// The actual queue concept (src/queue/, /api/queue, aide-queue.json and
// its routes/types) is a different thing and keeps "queue" in its name —
// 2-analysis.md's Boundary note names these as the fixed exclusion list.
const PROTECTED_BOUNDARY = [
  join(ROOT, "src", "queue"),
  join(ROOT, "src", "serve", "routes", "queue-admin.ts"),
  join(ROOT, "test", "queue-routes"),
  join(ROOT, "src", "render", "ui", "job-state"),
];

function isProtected(file: string): boolean {
  return PROTECTED_BOUNDARY.some(
    (p) => file === p || file.startsWith(p + "/"),
  );
}

function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [full] : [];
  });
}

describe("the Specs page's browser code is named specs-client, not queue-client (spec 449)", () => {
  test("no file outside the queue concept still says queue-client or queueClient", () => {
    const candidates = [
      ...filesUnder(join(ROOT, "src"), [".ts", ".md"]),
      ...filesUnder(join(ROOT, "test"), [".ts", ".md"]),
      ...filesUnder(join(ROOT, "docs"), [".md"]),
    ];
    const offenders: string[] = [];
    for (const file of candidates) {
      if (file === OWN_FILE) continue;
      if (isProtected(file)) continue;
      const source = readFileSync(file, "utf-8");
      if (source.includes("queue-client") || source.includes("queueClient")) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
