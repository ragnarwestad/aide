// The scanner behind the HTTP-routes guard, on small fixture strings. The
// real tree against the real page is http-routes-page.test.ts.
import { describe, expect, test } from "bun:test";
import { compareRoutes, routesOnPage, scanSource, type PageRoute, type SourceRoute } from "../helpers/route-scan";

const scan = (text: string, constants: Record<string, string> = {}): SourceRoute[] =>
  scanSource({ "fixture.ts": text }, constants);

const row = (method: string, path: string): PageRoute => ({
  method,
  path,
  kind: "action",
  takes: "x",
  answers: "y",
  madeFor: "form",
});

const NOT_ALLOWED = `return new Response("method not allowed", { status: 405 });`;

describe("scanSource reads the ways a route is matched", () => {
  test("a literal path with the method its block checks (AC-3)", () => {
    const src = `if (path === "/api/queue/archive") {\n  if (req.method !== "POST") ${NOT_ALLOWED}\n}`;
    expect(scan(src)).toEqual([{ path: "/api/queue/archive", methods: ["POST"] }]);
  });

  test("a path held in an exported constant (AC-3)", () => {
    const src = `if (path === FOO_ROUTE) {\n  if (req.method !== "GET") ${NOT_ALLOWED}\n}`;
    expect(scan(src, { FOO_ROUTE: "/foo" })).toEqual([{ path: "/foo", methods: ["GET"] }]);
  });

  test("a path held in a constant local to the file (AC-3)", () => {
    const src = `const LOCAL_ROUTE = "/api/local";\nif (path === LOCAL_ROUTE) {\n  if (req.method !== "GET") ${NOT_ALLOWED}\n}`;
    expect(scan(src)).toEqual([{ path: "/api/local", methods: ["GET"] }]);
  });

  test("a constant it cannot resolve throws instead of being skipped (AC-1)", () => {
    expect(() => scan(`if (path === NOWHERE_ROUTE) return null;`)).toThrow(/NOWHERE_ROUTE/);
  });

  test("a startsWith prefix becomes a wildcard path (AC-3)", () => {
    expect(scan(`if (path.startsWith("/queue/")) return redirect();`)).toEqual([{ path: "/queue/*", methods: [] }]);
  });

  test("an inline regex, every capture a wildcard (AC-3)", () => {
    const src = `const m = path.match(/^\\/api\\/queue\\/([A-Za-z0-9-]+)\\/cancel$/);\nif (m) {\n  if (req.method !== "POST") ${NOT_ALLOWED}\n}`;
    expect(scan(src)).toEqual([{ path: "/api/queue/*/cancel", methods: ["POST"] }]);
  });

  test("a capture holding a slash inside its class stays one wildcard (AC-3)", () => {
    const src = `const m = path.match(/^\\/projects\\/([^/]+)\\/remove$/);\nif (m) {\n  if (req.method !== "GET") ${NOT_ALLOWED}\n}`;
    expect(scan(src)).toEqual([{ path: "/projects/*/remove", methods: ["GET"] }]);
  });

  test("a named regex used through exec (AC-3)", () => {
    const src = `const DISMISS = /^\\/api\\/x\\/([^/]+)\\/dismiss$/;\nconst m = DISMISS.exec(path);\nif (!m) return null;\nif (req.method !== "POST") ${NOT_ALLOWED}`;
    expect(scan(src)).toEqual([{ path: "/api/x/*/dismiss", methods: ["POST"] }]);
  });

  test("a regex alternation gives one path per alternative (AC-3)", () => {
    const src = `const d = path.match(/^\\/(api\\/queue|specs)\\/([A-Za-z0-9-]+)$/);\nif (d) {\n  if (req.method !== "GET") ${NOT_ALLOWED}\n}`;
    expect(scan(src)).toEqual([
      { path: "/api/queue/*", methods: ["GET"] },
      { path: "/specs/*", methods: ["GET"] },
    ]);
  });
});

