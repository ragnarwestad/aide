// Criteria 4-5 (spec 80): the Bun server serves the static site
// byte-identical, refuses traversal, accepts runs, and renders /live
// through the generator's layout; generated pages carry a Live entry.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/serve.ts";
import { renderSite } from "../src/render.ts";

let dir: string;
let server: ReturnType<typeof createServer>;
let base: string;

const failFetch = (async () => {
  throw new Error("down");
}) as unknown as typeof fetch;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-serve-"));
  writeFileSync(join(dir, "projects.html"), "<p>overview</p>");
  writeFileSync(join(dir, "aide.html"), "<p>aide</p>");
  server = createServer({
    siteDir: dir,
    port: 0,
    claudeUsageFetch: failFetch,
    mirrorPath: join(dir, "runs.json"),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("static", () => {
  // `/` is no longer one of these: since spec 100 the Bun server answers
  // it with the spec list before `serveStatic` is reached at all, and
  // what it answers with is covered by `queue-routes.test.ts`.
  test("the generated pages are byte-identical to disk", async () => {
    expect(await (await fetch(`${base}/projects.html`)).text()).toBe(
      readFileSync(join(dir, "projects.html"), "utf-8"),
    );
    expect(await (await fetch(`${base}/aide.html`)).text()).toBe("<p>aide</p>");
  });

  test("traversal is refused", async () => {
    const res = await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/aide-run", () => {
  test("valid → 200 and listed; invalid → 400", async () => {
    const ok = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "implement", spec: "80", project: "aide" }),
    });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "bad/id", command: "implement" }),
    });
    expect(bad.status).toBe(400);
    const runs = (await (await fetch(`${base}/api/aide-runs`)).json()) as { rows: { spec: string }[] };
    expect(runs.rows.map((r) => r.spec)).toEqual(["80"]);
  });

  test("oversize body → 413", async () => {
    const res = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s2", command: "implement", pad: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
  });
});

describe("GET /live", () => {
  test("layout, meta refresh, rows, degradation notice, no script", async () => {
    const html = await (await fetch(`${base}/live`)).text();
    expect(html).toContain("<nav>");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("80");
    expect(html).toContain("implement");
    expect(html).toContain("claude-usage");
    expect(html).not.toContain("<script");
    expect(html).toMatch(/<a class="current" href="\/live"/);
  });
});

describe("TDD phases on /live (criterion 10, spec 81)", () => {
  test("a phase reported from inside an implement run is stored and shown", async () => {
    const res = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({
        host: "h", sessionId: "s-phase", command: "implement",
        spec: "81", project: "aide", phase: "green",
      }),
    });
    expect(res.status).toBe(200);
    const runs = (await (await fetch(`${base}/api/aide-runs`)).json()) as {
      rows: { sessionId: string; phase?: string }[];
    };
    expect(runs.rows.find((r) => r.sessionId === "s-phase")?.phase).toBe("green");
    const html = await (await fetch(`${base}/live`)).text();
    expect(html).toContain("implement · green");
  });
});

describe("generated site nav (criterion 5)", () => {
  test("every page links to /live", () => {
    const pages = renderSite(
      [{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }],
      "2026-08-16T00:00:00Z",
    );
    for (const p of pages) expect(p.html).toContain('<a href="/live">Live</a>');
  });
});
