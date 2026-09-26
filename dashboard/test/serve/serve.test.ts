// Criterion 4 (spec 80): the Bun server accepts runs and serves them as
// JSON through the generator's layout; pages carry a Live entry.
// Path-traversal refusal is `serveStatic`'s own guard, covered where it
// is actually still called — `/schedule-output/`
// (test/serve/schedule/schedule-output-route.test.ts).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, parseArgs } from "../../src/serve/serve.ts";
import { queueHarness } from "../helpers/queue-server.ts";

let dir: string;
let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-serve-"));
  server = createServer({
    port: 0,
    mirrorPath: join(dir, "runs.json"),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop();
  rmSync(dir, { recursive: true, force: true });
});

// --- spec 530: /projects.html is a redirect, answered by the server, ---
// with no site directory involved at all (AC-5) ---------------------------
describe("GET /projects.html", () => {
  test("redirects to /projects, keeping the query string (AC-1)", async () => {
    const res = await fetch(`${base}/projects.html?foo=bar`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/projects?foo=bar");
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
    expect("enriched" in runs).toBe(false);
  });

  test("oversize body → 413", async () => {
    const res = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s2", command: "implement", pad: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
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
  afterEach(() => harness.cleanup());

  test("it lists the projects and carries both controls", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/projects`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // The listing, from the same rows the generated page drew.
    expect(html).toContain('class="proj-row"');
    // The row's own link is the SERVED page, not the generated file:
    // that is the page with the settings and the readiness answer on
    // it (spec 185), and two links reading "aide" going to two
    // different pages is what this replaced.
    expect(html).toContain('href="/projects/aide"');
    // And the two controls that change it (2026-08-19): the Add button
    // to its own page, and each row's Remove to its confirm page.
    expect(html).toContain('href="/projects/new"');
    expect(html).toContain('href="/projects/aide/remove"');
  });

  test("the Add page and a row's Remove page are served", async () => {
    const { base } = harness.start();
    const add = await fetch(`${base}/projects/new`);
    expect(add.status).toBe(200);
    expect(await add.text()).toContain('action="/api/queue/projects"');
    const remove = await fetch(`${base}/projects/aide/remove`);
    expect(remove.status).toBe(200);
    expect(await remove.text()).toContain('action="/api/queue/projects/aide/remove"');
    // A name the allowlist does not know is a mistyped address.
    const nosuch = await fetch(`${base}/projects/nosuch/remove`);
    expect(nosuch.status).toBe(404);
  });

  // With no --root there is no project set to list, and an empty listing
  // would read as "no projects" rather than "this server was not told
  // where they are" — so the page itself says so, in a notice, instead
  // of bouncing to a file that no longer exists (spec 530).
  test("without --root it renders the ordinary page with a notice", async () => {
    const { base } = harness.start({ extra: { projectRoot: undefined } });
    const res = await fetch(`${base}/projects`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("no project root");
  });

  // And its own Add page redirects to /projects too (spec 530), not to
  // the removed file: nothing to add a project TO, but the page that
  // explains why still exists.
  test("without --root, /projects/new redirects to /projects", async () => {
    const { base } = harness.start({ extra: { projectRoot: undefined } });
    const res = await fetch(`${base}/projects/new`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/projects");
  });
});

// --- spec 122: which folder a `Depends on:` entry means ----------------------
//
// The scheduling gate needs the same answer `aide-run-spec`'s own
// `resolve_dependency_folder` gives, in TypeScript: exact folder first,
// then an `<id>-` prefix, live specs before archived ones. A second
// reader of one rule, so it gets its own tests — the cases below mirror
// the bash suite's one for one.
describe("parseArgs (spec 412)", () => {
  // Spec 424: which spec this process is a test board for.
  test("--test-board sets testBoardSpec", () => {
    expect(parseArgs(["--test-board", "424-headeren-sier-hvilket-board"]).testBoardSpec).toBe(
      "424-headeren-sier-hvilket-board",
    );
  });

  test("without --test-board, testBoardSpec is absent (an ordinary server)", () => {
    expect(parseArgs([]).testBoardSpec).toBeUndefined();
  });
});

describe("resolveDependencyFolder (spec 122)", () => {
  const spec = (folder: string, archived = false) => ({
    folder,
    dir: `/specs/${folder}`,
    archived,
    closed: false,
    title: null,
    description: null,
    dependsOn: [],
  });
  const project = {
    name: "aide",
    dir: "/repos/aide",
    manifestPath: "/repos/aide/.aide/project.yaml",
    specsRoot: "/specs",
    specs: [spec("80-dependency"), spec("81-queue-and-runner"), spec("77-old", true)],
  };

  test("a number resolves through the `<id>-` prefix", async () => {
    const { resolveDependencyFolder } = await import("../../src/serve/serve.ts");
    expect(resolveDependencyFolder(project, "80")?.folder).toBe("80-dependency");
  });

  test("the full folder name resolves as well as the number", async () => {
    const { resolveDependencyFolder } = await import("../../src/serve/serve.ts");
    expect(resolveDependencyFolder(project, "80-dependency")?.folder).toBe("80-dependency");
  });

  test("an archived spec resolves too, and says it is archived", async () => {
    const { resolveDependencyFolder } = await import("../../src/serve/serve.ts");
    const found = resolveDependencyFolder(project, "77");
    expect(found?.folder).toBe("77-old");
    expect(found?.archived).toBe(true);
  });

  test("a live spec wins over an archived one with the same number", async () => {
    const { resolveDependencyFolder } = await import("../../src/serve/serve.ts");
    const both = { ...project, specs: [...project.specs, spec("77-still-here")] };
    expect(resolveDependencyFolder(both, "77")?.folder).toBe("77-still-here");
  });

  test("an unknown id resolves to nothing — that refusal belongs to the run", async () => {
    const { resolveDependencyFolder } = await import("../../src/serve/serve.ts");
    expect(resolveDependencyFolder(project, "99")).toBeUndefined();
  });
});
