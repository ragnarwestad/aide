// The Bun server accepts runs and serves them as
// JSON through the generator's layout; pages carry a Live entry.
// Path-traversal refusal is `serveStatic`'s own guard, covered where it
// is actually still called — `/schedule-output/`
// (test/serve/schedule/schedule-output-route.test.ts).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
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

// The first IPv4 address of this machine that is not loopback, if it has one.
const lanAddress = (): string | undefined =>
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

describe("the address the server listens on", () => {
  test("with no bindHost it listens on 127.0.0.1 only", async () => {
    expect(server.hostname).toBe("127.0.0.1");
    const viaName = await fetch(`http://localhost:${server.port}/projects.html`, { redirect: "manual" });
    expect(viaName.status).toBe(302);
    const lan = lanAddress();
    if (lan) await expect(fetch(`http://${lan}:${server.port}/projects.html`, { redirect: "manual" })).rejects.toThrow();
  });

  test("a bindHost given is used as given", async () => {
    const wide = createServer({ port: 0, mirrorPath: join(dir, "wide-runs.json"), bindHost: "0.0.0.0" });
    try {
      expect(wide.hostname).toBe("0.0.0.0");
      const lan = lanAddress();
      if (lan) {
        const res = await fetch(`http://${lan}:${wide.port}/projects.html`, { redirect: "manual" });
        expect(res.status).toBeGreaterThan(0);
      }
    } finally {
      wide.stop();
    }
  });
});

// --- /projects.html is a redirect, answered by the server, ---
// with no site directory involved at all ---------------------------
describe("GET /projects.html", () => {
  test("redirects to /projects, keeping the query string", async () => {
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

describe("TDD phases in /api/aide-runs", () => {
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

// --- /projects is a served page ------------------------------------
//
// The panel that adds and removes projects needs a token behind it, and
// a generated file has no server to check one against. So the overview
// became a route: same listing, same rows, plus the two controls — and
// the same guard `/` has, for the same reason.
describe("GET /projects", () => {
  const harness = queueHarness("aide-projects-route-");
  afterEach(() => harness.cleanup());

  test("the Add page is served, and Remove project has no page of its own", async () => {
    const { base } = harness.start();
    const add = await fetch(`${base}/projects/new`);
    expect(add.status).toBe(200);
    expect(await add.text()).toContain('action="/api/queue/projects"');
    expect((await fetch(`${base}/projects/aide/remove`)).status).toBe(404);
  });

  // With no --root there is no project set to list, and an empty listing
  // would read as "no projects" rather than "this server was not told
  // where they are" — so the page itself says so, in a notice, instead
  // of bouncing to a file that no longer exists.
  test("without --root it renders the ordinary page with a notice", async () => {
    const { base } = harness.start({ extra: { projectRoot: undefined } });
    const res = await fetch(`${base}/projects`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("no project root");
  });

  // And its own Add page redirects to /projects too, not to
  // the removed file: nothing to add a project TO, but the page that
  // explains why still exists.
  test("without --root, /projects/new redirects to /projects", async () => {
    const { base } = harness.start({ extra: { projectRoot: undefined } });
    const res = await fetch(`${base}/projects/new`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/projects");
  });
});

// --- Which folder a `Depends on:` entry means ----------------------
//
// The scheduling gate needs the same answer `aide-run-spec`'s own
// `resolve_dependency_folder` gives, in TypeScript: exact folder first,
// then an `<id>-` prefix, live specs before archived ones. A second
// reader of one rule, so it gets its own tests — the cases below mirror
// the bash suite's one for one.
describe("parseArgs", () => {
  // Which spec this process is a test board for.
  test("--test-board sets testBoardSpec", () => {
    expect(parseArgs(["--test-board", "424-headeren-sier-hvilket-board"]).testBoardSpec).toBe(
      "424-headeren-sier-hvilket-board",
    );
  });

  test("without --test-board, testBoardSpec is absent (an ordinary server)", () => {
    expect(parseArgs([]).testBoardSpec).toBeUndefined();
  });
});

describe("resolveDependencyFolder", () => {
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
