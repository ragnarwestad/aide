// Spec 142: the /projects route is where a checkout's drift becomes
// visible. The dashboard's own Merge button runs the project's
// AIDE_INSTALL_CMD and reports what happened; a merge made from a
// laptop, the GitHub web UI or another machine runs nothing at all, and
// until this route asked, nothing on the serving host ever compared its
// checkout against origin.
//
// Spec 203 moved WHEN that comparison happens. The page load used to
// make it and wait — `git fetch` against GitHub, per project, inside
// the request — which put /projects at 1.83 s against 0.04 s for the
// pages beside it, and got slower with every project added. The check
// runs on a schedule of its own now and the render reads the last
// answer it has.
//
// So the questions here are the wiring ones the render tests cannot
// ask: that the REQUEST spawns no git for drift at all, that the
// SCHEDULE does, WHICH projects it asks about — the ones that expect an
// install to have happened, and only those — and that a git which
// cannot answer still leaves a page behind.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "./helpers/queue-server.ts";
import { fakeGit } from "./helpers/fake-git.ts";
import type { GitRunner } from "../src/git/branch-status.ts";

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

/** `driftPollMs` is the schedule under test, so every case names it.
 *  `0` turns the background check off entirely — which is how "the poll
 *  has not answered for this project yet" is held still long enough to
 *  assert on. */
function serve(root: string, git: { run: GitRunner }, driftPollMs: number): string {
  return harness.start({
    extra: { projectRoot: root, queueProjectRoot: root, gitRun: git.run, queueToken: TOKEN, driftPollMs },
  }).base;
}

const load = async (base: string): Promise<string> =>
  await (await fetch(`${base}/projects`, { headers: AUTH })).text();

/** The calls the DRIFT check makes, and only those. Since spec 184 the
 *  page also asks each project whether a run could start there, which is
 *  read-only git of its own — counting every call would make this suite
 *  about that instead. */
const driftCalls = (git: { calls: { dir: string; args: string[] }[] }) =>
  git.calls.filter((c) => c.args[0] === "fetch" || c.args.join(" ").startsWith("rev-list --count"));

/** Poll `/projects` until it says `text`, or give up. The background
 *  check is a timer, so the answer arrives a moment after the server
 *  starts rather than during the first request — the same bounded-loop
 *  idiom `queue-routes.test.ts` uses for the runner's own interval,
 *  never an open-ended wait. */
async function loadUntil(base: string, text: string, budgetMs = 2000): Promise<string> {
  const deadline = Date.now() + budgetMs;
  let html = "";
  while (Date.now() < deadline) {
    html = await load(base);
    if (html.includes(text)) return html;
    await new Promise((r) => setTimeout(r, 25));
  }
  return html;
}

