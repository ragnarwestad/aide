// Criteria 4-5 (spec 80): the Bun server serves the static site
// byte-identical, refuses traversal, accepts runs, and serves them as JSON
// through the generator's layout; generated pages carry a Live entry.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/serve.ts";
import { renderSite } from "../src/render.ts";
import { queueHarness } from "./helpers/queue-server.ts";

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

// The /live page is gone (2026-08-18): the spec list shows every queued
// run per row, and interactive sessions are claude-usage's own page. The
// receiver stays — the job page still enriches a running step from it.
describe("GET /live", () => {
  test("is not a page any more, and nothing links to it", async () => {
    expect((await fetch(`${base}/live`)).status).toBe(404);
    const html = await (await fetch(`${base}/`)).text();
    expect(html).not.toContain('href="/live"');
  });
});

describe("TDD phases in /api/aide-runs (criterion 10, spec 81)", () => {
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
  });
});

// --- spec 115: /projects is a served page ------------------------------------
//
// The panel that adds and removes projects needs a token behind it, and
// a generated file has no server to check one against. So the overview
// became a route: same listing, same rows, plus the two controls — and
// the same guard `/` has, for the same reason.
describe("GET /projects (spec 115)", () => {
  const harness = queueHarness("aide-projects-route-");
  const TOKEN = "s3cret";
  const AUTH = { "x-aide-token": TOKEN };
  afterEach(() => harness.cleanup());

  test("it lists the projects and carries both controls", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/projects`, { headers: AUTH });
    expect(res.status).toBe(200);
    const html = await res.text();
    // The listing, from the same rows the generated page drew.
    expect(html).toContain('class="proj-row"');
    expect(html).toContain('href="aide.html"');
    // And the panel that changes it.
    expect(html).toContain('action="/api/queue/projects"');
    expect(html).toContain('action="/api/queue/projects/aide/remove"');
  });

  test("the same guard as `/`: no token 503, wrong token 401", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    expect((await fetch(`${base}/projects`)).status).toBe(401);
    expect((await fetch(`${base}/projects`, { headers: { "x-aide-token": "wrong" } })).status).toBe(401);
    const off = harness.start({});
    expect((await fetch(`${off.base}/projects`)).status).toBe(503);
  });

  // The bookmark path: projects.html hands the address on with its query
  // string, so a reader arriving with the token gets the same cookie `/`
  // would have given them.
  test("a token in the address is handed over as the cookie, as on `/`", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/projects?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("aide_token=");
  });

  // With no --root there is no project set to list, and an empty listing
  // would read as "no projects" rather than "this server was not told
  // where they are". The generated file is what it showed before.
  test("without --root it falls back to the generated page", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, projectRoot: undefined } });
    const res = await fetch(`${base}/projects`, { headers: AUTH, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/projects.html");
  });

  // And its nav keeps pointing at that file: `navFromSite()` is a
  // separate, hand-written fallback that deliberately does not call
  // `navEntries()`, which is what lets the two answer differently.
  test("the no---root nav still points at projects.html", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, projectRoot: undefined } });
    const html = await (await fetch(`${base}/`, { headers: AUTH })).text();
    const navHtml = html.match(/<nav>[\s\S]*?<\/nav>/)![0];
    expect(navHtml).toContain('href="projects.html"');
    expect(navHtml).not.toContain('href="/projects"');
  });
});

describe("generated site nav (criterion 5)", () => {
  test("no page links to /live any more", () => {
    const pages = renderSite(
      [{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }],
      "2026-08-16T00:00:00Z",
    );
    for (const p of pages) expect(p.html).not.toContain('href="/live"');
  });
});
