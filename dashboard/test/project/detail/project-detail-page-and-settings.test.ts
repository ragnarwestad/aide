// Split out of project-detail-route.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, ownDirs, projectsRoot, scheduleConfig, settled, serve, get, setTestCmd } from "./project-detail-route-fixtures.ts";

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

describe("GET /projects/<name> — the project's own page, served", () => {

  test("a known project answers 200 with actions and settings", async () => {
    const root = projectsRoot({ aide: "" });
    setTestCmd(root, "aide", "make test");
    const res = await get(serve(root, settled(root, "aide")), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<a class="backlink" rel="noreferrer" href="/projects">← Back</a>');
    expect(html).toMatch(/aria-current="page"[^>]*>Config/);
  });

  test("a project whose manifest fails to parse still 200s with actions and settings, no error paragraph", async () => {
    const root = projectsRoot({ aide: "" });
    setTestCmd(root, "aide", "make test");
    writeFileSync(join(root, "aide", ".aide", "project.yaml"), "not: [a, mapping");
    const res = await get(serve(root, settled(root, "aide")), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<a class="backlink" rel="noreferrer" href="/projects">← Back</a>');
    expect(html).toMatch(/aria-current="page"[^>]*>Config/);
    expect(html).not.toContain("Manifest failed to parse");
  });

  test("a project nobody has is 404, not an empty page", async () => {
    const root = projectsRoot({ aide: null });
    expect((await get(serve(root, settled(root, "aide")), "nosuch")).status).toBe(404);
  });

  test("only GET — the page changes nothing and takes no post", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    const res = await fetch(`${base}/projects/aide`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  // The name is looked UP among the discovered projects before it is
  // ever joined to a path, and a discovered name is a directory entry —
  // it can hold neither a slash nor a `..` segment. An encoded one is
  // therefore a 404 and not a read somewhere else on the disk.
  test("an encoded path in the name reaches nothing", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    // Encoded, both of them. A dot segment cannot be tried at all:
    // `/projects/..` and `/projects/%2E%2E` alike are normalised away
    // by the client before the server sees a request.
    for (const name of ["..%2F..%2Fetc", "%2Fetc%2Fpasswd"]) {
      const res = await fetch(`${base}/projects/${name}`);
      expect([name, res.status]).toEqual([name, 404]);
    }
  });

  // A plain GET with no ?tab= opens on Deploy, the first tab, marked
  // current in the bar — the same aria-current pattern the job and spec
  // pages already assert on their own tabs.
  test("a plain GET with no ?tab= opens on Deploy, marked current", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await fetch(`${serve(root, settled(root, "aide"))}/projects/aide`)).text();
    expect(html).toMatch(/aria-current="page"[^>]*>Deploy/);
  });

});

describe("what the page says about the settings (criteria 1-3, 7)", () => {

  // Edit offers the worked-out command as a placeholder, never as the
  // field's value: a save that never touched the row must not configure
  // a command nobody chose.
  test("?edit=manifest leaves an unset test command's field empty, with the suggestion as its placeholder", async () => {
    const root = projectsRoot({ aide: "" }, ["pnpm-lock.yaml"]);
    const base = serve(root, settled(root, "aide"));
    const html = await (await fetch(`${base}/projects/aide?edit=manifest`)).text();
    expect(html).toMatch(/name="testCmd"[^>]*placeholder="pnpm test -- --run"><\/textarea>/);
  });

});

// Spec 259: a project's own recurring jobs, shown on its own page —
// acceptance criteria 6 and 7.
describe("what the page says about its schedule (spec 259, acceptance criteria 6-7)", () => {
  const NIGHTLY = { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" };

  test("the queue config's jobs for the project show each one's fields (AC-5)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide"), undefined, scheduleConfig([NIGHTLY])), "aide", "schedule")).text();
    expect(html).toContain("Schedule");
    expect(html).toContain("nightly-report");
    expect(html).toContain("0 3 * * *");
    expect(html).toContain("docs/nightly.md");
  });

  test("a manifest's own schedule: list is not shown — only the config's jobs are (AC-2)", async () => {
    const root = projectsRoot({ aide: null });
    writeFileSync(
      join(root, "aide", ".aide", "project.yaml"),
      "name: aide\nschedule:\n  - name: from-manifest\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n",
    );
    const html = await (await get(serve(root, settled(root, "aide")), "aide", "schedule")).text();
    expect(html).not.toContain("from-manifest");
    expect(html).toMatch(/nothing is scheduled/i);
  });

  // Spec 468, Risk 2: a project outside the queue's own allowlist is
  // still reachable from /projects and still gets the New page — its
  // submission is refused by the create route.
  test("a project outside the queue's allowlist still gets the New page, and a submission is refused (Risk 2)", async () => {
    const root = projectsRoot({ aide: null, other: null });
    const base = serve(root, settled(root, "aide"));
    const html = await (await fetch(`${base}/schedule/new?project=other`)).text();
    expect(html).toContain('<input type="hidden" name="project" value="other">');
    const res = await fetch(`${base}/api/queue/schedule`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        project: "other", name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md",
      }).toString(),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("is not a project this dashboard knows");
  });
});

// Spec 255: the edit/save/cancel controls the unified table gained.
describe("editing the unified settings table (spec 255)", () => {
  const POST_AUTH = { "content-type": "application/json", accept: "application/json" };

  test("saving a changed AIDE_INSTALL_CMD writes .aide/config and the redirect target shows it in view mode (criterion 5)", async () => {
    const root = projectsRoot({ aide: null });
    const project = join(root, "aide");
    const base = serve(root, settled(root, "aide"));
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: POST_AUTH,
      body: JSON.stringify({ installCmd: "make install", specsPath: "", worktreeLinks: "" }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(project, ".aide", "config"), "utf-8")).toContain("AIDE_INSTALL_CMD=make install");
    const view = await (await get(base, "aide")).text();
    expect(view).toContain("make install");
    expect(view).not.toContain('name="installCmd"');
  });

  test("saving AIDE_INSTALL_CMD left unchanged rewrites nothing (criterion 6)", async () => {
    const root = projectsRoot({ aide: "AIDE_INSTALL_CMD=make install\n" });
    const project = join(root, "aide");
    const before = readFileSync(join(project, ".aide", "config"), "utf-8");
    const base = serve(root, settled(root, "aide"));
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: POST_AUTH,
      body: JSON.stringify({
        installCmd: "make install",
        specsPath: "",
        worktreeLinks: "",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { step: string }[] };
    expect(body.results.map((r) => r.step)).not.toContain("installCmd");
    expect(readFileSync(join(project, ".aide", "config"), "utf-8")).toBe(before);
  });

});
