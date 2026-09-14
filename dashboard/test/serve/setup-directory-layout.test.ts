// Spec 456: the seven src/serve/setup-<cluster>.ts files move to
// src/serve/setup/<cluster>.ts (AC-1), with no reference to their old
// filenames left anywhere under dashboard/ (AC-3, AC-5).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return [full];
  });
}

describe("src/serve/setup directory layout (spec 456)", () => {
  test("each cluster's file exists at src/serve/setup/<cluster>.ts", () => {
    for (const cluster of CLUSTERS) {
      const path = join(ROOT, "src", "serve", "setup", `${cluster}.ts`);
      expect(existsSync(path)).toBe(true);
    }
  });

  test("none of the seven old src/serve/setup-<cluster>.ts paths exist anymore", () => {
    for (const cluster of CLUSTERS) {
      const path = join(ROOT, "src", "serve", `setup-${cluster}.ts`);
      expect(existsSync(path)).toBe(false);
    }
  });

  test("no file under dashboard/ names an old setup-<cluster>.ts filename", () => {
    const oldNames = CLUSTERS.map((cluster) => `setup-${cluster}.ts`);
    const bad: string[] = [];
    for (const file of filesUnder(ROOT)) {
      const content = readFileSync(file, "utf-8");
      for (const oldName of oldNames) {
        if (content.includes(oldName)) bad.push(`${file}: ${oldName}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
