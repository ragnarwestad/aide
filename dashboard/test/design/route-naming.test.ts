// Spec 446, AC-1/AC-3/AC-5: the routing dispatcher lives under
// src/serve/routes, and the genuinely queue-scoped route names keep
// theirs — routing and the queue itself stay distinct.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "src");

describe("route naming (spec 446)", () => {
  test("the routes paths exist (AC-1, AC-3)", () => {
    expect(existsSync(join(SRC, "serve", "routes", "index.ts"))).toBe(true);
    expect(existsSync(join(SRC, "serve", "routes"))).toBe(true);
  });

  test("the genuinely queue-scoped route names are untouched (AC-5)", () => {
    const queueAdmin = readFileSync(join(SRC, "serve", "routes", "queue-admin.ts"), "utf-8");
    expect(queueAdmin).toContain("handleQueueAdminRoutes");
    const sse = readFileSync(join(SRC, "serve", "routes", "sse.ts"), "utf-8");
    expect(sse).toContain("handleQueueEvents");
  });
});