describe("GET /projects and a checkout that fell behind origin", () => {
  test("a project that expects an install and is behind says how far (criterion 2)", async () => {
    const git = behindBy(3);
    const html = await loadUntil(serve(projectsRoot({ aide: INSTALLS }), git, 25), "behind origin");
    expect(html).toContain("3 commits behind origin, checked just now — deploy is a hand step");
    // Asked of the project's own checkout, not of the projects root.
    expect(git.calls.some((c) => c.dir.endsWith("/aide"))).toBe(true);
  });

  test("a project level with origin gets no banner (criterion 1)", async () => {
    const git = behindBy(0);
    const base = serve(projectsRoot({ aide: INSTALLS }), git, 25);
    // Wait for the poll to have run at all, then ask.
    await loadUntil(base, "never appears", 200);
    expect(await load(base)).not.toContain("behind origin");
  });

  // Deploying is already a known hand step where no install command is
  // configured. This banner is for the projects that expect one to have
  // run and silently did not get it.
  test("a project with no AIDE_INSTALL_CMD is never asked, however far behind (criterion 3)", async () => {
    const git = behindBy(9);
    const base = serve(projectsRoot({ atlasaurus: null }), git, 25);
    await loadUntil(base, "never appears", 200);
    const html = await load(base);
    expect(html).toContain("proj-row");
    expect(html).not.toContain("behind origin");
    expect(html).not.toContain("not checked yet");
    expect(driftCalls(git).length).toBe(0);
  });

  test("a config with other keys but no install command is the same as none (criterion 3)", async () => {
    const git = behindBy(9);
    const base = serve(projectsRoot({ atlasaurus: "AIDE_SPECS_PATH=/tmp/specs\n" }), git, 25);
    await loadUntil(base, "never appears", 200);
    expect(await load(base)).not.toContain("behind origin");
    expect(driftCalls(git).length).toBe(0);
  });

  test("one project behind does not put a banner on the one beside it", async () => {
    const base = serve(projectsRoot({ aide: INSTALLS, atlasaurus: null }), behindBy(2), 25);
    const html = await loadUntil(base, "behind origin");
    expect(html).toContain("2 commits behind origin");
    expect(html).not.toMatch(/atlasaurus[\s\S]*?behind origin/);
  });

  // Fail-open, the same way isMerged degrades: an unreachable origin
  // leaves the page it was asked about, not an error.
  test("a git that cannot answer leaves the page standing, with no banner (criterion 5)", async () => {
    const git = fakeGit({ "symbolic-ref": { code: 128 }, "show-ref": { code: 1 } });
    const base = serve(projectsRoot({ aide: INSTALLS }), git, 25);
    await loadUntil(base, "never appears", 200);
    const res = await fetch(`${base}/projects`, { headers: AUTH });
    expect(res.status).toBe(200);
    const html = await res.text();
    // The list is still drawn — its own top line and a row per project.
    // The <h2> that used to prove that is gone: "Projects" is said once,
    // in the tab (2026-08-21).
    expect(html).toContain('class="summary"');
    expect(html).toContain('class="proj-row"');
    expect(html).not.toContain("behind origin");
  });

  // Read-only, and provably so: the check may fetch, but a page load
  // that moved the checkout would be the very thing the description
  // says nobody asked for. Asserted against every call the SCHEDULE
  // makes now, not just the ones one page load made.
  test("nothing here merges, pulls, resets or checks anything out", async () => {
    const git = behindBy(4);
    const base = serve(projectsRoot({ aide: INSTALLS }), git, 25);
    await loadUntil(base, "behind origin");
    for (const forbidden of ["merge", "pull", "reset", "checkout"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
  });
});

// Spec 203: the request path reads memory and disk. It never reaches
// the network, and never waits on a subprocess whose time nobody has
// bounded.
describe("GET /projects never waits on git for drift", () => {
  test("a page load makes no drift call of its own (criterion 1)", async () => {
    const git = behindBy(3);
    const base = serve(projectsRoot({ aide: INSTALLS }), git, 25);
    await loadUntil(base, "behind origin");
    // Whatever the schedule has spent so far, the next page load spends
    // nothing: peekDrift is a map read.
    const before = driftCalls(git).length;
    expect(before).toBeGreaterThan(0);
    const html = await load(base);
    expect(html).toContain("3 commits behind origin");
    expect(driftCalls(git).length).toBe(before);
  });

  // The reported bug itself. Against the old code the request awaited
  // this fetch and the response arrived only when the runner's own 4 s
  // timeout fired; here it must not wait for it at all.
  test("an origin that never answers does not hold the page up (criterion 2)", async () => {
    const stuck: GitRunner = async (_dir, args) => {
      if (args[0] === "fetch") return await new Promise(() => {});
      if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/main\n" };
      if (args.join(" ").startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "main\n" };
      return { code: 1, stdout: "" };
    };
    const base = serve(projectsRoot({ aide: INSTALLS }), { run: stuck }, 25);
    const res = await Promise.race([
      fetch(`${base}/projects`, { headers: AUTH }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the page waited on git")), 500)),
    ]);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('class="proj-row"');
  });

  // Gated for the check, but nothing has answered yet. `driftPollMs: 0`
  // holds that state still; in production it is the first moment after
  // a boot, or a project just added.
  test("a project the schedule has not reached says so, and renders (criterion 3)", async () => {
    const git = behindBy(3);
    const base = serve(projectsRoot({ aide: INSTALLS }), git, 0);
    const res = await fetch(`${base}/projects`, { headers: AUTH });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("origin drift not checked yet");
    expect(html).not.toContain("behind origin");
    // Nothing polls, and the request does not poll on its behalf.
    expect(driftCalls(git).length).toBe(0);
  });

  // The schedule, not the request, is what produces the answer.
  test("the background poll fills in the count a later load shows (criterion 4)", async () => {
    const git = behindBy(6);
    const base = serve(projectsRoot({ aide: INSTALLS }), git, 25);
    const html = await loadUntil(base, "6 commits behind origin");
    expect(html).toContain("6 commits behind origin");
  });

  // Risk analysis's second risk, made a test: one project's git going
  // wrong must not take the poll — or the projects beside it — down.
  test("one project's git hanging does not stop the others being checked (criterion 8)", async () => {
    const calls: { dir: string; args: string[] }[] = [];
    const mixed: GitRunner = async (dir, args) => {
      calls.push({ dir, args });
      // atlasaurus's origin never answers. Only the FETCH hangs: the
      // readiness check beside the drift check reads local git and is
      // allowed to, so hanging everything would be a test about that
      // instead.
      if (dir.endsWith("/atlasaurus") && args[0] === "fetch") return await new Promise(() => {});
      if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/main\n" };
      if (args.join(" ").startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "main\n" };
      if (args[0] === "fetch") return { code: 0, stdout: "" };
      if (args.join(" ").startsWith("rev-list --count")) return { code: 0, stdout: "5\n" };
      return { code: 1, stdout: "" };
    };
    const root = projectsRoot({ aide: INSTALLS, atlasaurus: INSTALLS });
    const base = serve(root, { run: mixed }, 25);
    const html = await loadUntil(base, "5 commits behind origin");
    expect(html).toContain("5 commits behind origin");
    // And the schedule keeps ticking rather than being stuck on the
    // round that never finished. The hanging project is what shows it:
    // nothing ever answers for it, so nothing is cached for it, and
    // every further tick asks it again. (aide would not show this — its
    // answer is cached for the checker's TTL, so a tick inside that
    // window is right to ask nothing.)
    const asked = () =>
      calls.filter((c) => c.dir.endsWith("/atlasaurus") && c.args[0] === "fetch").length;
    const roundOne = asked();
    expect(roundOne).toBeGreaterThan(0);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && asked() === roundOne) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(asked()).toBeGreaterThan(roundOne);
    // And the project that never answered says nothing rather than
    // zero: fail-open, the same rule the whole check keeps.
    expect(html).not.toMatch(/atlasaurus[\s\S]*?behind origin/);
  }, 15000);
});
