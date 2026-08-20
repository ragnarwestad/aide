// Spec 142: the /projects route is where a checkout's drift becomes
// visible. The dashboard's own Merge button runs the project's
// AIDE_INSTALL_CMD and reports what happened; a merge made from a
// laptop, the GitHub web UI or another machine runs nothing at all, and
// until this route asked, nothing on the serving host ever compared its
// checkout against origin.
//
// The questions here are the wiring ones the render tests cannot ask:
// WHICH projects are checked — the ones that expect an install to have
// happened, and only those — and that a git which cannot answer still
// leaves a page behind.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "./helpers/queue-server.ts";
import { fakeGit } from "./helpers/fake-git.ts";

const harness = queueHarness("aide-projects-route-");
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** What a checkout on its default branch, `n` commits behind origin,
 *  answers to every call the drift check makes. */
const behindBy = (n: number) =>
  fakeGit({
    "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/main\n" },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    fetch: { code: 0 },
    "rev-list --count": { code: 0, stdout: `${n}\n` },
  });

/** A projects root this suite owns, so the paths git is asked about are
 *  the paths the test names — the shared harness makes its own and
 *  leaves `queueProjectRoot` unset, which resolves a checkout to a bare
 *  relative name. Every named project is discoverable (a manifest and
 *  one spec) and gets the `.aide/config` it was given, or none. */
function projectsRoot(projects: Record<string, string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-projects-root-"));
  ownDirs.push(dir);
  for (const [name, config] of Object.entries(projects)) {
    const project = join(dir, name);
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), `name: ${name}\n`);
    mkdirSync(join(project, "specs", "01-first"), { recursive: true });
    writeFileSync(join(project, "specs", "01-first", "1-description.md"), "# First - Description\n");
    if (config !== null) writeFileSync(join(project, ".aide", "config"), config);
  }
  return dir;
}

const INSTALLS = "AIDE_INSTALL_CMD=deploy/install-after-merge.sh\n";

/** The whole queue surface, `/projects` included, is behind the token. */
const TOKEN = "s3cret-token";
const AUTH = { "x-aide-token": TOKEN };

function serve(root: string, git: ReturnType<typeof behindBy>): string {
  return harness.start({
    extra: { projectRoot: root, queueProjectRoot: root, gitRun: git.run, queueToken: TOKEN },
  }).base;
}

const load = async (base: string): Promise<string> =>
  await (await fetch(`${base}/projects`, { headers: AUTH })).text();

describe("GET /projects and a checkout that fell behind origin", () => {
  test("a project that expects an install and is behind says how far (criterion 2)", async () => {
    const git = behindBy(3);
    const html = await load(serve(projectsRoot({ aide: INSTALLS }), git));
    expect(html).toContain("3 commits behind origin — deploy is a hand step");
    // Asked of the project's own checkout, not of the projects root.
    expect(git.calls.some((c) => c.dir.endsWith("/aide"))).toBe(true);
  });

  test("a project level with origin gets no banner (criterion 1)", async () => {
    const html = await load(serve(projectsRoot({ aide: INSTALLS }), behindBy(0)));
    expect(html).not.toContain("behind origin");
  });

  // Deploying is already a known hand step where no install command is
  // configured. This banner is for the projects that expect one to have
  // run and silently did not get it.
  test("a project with no AIDE_INSTALL_CMD is never asked, however far behind (criterion 3)", async () => {
    const git = behindBy(9);
    const html = await load(serve(projectsRoot({ atlasaurus: null }), git));
    expect(html).not.toContain("behind origin");
    expect(git.calls.length).toBe(0);
  });

  test("a config with other keys but no install command is the same as none (criterion 3)", async () => {
    const git = behindBy(9);
    const html = await load(serve(projectsRoot({ atlasaurus: "AIDE_SPECS_PATH=/tmp/specs\n" }), git));
    expect(html).not.toContain("behind origin");
    expect(git.calls.length).toBe(0);
  });

  test("one project behind does not put a banner on the one beside it", async () => {
    const html = await load(serve(projectsRoot({ aide: INSTALLS, atlasaurus: null }), behindBy(2)));
    expect(html).toContain("2 commits behind origin");
    expect(html).not.toMatch(/atlasaurus[\s\S]*?behind origin/);
  });

  // Fail-open, the same way isMerged degrades: an unreachable origin
  // leaves the page it was asked about, not an error.
  test("a git that cannot answer leaves the page standing, with no banner (criterion 5)", async () => {
    const git = fakeGit({ "symbolic-ref": { code: 128 }, "show-ref": { code: 1 } });
    const base = serve(projectsRoot({ aide: INSTALLS }), git);
    const res = await fetch(`${base}/projects`, { headers: AUTH });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h2>Projects</h2>");
    expect(html).not.toContain("behind origin");
  });

  // Read-only, and provably so: the route may fetch, but a page load
  // that moved the checkout would be the very thing the description
  // says nobody asked for.
  test("the page never merges, pulls or checks anything out", async () => {
    const git = behindBy(4);
    await load(serve(projectsRoot({ aide: INSTALLS }), git));
    for (const forbidden of ["merge", "pull", "reset", "checkout"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
  });
});
