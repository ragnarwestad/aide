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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { navEntries } from "../src/render.ts";
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
  test("the page links back to Projects and links to the edit state", async () => {
    const name = "aide & co";
    const root = projectsRoot({ [name]: null });
    const html = await (await get(serve(root, settled(root, name)), name)).text();
    expect(html).toContain('<a class="btn" href="/projects">← Back</a>');
    expect(html).toContain('<a class="btn primary" href="/projects/aide%20%26%20co?edit=1">Edit</a>');
  });

  test("?edit=1 renders the one table as a form posting to the settings route", async () => {
    const name = "aide & co";
    const root = projectsRoot({ [name]: null });
    const base = serve(root, settled(root, name));
    const res = await fetch(`${base}/projects/${encodeURIComponent(name)}?edit=1`, { headers: AUTH });
    const html = await res.text();
    expect(html).toContain('action="/api/queue/projects/aide%20%26%20co/settings"');
    expect(html).toContain('<a class="btn" href="/projects/aide%20%26%20co">Cancel</a>');
    expect(html).toContain(">Save<");
  });

  test("a known project answers 200 with actions and settings, and no manifest or spec list", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const res = await get(serve(root, settled(root, "aide")), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<a class="btn" href="/projects">← Back</a>');
    expect(html).toContain("<h3>Settings</h3>");
    // The manifest dump duplicated the live Specs tab, one click away
    // — a frozen copy of it here said nothing that page did not
    // (2026-08-25).
    expect(html).not.toContain("the aide project");
    // The spec list is the Specs tab — live, filterable, with the
    // controls. A frozen copy of it under the manifest said nothing
    // that page did not (2026-08-22).
    expect(html).not.toContain("<h3>Specs</h3>");
    expect(html).not.toContain("01-first");
  });

  test("a project whose manifest fails to parse still 200s with actions and settings, no error paragraph", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    writeFileSync(join(root, "aide", ".aide", "project.yaml"), "not: [a, mapping");
    const res = await get(serve(root, settled(root, "aide")), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<a class="btn" href="/projects">← Back</a>');
    expect(html).toContain("<h3>Settings</h3>");
    expect(html).not.toContain("Manifest failed to parse");
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
  test("read-only view shows every row's value, and Worktree links names its file (criteria 1, 2)", async () => {
    const root = projectsRoot({ aide: "AIDE_SPECS_PATH=/repos/specs/aide\n" }, ["node_modules"]);
    writeFileSync(
      join(root, "aide", ".aide", "project.yaml"),
      "name: aide\ndescription: the aide project\nworktreeLinks: node_modules\ncodeLanding: pr\n",
    );
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("AIDE_SPECS_PATH");
    expect(html).toContain("/repos/specs/aide");
    expect(html).toContain("AIDE_WORKTREE_LINKS");
    expect(html).toContain("node_modules");
    expect(html).toContain("Code landing");
    expect(html).toContain("Leave it for a pull request");
    // Criterion 2: the manifest's value wins over `.aide/config`'s (there
    // is none here to conflict with), and the Comment column names which
    // file it came from.
    expect(html).toMatch(/node_modules[\s\S]{0,300}configured, from \.aide\/project\.yaml/);
    // Exactly one settings table (criterion 1) — no leftover second one
    // from the removed plain-text summary or `<details>` editor.
    expect((html.match(/<table class="list">/g) ?? []).length).toBe(1);
  });

  test("?edit=1 pre-fills the editable inputs with the current values (criterion 3)", async () => {
    const root = projectsRoot({ aide: "AIDE_SPECS_PATH=/repos/specs/aide\n" }, ["node_modules"]);
    writeFileSync(
      join(root, "aide", ".aide", "project.yaml"),
      "name: aide\ndescription: the aide project\nworktreeLinks: node_modules\ncodeLanding: pr\n",
    );
    const base = serve(root, settled(root, "aide"));
    const html = await (await fetch(`${base}/projects/aide?edit=1`, { headers: AUTH })).text();
    expect(html).toMatch(/name="specsPath"[^>]*value="\/repos\/specs\/aide"/);
    expect(html).toMatch(/name="worktreeLinks"[^>]*value="node_modules"/);
    expect(html).toMatch(/value="pr"[^>]*selected|selected[^>]*value="pr"/);
  });

  test("?edit=1 keeps the three derivable keys read-only, even when one is unset (criterion 3)", async () => {
    // No lockfile at all: AIDE_LINT_CMD, a DERIVABLE key, is `unset` —
    // the gate must read key membership, not the row's current origin.
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const base = serve(root, settled(root, "aide"));
    const html = await (await fetch(`${base}/projects/aide?edit=1`, { headers: AUTH })).text();
    expect(html).not.toContain('name="AIDE_TEST_CMD"');
    expect(html).not.toContain('name="AIDE_LINT_CMD"');
    expect(html).not.toContain('name="AIDE_BUILD_CMD"');
    // Meanwhile a non-derivable, currently-unset key does become an input.
    expect(html).toMatch(/name="jiraBaseUrl"[^>]*value=""/);
  });

  test("the table has one row per SETTING_KEYS entry plus Code landing, under Name/Value/Comment (criterion 1)", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("<th>Name</th><th>Value</th><th>Comment</th>");
    expect(html).not.toContain("<th>Setting</th>");
    expect(html).not.toContain("<th>Where from</th>");
    for (const key of [
      "AIDE_SPECS_PATH", "AIDE_WORKTREE_LINKS", "AIDE_TEST_CMD", "AIDE_LINT_CMD",
      "AIDE_BUILD_CMD", "AIDE_INSTALL_CMD", "AIDE_JIRA_BASE_URL",
    ]) {
      expect(html).toContain(`<td>${key}</td>`);
    }
    expect(html).toContain("<td>Code landing</td>");
  });
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

  // Spec 255's own criterion 7: a regression guard, not a new bug fix —
  // `noFile` was already a single top-level block before the unified
  // table existed, and this protects that property through the refactor.
  test("the no-config notice appears exactly once, above the one table (spec 255 criterion 7)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect((html.match(/no \.aide\/config/g) ?? []).length).toBe(1);
  });
});

