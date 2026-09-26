// Split out of project-detail-route.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, ownDirs, projectsRoot, scheduleConfig, settled, serve, get } from "./project-detail-route-fixtures.ts";

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

describe("GET /projects/<name> — the project's own page, served", () => {
  test("the page links back to Projects and links to the edit state", async () => {
    const name = "aide & co";
    const root = projectsRoot({ [name]: null });
    const html = await (await get(serve(root, settled(root, name)), name)).text();
    expect(html).toContain('<a class="backlink" href="/projects">← Back</a>');
    expect(html).toContain('<a class="btn primary" href="/projects/aide%20%26%20co?edit=1">Edit</a>');
  });

  test("?edit=1 renders the one table as a form posting to the settings route", async () => {
    const name = "aide & co";
    const root = projectsRoot({ [name]: null });
    const base = serve(root, settled(root, name));
    const res = await fetch(`${base}/projects/${encodeURIComponent(name)}?edit=1`);
    const html = await res.text();
    expect(html).toContain('action="/api/queue/projects/aide%20%26%20co/settings"');
    expect(html).toContain('<a class="btn" data-discard-changes href="/projects/aide%20%26%20co">Cancel</a>');
    expect(html).toContain(">Save<");
  });

  test("a known project answers 200 with actions and settings", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const res = await get(serve(root, settled(root, "aide")), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<a class="backlink" href="/projects">← Back</a>');
    expect(html).toMatch(/aria-current="page"[^>]*>Config/);
  });

  test("a project whose manifest fails to parse still 200s with actions and settings, no error paragraph", async () => {
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    writeFileSync(join(root, "aide", ".aide", "project.yaml"), "not: [a, mapping");
    const res = await get(serve(root, settled(root, "aide")), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<a class="backlink" href="/projects">← Back</a>');
    expect(html).toMatch(/aria-current="page"[^>]*>Config/);
    expect(html).not.toContain("Manifest failed to parse");
  });

  // Spec 408, REQ-1/REQ-4: this route reads and remembers the language
  // the same way `/` already does.
  test("?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    const res = await fetch(`${base}/projects/aide?lang=nb`);
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
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
    // "Create", not "leave it for": the run makes the pull request
    // itself (`gh pr create` in aide-run-spec).
    expect(html).toContain("Create a pull request");
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
    const html = await (await fetch(`${base}/projects/aide?edit=1`)).text();
    expect(html).toMatch(/name="specsPath"[^>]*>\/repos\/specs\/aide<\/textarea>/);
    expect(html).toMatch(/name="worktreeLinks"[^>]*>node_modules<\/textarea>/);
    expect(html).toMatch(/value="pr"[^>]*selected|selected[^>]*value="pr"/);
  });

  test("?edit=1 keeps lint and build read-only, even when one is unset, and fills a configured test command (criterion 3)", async () => {
    // No lockfile at all: AIDE_LINT_CMD, a DERIVABLE key, is `unset` —
    // the gate must read key membership, not the row's current origin.
    const root = projectsRoot({ aide: "AIDE_TEST_CMD=make test\n" });
    const base = serve(root, settled(root, "aide"));
    const html = await (await fetch(`${base}/projects/aide?edit=1`)).text();
    expect(html).not.toContain('name="AIDE_TEST_CMD"');
    expect(html).not.toContain('name="AIDE_LINT_CMD"');
    expect(html).not.toContain('name="AIDE_BUILD_CMD"');
    // The test command is what runs use, so it is an input, holding the
    // configured value.
    expect(html).toMatch(/name="testCmd"[^>]*>make test<\/textarea>/);
    // Meanwhile a non-derivable, currently-unset key does become an input.
    expect(html).toMatch(/name="installCmd"[^>]*><\/textarea>/);
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

  // A worked-out test command runs nothing: the runner and a landing
  // read a configured one only. The row said "the project's own test
  // command" over one no run used, and nobody saw that nothing tested.
  test("an unset test command says no tests run, and names the worked-out one as the suggestion", async () => {
    const root = projectsRoot({ aide: "" }, ["pnpm-lock.yaml"]);
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    const row = html.slice(html.indexOf("AIDE_TEST_CMD"), html.indexOf("</tr>", html.indexOf("AIDE_TEST_CMD")));
    expect(row).toContain("not set — no tests run when a spec lands");
    expect(row).toContain("<code>pnpm test -- --run</code>");
    expect(row).not.toContain("not a verified command");
  });

  // Edit offers the worked-out command as a placeholder, never as the
  // field's value: a save that never touched the row must not configure
  // a command nobody chose.
  test("?edit=1 leaves an unset test command's field empty, with the suggestion as its placeholder", async () => {
    const root = projectsRoot({ aide: "" }, ["pnpm-lock.yaml"]);
    const base = serve(root, settled(root, "aide"));
    const html = await (await fetch(`${base}/projects/aide?edit=1`)).text();
    expect(html).toMatch(/name="testCmd"[^>]*placeholder="pnpm test -- --run"><\/textarea>/);
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

  // Spec 378 (REQ-6): the Schedule tab is now ALWAYS offered — a
  // project's tab bar no longer changes shape depending on whether it
  // has anything scheduled — and says in a sentence when it has nothing.
  test("a manifest with no schedule key still offers a Schedule tab, saying nothing is scheduled (REQ-6)", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    const html = await (await get(base, "aide")).text();
    expect(html).toMatch(/>Schedule</);
    const panel = await (await get(base, "aide", "schedule")).text();
    expect(panel).toMatch(/aria-current="page"[^>]*>Schedule/);
    expect(panel).toMatch(/nothing is scheduled/i);
  });

  // Spec 468: the New-job form moved here from the aggregate /schedule
  // page — the project is fixed by the page, so it rides as a hidden
  // field, never a select (AC-1, AC-2).
  test("the tab shows a New-job form for this project, with no project select (AC-1, AC-2)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide", "schedule")).text();
    expect(html).toContain('action="/api/queue/schedule"');
    expect(html).toContain('<input type="hidden" name="project" value="aide">');
    expect(html).not.toContain('<select name="project">');
  });

  // Spec 468, AC-6: the aggregate list's row no longer points here
  // directly (it points at this tab instead), so this is now the one
  // place an entry's own detail page is reachable from.
  test("an entry's name links to its own detail page (AC-6)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide"), undefined, scheduleConfig([NIGHTLY])), "aide", "schedule")).text();
    expect(html).toContain('href="/schedule/aide/nightly-report"');
  });

  // Spec 468, Risk 2: a project outside the queue's own allowlist is
  // still reachable from /projects and still gets the form (AC-1 is
  // unconditional) — its submission is refused by the existing create
  // route, and the refusal shows through the form's own error line,
  // exactly like a bad cron or a duplicate name already does.
  test("a project outside the queue's allowlist still gets the form, and a submission is refused inline (Risk 2)", async () => {
    const root = projectsRoot({ aide: null, other: null });
    const base = serve(root, settled(root, "aide"));
    const html = await (await get(base, "other", "schedule")).text();
    expect(html).toContain('<input type="hidden" name="project" value="other">');
    const res = await fetch(`${base}/api/queue/schedule`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        project: "other", name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md",
      }).toString(),
    });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/projects/other?tab=schedule&error=")).toBe(true);
    const refusalHtml = await (await fetch(`${base}${location}`)).text();
    expect(refusalHtml).toContain("is not a project this dashboard knows");
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
    const view = await (await fetch(`${base}/projects/aide`)).text();
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

  test("a no-script save that is refused reopens the edit state, not the read-only view", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    const FORM = { "content-type": "application/x-www-form-urlencoded" };
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ worktreeLinks: "/etc" }),
    });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/projects/aide?edit=1")).toBe(true);
    const refusalHtml = await (await fetch(`${base}${location}`)).text();
    expect(refusalHtml).toContain("/etc");
    expect(refusalHtml).toContain(">Save<");
  });
});
