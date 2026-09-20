// Spec 449: the Specs page's browser code moved from src/queue-client
// to src/specs-client so the name matches specs-list rather than the
// queue concept. This guard makes that permanent — a rename that half
// completes (a stale import, a glob that quietly matches zero files)
// shows up here instead of staying silent.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

const SPECS_CLIENT_SRC_FILES = [
  "ai-sync.ts", "cancel-confirm.ts", "elapsed.ts", "forms.ts", "live.ts",
  "navigation.ts", "pending-model.ts", "press.ts", "row-swap.ts",
  "schedule-actions.ts", "state.ts", "tail-actions.ts",
];

// The directory's own files, and the subdirectories its tests are
// grouped into now that it is back under the 15-file limit.
const SPECS_CLIENT_TEST_FILES = [
  "add-form-and-tail-box.test.ts", "fixtures-controls.ts",
  "fixtures-events.ts", "fixtures-panels.ts", "fixtures-runtime.ts",
  "fixtures-tbody.ts", "fixtures.ts", "projects-panel.test.ts",
  "schedule-actions.test.ts", "live/live-redraw.test.ts",
  "pickers/ai-fills-model.test.ts", "presses/button-presses.test.ts",
];

describe("the Specs page's browser code is named specs-client, not queue-client (spec 449)", () => {
  test("src/specs-client/ exists with its 12 files, src/queue-client/ does not", () => {
    const dir = join(ROOT, "src", "specs-client");
    expect(existsSync(dir)).toBe(true);
    for (const file of SPECS_CLIENT_SRC_FILES) {
      expect(existsSync(join(dir, file))).toBe(true);
    }
    expect(existsSync(join(ROOT, "src", "queue-client"))).toBe(false);
  });

  test("src/specs-client/index.ts exists, src/queue-client.ts does not", () => {
    expect(existsSync(join(ROOT, "src", "specs-client", "index.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "src", "queue-client.ts"))).toBe(false);
  });

  test("test/specs-client/ exists with its own files, test/queue-client/ does not", () => {
    const dir = join(ROOT, "test", "specs-client");
    expect(existsSync(dir)).toBe(true);
    for (const file of SPECS_CLIENT_TEST_FILES) {
      expect(existsSync(join(dir, file))).toBe(true);
    }
    expect(existsSync(join(ROOT, "test", "queue-client"))).toBe(false);
  });

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
