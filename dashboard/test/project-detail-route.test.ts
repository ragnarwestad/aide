// Spec 185: a project's own page, served live.
//
// Everything the description asks for was already computed somewhere —
// `assessProjectReadiness` says why a run cannot start, `configValue`
// reads the file — and the reader could see none of it. Readiness ran
// once, at Add, and travelled to the browser as a query-string notice
// that is gone on the next load; the project's page itself was a
// batch-generated file with no server behind it to ask git anything.
//
// The questions here are the wiring ones: that the page is SERVED (so
// the answer is current at the moment it is read, not at the moment
// some unrelated merge last regenerated the site), that a reason a run
// cannot start is on it with nothing pressed, that a derived command is
// hedged as a default rather than shown as a promise, and that a git
// which cannot answer leaves a page behind rather than a stack trace.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { navEntries, type ProjectView } from "../src/render.ts";
import { parseArgs } from "../src/serve.ts";
import type { GitRunner } from "../src/branch-status.ts";
import { queueHarness } from "./helpers/queue-server.ts";
import { fakeGit } from "./helpers/fake-git.ts";

const harness = queueHarness("aide-project-detail-");
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const TOKEN = "s3cret-token";
const AUTH = { "x-aide-token": TOKEN };

/** A projects root this suite owns, so the paths git is asked about are
 *  the paths the test names. Each project is discoverable (a manifest
 *  and one spec) and gets the `.aide/config` it was given — `null` for
 *  a project with no config file at all, which is the state a checkout
 *  on a second machine is in. */
function projectsRoot(projects: Record<string, string | null>, files: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-detail-root-"));
  ownDirs.push(dir);
  for (const [name, config] of Object.entries(projects)) {
    const project = join(dir, name);
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), `name: ${name}\ndescription: the ${name} project\n`);
    mkdirSync(join(project, "specs", "01-first"), { recursive: true });
    writeFileSync(join(project, "specs", "01-first", "1-description.md"), "# First - Description\n");
    if (config !== null) writeFileSync(join(project, ".aide", "config"), config);
    for (const f of files) writeFileSync(join(project, f), "");
  }
  return dir;
}

/** A checkout that is its own repository, on its default branch, with
 *  every other question answered the boring way. */
const settled = (root: string, name: string) =>
  fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${join(root, name)}\n` },
    "symbolic-ref": { code: 0, stdout: "origin/main\n" },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "show-ref": { code: 0 },
  });

/** A checkout stuck on a branch a run cannot move it off: origin/HEAD
 *  names `main`, and no `main` exists here or on origin. */
const stranded = (root: string, name: string) =>
  fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${join(root, name)}\n` },
    "symbolic-ref": { code: 0, stdout: "origin/main\n" },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "feature-x\n" },
    "show-ref": { code: 1 },
  });

function serve(root: string, git: { run: GitRunner }): string {
  return harness.start({
    extra: { projectRoot: root, queueProjectRoot: root, gitRun: git.run, queueToken: TOKEN },
  }).base;
}

const get = (base: string, name: string) =>
  fetch(`${base}/projects/${encodeURIComponent(name)}`, { headers: AUTH });

describe("GET /projects/<name> — the project's own page, served", () => {
  test("a known project answers 200 with its manifest and its specs", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const res = await get(serve(root, settled(root, "aide")), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("the aide project");
    expect(html).toContain("01-first");
  });

  test("a project nobody has is 404, not an empty page", async () => {
    const root = projectsRoot({ aide: null });
    expect((await get(serve(root, settled(root, "aide")), "nosuch")).status).toBe(404);
  });

  test("only GET — the page changes nothing and takes no post", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    const res = await fetch(`${base}/projects/aide`, { method: "POST", headers: AUTH });
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
      const res = await fetch(`${base}/projects/${name}`, { headers: AUTH });
      expect([name, res.status]).toEqual([name, 404]);
    }
  });

  // Generically guarded by `isQueuePath`'s `/projects/` prefix, which
  // predates this route — worth one test all the same, because a read
  // route that slipped outside the guard would hand the whole config of
  // every project to anyone who can reach the port.
  test("without the token the page is refused", async () => {
    const root = projectsRoot({ aide: null });
    const res = await fetch(`${serve(root, settled(root, "aide"))}/projects/aide`);
    expect(res.status).toBe(401);
  });
});

