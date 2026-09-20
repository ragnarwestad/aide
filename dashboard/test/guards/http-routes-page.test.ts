// dashboard/docs/http-routes.md lists every route the server answers, and
// this reads the handler source against it both ways: a route with no row
// fails, and so does a row with no route. The scanner is
// test/helpers/route-scan.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareRoutes, readServeSources, routesOnPage, scanSource } from "../helpers/route-scan";

const ROOT = join(import.meta.dir, "..", "..");
const page = readFileSync(join(ROOT, "docs", "http-routes.md"), "utf-8");
const rows = routesOnPage(page);
const { files, constants } = readServeSources(ROOT);
const source = scanSource(files, constants);

describe("the page's rows", () => {
  test("every row says what it takes, what it answers and who it is made for (AC-1)", () => {
    const bad = rows.filter(
      (r) => !r.takes || !r.answers || !["page", "form", "interface"].includes(r.madeFor),
    );
    expect(bad.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  test("every row is a read or an action, a POST is an action, and the test-board start is marked (AC-2)", () => {
    expect(rows.filter((r) => !["read", "action"].includes(r.kind)).map((r) => r.path)).toEqual([]);
    expect(rows.filter((r) => r.method === "POST" && r.kind !== "action").map((r) => r.path)).toEqual([]);
    const start = rows.find((r) => r.method === "GET" && r.path === "/specs/<project>/<spec>?startTestServer=1");
    expect(start?.kind).toBe("action");
  });

  test("the shared-prefix section names GET /api/queue and POST /api/queue (AC-2)", () => {
    const at = page.indexOf("## Reads and actions share a prefix");
    expect(at).toBeGreaterThan(-1);
    const rest = page.slice(at + 1);
    const next = rest.indexOf("\n## ");
    const section = next === -1 ? rest : rest.slice(0, next);
    expect(section).toContain("`GET /api/queue`");
    expect(section).toContain("`POST /api/queue`");
  });
});

describe("the scanner reads the real tree", () => {
  test("every route file that checks req.method yields a route, and no constant is left unresolved (AC-1)", () => {
    const silent = Object.entries(files)
      .filter(([, text]) => text.includes("req.method"))
      .filter(([name, text]) => scanSource({ [name]: text }, constants).length === 0)
      .map(([name]) => name);
    expect(silent).toEqual([]);
  });

  test("/api/queue is read as both a read and an action (AC-3)", () => {
    expect(source.find((r) => r.path === "/api/queue")?.methods).toEqual(["GET", "POST"]);
  });
});

describe("the page against the source", () => {
  const gaps = compareRoutes(source, rows);

  test("no route in the source is without a row (AC-3)", () => {
    expect(gaps.missingRows).toEqual([]);
  });

  test("no row is without a route, and none carries a method the source does not state (AC-4)", () => {
    expect(gaps.unknownRows).toEqual([]);
    expect(gaps.wrongMethod).toEqual([]);
  });

  test("the fallback row stands for serveStatic, which core-routes.ts still ends in (AC-4)", () => {
    expect(rows.some((r) => r.method === "GET" && r.path === "/<file>")).toBe(true);
    expect(files["src/serve/core-routes.ts"]).toContain("return serveStatic(ctx.siteDir, path);");
  });
});