describe("scanSource reads the methods of a path", () => {
  test("GET then POST gives both (AC-3)", () => {
    const src = `if (path === "/api/queue") {\n  if (req.method === "GET") {\n    return json({});\n  }\n  if (req.method !== "POST") ${NOT_ALLOWED}\n}`;
    expect(scan(src)).toEqual([{ path: "/api/queue", methods: ["GET", "POST"] }]);
  });

  test("two paths in one condition share the block after them (AC-3)", () => {
    const src = `if (path !== "/api/push/subscribe" && path !== "/api/push/unsubscribe") return null;\nif (req.method !== "POST") ${NOT_ALLOWED}`;
    expect(scan(src)).toEqual([
      { path: "/api/push/subscribe", methods: ["POST"] },
      { path: "/api/push/unsubscribe", methods: ["POST"] },
    ]);
  });

  test("a block that states no method adds none, and the next path's check is not borrowed (AC-4)", () => {
    const src = `if (path === "/queue") return redirect();\nif (path === "/other") {\n  if (req.method !== "GET") ${NOT_ALLOWED}\n}`;
    expect(scan(src)).toEqual([
      { path: "/other", methods: ["GET"] },
      { path: "/queue", methods: [] },
    ]);
  });

  test("a path named again elsewhere keeps the union of what every site states (AC-3)", () => {
    const src = `if (path === "/a") {\n  if (req.method !== "POST") ${NOT_ALLOWED}\n}\nconst x = path === "/a" ? 1 : 2;`;
    expect(scan(src)).toEqual([{ path: "/a", methods: ["POST"] }]);
  });
});

describe("routesOnPage reads the table rows", () => {
  const page = [
    "| Route | Kind | Takes | Answers | Made for |",
    "|-------|------|-------|---------|----------|",
    "| `GET /api/queue`  | read   | nothing | jobs | interface |",
    "| `GET /specs/<project>/<spec>?startTestServer=1` | action | nothing | a page | page |",
    "Some prose with `GET /not/a/row` in it.",
  ].join("\n");

  test("a row is a first cell of method and path, query string kept (AC-1)", () => {
    expect(routesOnPage(page)).toEqual([
      { method: "GET", path: "/api/queue", kind: "read", takes: "nothing", answers: "jobs", madeFor: "interface" },
      {
        method: "GET",
        path: "/specs/<project>/<spec>?startTestServer=1",
        kind: "action",
        takes: "nothing",
        answers: "a page",
        madeFor: "page",
      },
    ]);
  });
});

describe("compareRoutes", () => {
  const archive: SourceRoute[] = [{ path: "/api/queue/archive", methods: ["POST"] }];

  test("a route with no row is named as missing, and has no gap once it has one (AC-3)", () => {
    expect(compareRoutes(archive, []).missingRows).toEqual(["POST /api/queue/archive"]);
    expect(compareRoutes(archive, [row("POST", "/api/queue/archive")])).toEqual({
      missingRows: [],
      unknownRows: [],
      wrongMethod: [],
    });
  });

  test("a method the source states, with only the other method's row, is missing (AC-3)", () => {
    const both: SourceRoute[] = [{ path: "/api/queue", methods: ["GET", "POST"] }];
    expect(compareRoutes(both, [row("GET", "/api/queue")]).missingRows).toEqual(["POST /api/queue"]);
  });

  test("a row with no route behind it is unknown (AC-4)", () => {
    expect(compareRoutes(archive, [row("POST", "/api/queue/<id>/archive")]).unknownRows).toEqual([
      "POST /api/queue/<id>/archive",
    ]);
  });

  test("a row whose method the source does not state is a wrong method (AC-4)", () => {
    const create: SourceRoute[] = [{ path: "/api/queue/create", methods: ["POST"] }];
    expect(compareRoutes(create, [row("GET", "/api/queue/create")]).wrongMethod).toEqual(["GET /api/queue/create"]);
  });

  test("a path whose source states no method accepts a row with any method (AC-4)", () => {
    const any: SourceRoute[] = [{ path: "/queue", methods: [] }];
    expect(compareRoutes(any, [row("GET", "/queue")])).toEqual({ missingRows: [], unknownRows: [], wrongMethod: [] });
  });

  test("a query string on a row is dropped before it is matched (AC-4)", () => {
    const spec: SourceRoute[] = [{ path: "/specs/*/*", methods: ["GET"] }];
    const rows = [row("GET", "/specs/<project>/<spec>"), row("GET", "/specs/<project>/<spec>?startTestServer=1")];
    expect(compareRoutes(spec, rows)).toEqual({ missingRows: [], unknownRows: [], wrongMethod: [] });
  });

  test("the fallback row GET /<file> is the one row with no handler to find (AC-4)", () => {
    expect(compareRoutes([], [row("GET", "/<file>")]).unknownRows).toEqual([]);
  });
});
