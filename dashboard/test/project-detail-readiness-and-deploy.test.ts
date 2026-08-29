// Split out of project-detail-route.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { navEntries } from "../src/render.ts";
import { parseArgs } from "../src/serve/serve.ts";
import type { GitRunner } from "../src/git/branch-status.ts";
import { fakeGit } from "./helpers/fake-git.ts";
import {
  harness, ownDirs, projectsRoot, settled, stranded, serve, get, behindBy, unanswerable, INSTALLS, loadUntil,
} from "./project-detail-route-fixtures.ts";

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
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

// Spec 258: the Deploy section — always present, whether or not the
// project is gated, so a project with no AIDE_INSTALL_CMD says plainly
// why there is nothing to act on rather than showing nothing at all.
describe("the Deploy section on a project's own page (spec 258)", () => {
  test("a project with no AIDE_INSTALL_CMD keeps the section, with no count and no button (criterion 5)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("<h3>Deploy</h3>");
    expect(html).toContain("origin drift is not tracked here");
    expect(html).not.toContain('class="deployform"');
  });

  test("a project with AIDE_INSTALL_CMD but no drift check yet shows 'not checked' and no button (criterion 2)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    // The schedule is off entirely, so the answer never arrives: exactly
    // the state a fresh boot or a project just added is in.
    const html = await (await get(serve(root, settled(root, "aide"), 0), "aide")).text();
    expect(html).toContain("<h3>Deploy</h3>");
    expect(html).toContain("origin drift not checked yet");
    expect(html).not.toContain('class="deployform"');
  });

  test("a project behind origin shows the count and a Deploy button (criterion 1)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, behindBy(root, "aide", 3), 25);
    const html = await loadUntil(base, "aide", "commits behind origin");
    expect(html).toContain("3 commits behind origin, checked");
    expect(html).toContain('class="deployform"');
    expect(html).toContain('action="/api/queue/projects/aide/deploy"');
    // The list's own wording ends "— deploy is a hand step", which
    // would contradict the button right beside it here.
    expect(html).not.toContain("deploy is a hand step");
  });

  test("a project level with origin says so, with no button (criterion 3)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, behindBy(root, "aide", 0), 25);
    const html = await loadUntil(base, "aide", "level with origin");
    expect(html).toContain("This checkout is level with origin.");
    expect(html).not.toContain('class="deployform"');
  });

  // The fail-open case: asked, unanswerable. Never "level" — that would
  // be a guess dressed as an answer.
  test("an unanswerable drift check draws no claim and no button (criterion 4)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, unanswerable(root, "aide"), 25);
    // Poll until the "not checked yet" state has cleared — a real,
    // timestamped `null` has replaced it — rather than asserting on the
    // very first load, which would still be in the unchecked state.
    const deadline = Date.now() + 2000;
    let html = await (await get(base, "aide")).text();
    while (html.includes("origin drift not checked yet") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      html = await (await get(base, "aide")).text();
    }
    expect(html).toContain("<h3>Deploy</h3>");
    expect(html).not.toContain("commits behind origin");
    expect(html).not.toContain("level with origin");
    expect(html).not.toContain("origin drift not checked yet");
    expect(html).not.toContain('class="deployform"');
  });

  // Criterion 9: the request itself spawns no git — with the schedule
  // disabled, any call at all could only have come from the GET handler.
  test("the request spawns no fetch, pull, merge or checkout, even when the project is gated", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const git = settled(root, "aide");
    await get(serve(root, git, 0), "aide");
    for (const forbidden of ["merge", "pull", "reset", "checkout", "fetch", "switch"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
  });
});

// Spec 269: whether the process actually serving this page has picked up
// what is on disk — a process-vs-disk question the drift banner above
// cannot answer, because it only ever compares the checkout to origin.
describe('the "Serving" line on a project\'s own page (spec 269)', () => {
  /** A checkout that is ALSO the repository this server process itself
   *  runs from — the scenario the comparison is built for. The bare
   *  `rev-parse HEAD` two different reads share (the server's own
   *  boot-time read, and the page's live re-read of the checkout) answers
   *  `bootSha` the FIRST time it is asked and `checkoutSha` every time
   *  after — reproducing the real shape, where the same question is asked
   *  once at boot and again on every page load, never in the other
   *  order. */
  function serving(root: string, name: string, bootSha: string, checkoutSha: string): { run: GitRunner } {
    let headCalls = 0;
    const run: GitRunner = async (_dir, args) => {
      const cmd = args.join(" ");
      if (cmd === "rev-parse HEAD") {
        headCalls += 1;
        return { code: 0, stdout: `${headCalls === 1 ? bootSha : checkoutSha}\n` };
      }
      if (cmd.startsWith("rev-parse --show-toplevel")) return { code: 0, stdout: `${join(root, name)}\n` };
      if (cmd.startsWith("symbolic-ref")) return { code: 0, stdout: "origin/main\n" };
      if (cmd.startsWith("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "main\n" };
      if (cmd.startsWith("show-ref")) return { code: 0, stdout: "" };
      return { code: 1, stdout: "" };
    };
    return { run };
  }

  test("matching SHAs draw an info line naming the short SHA (criterion 3)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await loadUntil(serve(root, serving(root, "aide", "abc1234deadbeef", "abc1234deadbeef")), "aide", "Serving");
    expect(html).toContain("Serving abc1234 — matches this checkout.");
  });

  test("a checkout that has moved past the served SHA draws a warn line naming both (criterion 4)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await loadUntil(
      serve(root, serving(root, "aide", "abc1234deadbeef", "9999999cafefeed")),
      "aide",
      "Serving",
    );
    expect(html).toContain(
      "Serving abc1234, but this checkout is now at 9999999 — the running service has not picked up the latest merge.",
    );
  });

  test("a project this server does not run from shows no Serving line at all (criterion 5)", async () => {
    const root = projectsRoot({ aide: null, other: null });
    const base = serve(root, serving(root, "aide", "abc1234deadbeef", "abc1234deadbeef"));
    // Give the boot-time read every chance to resolve before asserting its
    // absence — the assertion must mean "this project truly has none", not
    // "the read had not finished yet".
    await loadUntil(base, "aide", "Serving");
    const html = await (await get(base, "other")).text();
    expect(html).not.toContain("Serving");
    // The existing drift banner is unaffected and unchanged.
    expect(html).toContain("<h3>Deploy</h3>");
  });
});

// The served nav is Specs, Projects and Schedule — the Archive tab was
// there from spec 163 until spec 221 put every archived spec on the
// Specs list. A project is reached
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
  test("it is the two aggregate tabs, whatever projects the machine has", () => {
    expect(navEntries().map((e) => e.label)).toEqual(["Projects", "Schedule"]);
  });

  test("a server started with --root builds a nav with no project in it", () => {
    const root = projectsRoot({ aide: null });
    const site = mkdtempSync(join(tmpdir(), "aide-detail-site-"));
    ownDirs.push(site);
    const opts = parseArgs(["--site", site, "--root", root]);
    expect(opts.navEntries?.some((e) => e.label === "aide")).toBe(false);
    expect(opts.navEntries?.map((e) => e.label)).toEqual(["Projects", "Schedule"]);
  });
});
