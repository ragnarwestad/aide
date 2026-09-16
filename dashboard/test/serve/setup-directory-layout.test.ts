// Spec 456: the seven serve setup clusters live at
// src/serve/setup/<cluster>.ts (AC-1).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const CLUSTERS = [
  "land",
  "project-resolution",
  "queue-context",
  "schedules",
  "spec-views",
  "test-servers",
  "watch",
];

describe("src/serve/setup directory layout (spec 456)", () => {
  test("each cluster's file exists at src/serve/setup/<cluster>.ts", () => {
    for (const cluster of CLUSTERS) {
      const path = join(ROOT, "src", "serve", "setup", `${cluster}.ts`);
      expect(existsSync(path)).toBe(true);
    }
  });
});