// Spec 259: a project's own recurring jobs, shown on its own page —
// acceptance criteria 6 and 7.
describe("what the page says about its schedule (spec 259, acceptance criteria 6-7)", () => {
  test("a manifest with schedule entries shows each one's fields (criterion 7)", async () => {
    const root = projectsRoot({ aide: null });
    writeFileSync(
      join(root, "aide", ".aide", "project.yaml"),
      "name: aide\nschedule:\n  - name: nightly-report\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n",
    );
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("Schedule");
    expect(html).toContain("nightly-report");
    expect(html).toContain("0 3 * * *");
    expect(html).toContain("docs/nightly.md");
  });

  test("a manifest with no schedule key renders no Schedule section (criterion 6)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).not.toContain("<h3>Schedule</h3>");
  });
});

// Spec 255: the edit/save/cancel controls the unified table gained.
describe("editing the unified settings table (spec 255)", () => {
  const POST_AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  test("Cancel is a plain link back to the page with no ?edit and posts nothing (criterion 4)", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    const html = await (await fetch(`${base}/projects/aide?edit=1`, { headers: AUTH })).text();
    expect(html).toContain('<a class="btn" href="/projects/aide">Cancel</a>');
  });

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
    const view = await (await fetch(`${base}/projects/aide`, { headers: AUTH })).text();
    expect(view).toContain("make install");
    expect(view).not.toContain('name="installCmd"');
  });

  test("saving AIDE_JIRA_BASE_URL left unchanged rewrites nothing (criterion 6)", async () => {
    const root = projectsRoot({ aide: "AIDE_JIRA_BASE_URL=https://jira.example.com\n" });
    const project = join(root, "aide");
    const before = readFileSync(join(project, ".aide", "config"), "utf-8");
    const base = serve(root, settled(root, "aide"));
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: POST_AUTH,
      body: JSON.stringify({
        jiraBaseUrl: "https://jira.example.com",
        specsPath: "",
        worktreeLinks: "",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { step: string }[] };
    expect(body.results.map((r) => r.step)).not.toContain("jiraBaseUrl");
    expect(readFileSync(join(project, ".aide", "config"), "utf-8")).toBe(before);
  });

  test("a no-script save that is refused reopens the edit state, not the read-only view", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ worktreeLinks: "/etc" }),
    });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/projects/aide?edit=1")).toBe(true);
    const refusalHtml = await (await fetch(`${base}${location}`, { headers: AUTH })).text();
    expect(refusalHtml).toContain("/etc");
    expect(refusalHtml).toContain(">Save<");
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

// The served nav is Specs and Projects — the Archive tab was there from
// spec 163 until spec 221 put every archived spec on the Specs list.
// A project is reached
// from the Projects page, which lists every one of them with its
// counts, its warnings and its controls — so naming them in the tab bar
// as well put each project there twice, and the bar grew with the
// machine's project count. The GENERATED site keeps them: it has no
// server, and its nav is the only way between its pages.
// A tab per project came from the days this was a generated site with
// a page per project and no server (aide-dashboard spec 01). Both went
// on 2026-08-22: a project is reached from the Projects page, which
// lists every one with its counts, its warnings and its controls.
describe("the nav does not name the projects", () => {
  test("it is the two tabs, whatever projects the machine has", () => {
    expect(navEntries().map((e) => e.label)).toEqual(["Projects"]);
  });

  test("a server started with --root builds a nav with no project in it", () => {
    const root = projectsRoot({ aide: null });
    const site = mkdtempSync(join(tmpdir(), "aide-detail-site-"));
    ownDirs.push(site);
    const opts = parseArgs(["--site", site, "--root", root]);
    expect(opts.navEntries?.some((e) => e.label === "aide")).toBe(false);
    expect(opts.navEntries?.map((e) => e.label)).toEqual(["Projects"]);
  });
});