describe("what the page says about the settings (criteria 1-3, 7)", () => {
  test("a configured test command is shown as configured (criterion 1)", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("make test");
    expect(html).toMatch(/make test[\s\S]{0,200}configured/);
  });

  test("no .aide/config at all is said plainly, not shown as seven silent blanks (criterion 2)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("no .aide/config");
    expect(html).toContain("not set");
    expect(html).toContain("AIDE_INSTALL_CMD");
  });

  test("a lockfile decides the test command, and the page names the file it read (criterion 3)", async () => {
    const root = projectsRoot({ aide: "" }, ["pnpm-lock.yaml"]);
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("pnpm test -- --run");
    expect(html).toContain("pnpm-lock.yaml");
  });

  // The risk the plan named: the table's commands are "the usual
  // defaults, not a promise", so a derived row must READ as a default
  // rather than as a command somebody verified.
  test("a derived command carries the hedge, not just the command", async () => {
    const root = projectsRoot({ aide: "" }, ["pnpm-lock.yaml"]);
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("not a verified command");
    // The toolchain by name, which is what makes the hedge mean
    // something: it is pnpm's default, not this project's command.
    expect(html).toContain("the usual pnpm default");
  });

  test("a key with neither a value nor anything to work it out from reads not set (criterion 7)", async () => {
    const root = projectsRoot({ aide: "" });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toMatch(/AIDE_BUILD_CMD[\s\S]{0,200}not set/);
    expect(html).not.toContain("not a verified command");
  });
});

describe("what the page says about whether a run could start (criteria 4-6, 8)", () => {
  test("a checkout a run cannot move to its default branch says so, with nothing pressed (criterion 6)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, stranded(root, "aide")), "aide")).text();
    expect(html).toContain("there is no such branch, here or on origin");
    // The whole point: no Add, no Run, no query string — a plain GET.
    expect(html).toContain("cannot run");
  });

  test("a settled checkout says a run could start here", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).not.toContain("there is no such branch");
    expect(html).toContain("ready to run");
  });

  test("a worktree link with nothing to link is on the page (criterion 4)", async () => {
    const root = projectsRoot({ aide: "AIDE_WORKTREE_LINKS=node_modules\n" });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("a run refuses a worktree link with nothing to link");
  });

  test("a specs root that is not there is on the page (criterion 5)", async () => {
    const root = projectsRoot({ aide: "AIDE_SPECS_PATH=/tmp/aide-no-such-specs-root\n" });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("there is no specs root at /tmp/aide-no-such-specs-root");
  });

  // Fail-open, the way the drift check on /projects already does: the
  // reader came for the project's page, and an unreachable git is no
  // reason to withhold the half of it that needs no git.
  test("a git that answers nothing still leaves the page standing (criterion 8)", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const res = await get(serve(root, fakeGit({})), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("the aide project");
    expect(html).toContain("make test");
  });

  test("a git that THROWS still leaves the page standing, with no readiness section", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const run: GitRunner = async () => {
      throw new Error("git is not on this machine");
    };
    const res = await get(serve(root, { run }), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("make test");
    expect(html).not.toContain("cannot run");
  });

  // Read-only, and provably so: a page load that moved a checkout is
  // the one thing nobody asked this page for.
  test("the page never merges, pulls, fetches or checks anything out", async () => {
    const root = projectsRoot({ aide: null });
    const git = settled(root, "aide");
    await get(serve(root, git), "aide");
    for (const forbidden of ["merge", "pull", "reset", "checkout", "fetch", "switch"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
  });
});

// The served nav is Specs, Projects and Archive. A project is reached
// from the Projects page, which lists every one of them with its
// counts, its warnings and its controls — so naming them in the tab bar
// as well put each project there twice, and the bar grew with the
// machine's project count. The GENERATED site keeps them: it has no
// server, and its nav is the only way between its pages.
describe("the served nav does not name the projects; the generated one must", () => {
  const views = (...names: string[]): ProjectView[] =>
    names.map((name) => ({ name, manifest: { ok: true, data: {} }, specs: [] }));

  test("a live nav is the three tabs and nothing per project", () => {
    const entries = navEntries(views("aide", "woodstack"), { live: true });
    expect(entries.map((e) => e.label)).toEqual(["Projects", "Archive"]);
  });

  test("the generator's nav still names every project, and the file it writes", () => {
    const entries = navEntries(views("aide", "woodstack"));
    expect(entries.find((e) => e.label === "aide")?.path).toBe("aide.html");
    expect(entries.find((e) => e.label === "woodstack")?.path).toBe("woodstack.html");
  });

  test("a server started with --root builds a nav with no project in it", () => {
    const root = projectsRoot({ aide: null });
    const site = mkdtempSync(join(tmpdir(), "aide-detail-site-"));
    ownDirs.push(site);
    const opts = parseArgs(["--site", site, "--root", root]);
    expect(opts.navEntries?.some((e) => e.label === "aide")).toBe(false);
  });
});
