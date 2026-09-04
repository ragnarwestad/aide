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
  TOKEN, AUTH,
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

  // Spec 378 (REQ-2): a field-owned check that is UNSET (nothing
  // configured at all, not merely misconfigured) now carries its
  // readiness note on the Config row too — closing the gap the Health
  // tab's removal would otherwise have left unreachable.
  test("no worktree links configured at all is on the Config row (REQ-2)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toMatch(/worktree links/i);
    expect(html).toContain("no worktree links are configured");
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

  // Spec 378 (REQ-1): the Health tab is gone entirely, whatever the
  // readiness answer is — never offered, and a stale `?tab=health` link
  // falls back to Config the same silent way `pickTab` already gives
  // every unknown tab name.
  test("no Health tab ever appears, and ?tab=health falls back to Config (AC5, REQ-1)", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"));
    const html = await (await get(base, "aide")).text();
    expect(html).not.toMatch(/>Health</);
    const fallback = await (await get(base, "aide", "health")).text();
    expect(fallback).not.toContain("<h3>Deploy</h3>");
    expect(fallback).toMatch(/aria-current="page"[^>]*>Config/);
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

// Spec 258 (behavior changed by spec 293): the Deploy tab is offered
// only when it has something to show — a drift answer (AIDE_INSTALL_CMD
// configured) or a Serving comparison (this is the process's own
// checkout). A project with neither no longer carries the tab at all.
describe("the Deploy section on a project's own page (spec 258, spec 293)", () => {
  test("a project with no AIDE_INSTALL_CMD and no Serving comparison has no Deploy tab (AC2)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).not.toMatch(/>Deploy</);
  });

  // AC2's second clause: the pickTab fallback itself. Neither an
  // omitted tab (above) nor a hidden one exercises this path.
  test("?tab=deploy on a project with no AIDE_INSTALL_CMD and no Serving falls back to Config (AC2)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide", "deploy")).text();
    expect(html).not.toContain("<h3>Config</h3>");
    expect(html).not.toContain("<h3>Deploy</h3>");
    expect(html).toMatch(/aria-current="page"[^>]*>Config/);
  });

  test("a project with AIDE_INSTALL_CMD but no drift check yet shows 'not checked' and no button (criterion 2)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    // The schedule is off entirely, so the answer never arrives: exactly
    // the state a fresh boot or a project just added is in.
    const html = await (await get(serve(root, settled(root, "aide"), 0), "aide", "deploy")).text();
    expect(html).not.toContain("<h3>Deploy</h3>");
    expect(html).toContain("origin drift not checked yet");
    expect(html).not.toContain('class="deployform"');
  });

  test("a project behind origin shows the count and a Deploy button (criterion 1)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, behindBy(root, "aide", 3), 25);
    const html = await loadUntil(base, "aide", "commits behind origin", 2000, "deploy");
    expect(html).toContain("3 commits behind origin, checked");
    expect(html).toContain('class="deployform"');
    expect(html).toContain('action="/api/queue/projects/aide/deploy"');
    // The list's own wording ends "— deploy is a hand step", which
    // would contradict the button right beside it here.
    expect(html).not.toContain("deploy is a hand step");
  });

  test("a project level with origin says so, with a disabled Deploy button (criterion 3, spec 321)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, behindBy(root, "aide", 0), 25);
    const html = await loadUntil(base, "aide", "matches origin", 2000, "deploy");
    expect(html).toContain("This checkout matches origin.");
    expect(html).toContain('class="deployform"');
    const form = html.match(/<form[^>]*class="deployform"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toMatch(/<button[^>]*\bdisabled\b/);
    expect(form).toContain('title="This checkout matches origin."');
  });

  // spec 377 (REQ-1, REQ-3, REQ-4): once both drift and the Serving
  // comparison are known and settled, the panel folds them into ONE
  // sentence instead of stacking a drift line above a separate Serving
  // line — and names the commit as a commit, never as a bare SHA.
  test("up to date with the service current folds both into one sentence (spec 377)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const level = behindBy(root, "aide", 0);
    const run: GitRunner = async (dir, args) =>
      args.join(" ") === "rev-parse HEAD" ? { code: 0, stdout: "abc1234deadbeef\n" } : level.run(dir, args);
    const base = serve(root, { run }, 25);
    const html = await loadUntil(base, "aide", "matches origin", 2000, "deploy");
    expect(html).toContain("This checkout matches origin, and the service is running commit abc1234.");
    const form = html.match(/<form[^>]*class="deployform"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toMatch(/<button[^>]*\bdisabled\b/);
    // REQ-3/REQ-7 regression guard: the old bare "Serving <sha> —" form
    // must not return once a commit is named.
    expect(html).not.toContain("Serving abc1234 —");
  });

  // Plan review Risk 4 (3-solution.md): the early-return restructuring
  // that produced the merged sentence must not silently drop `deployError`
  // from the states REQ-6 promises stay unchanged.
  test("a deployError still shows beside an unchecked drift state (REQ-6)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, settled(root, "aide"), 0);
    const html = await (
      await fetch(`${base}/projects/aide?deployError=${encodeURIComponent("could not deploy")}&tab=deploy`, {
        headers: AUTH,
      })
    ).text();
    expect(html).toContain("could not deploy");
    expect(html).toContain("origin drift not checked yet");
  });

  // Spec 321, REQ-2/REQ-5: the control is drawn in both states, never
  // omitted in either — only its `disabled` attribute changes.
  test("the Deploy button is present both behind and level with origin (spec 321)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const behindHtml = await loadUntil(
      serve(root, behindBy(root, "aide", 3), 25), "aide", "commits behind origin", 2000, "deploy",
    );
    expect(behindHtml).toContain('class="deployform"');
    expect(behindHtml.match(/<form[^>]*class="deployform"[\s\S]*?<\/form>/)?.[0] ?? "")
      .not.toMatch(/<button[^>]*\bdisabled\b/);

    const levelHtml = await loadUntil(
      serve(root, behindBy(root, "aide", 0), 25), "aide", "matches origin", 2000, "deploy",
    );
    expect(levelHtml).toContain('class="deployform"');
    expect(levelHtml.match(/<form[^>]*class="deployform"[\s\S]*?<\/form>/)?.[0] ?? "")
      .toMatch(/<button[^>]*\bdisabled\b/);
  });

  // The fail-open case: asked, unanswerable. Never "level" — that would
  // be a guess dressed as an answer.
  // A landing installs but never restarts (the person presses Deploy),
  // so the common case after one is exactly this: level with origin,
  // and a served process older than the checkout. A disabled button
  // there left no way to deploy at all (2026-09-03).
  test("level with origin but serving older code, the Deploy button is live", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const level = behindBy(root, "aide", 0);
    let headCalls = 0;
    const run: GitRunner = async (dir, args) => {
      if (args.join(" ") === "rev-parse HEAD") {
        headCalls += 1;
        return { code: 0, stdout: `${headCalls === 1 ? "abc1234deadbeef" : "9999999cafefeed"}\n` };
      }
      return level.run(dir, args);
    };
    const base = serve(root, { run }, 25);
    const deadline = Date.now() + 2000;
    let html = await (await get(base, "aide", "deploy")).text();
    while ((!html.includes("matches origin") || !html.includes("still running commit")) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      html = await (await get(base, "aide", "deploy")).text();
    }
    expect(html).toContain(
      "This checkout matches origin, but the service is still running commit abc1234; " +
        "Deploy restarts it on commit 9999999.",
    );
    const form = html.match(/<form[^>]*class="deployform"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toContain("Deploy");
    expect(form).not.toMatch(/<button[^>]*\bdisabled\b/);
  });

  test("an unanswerable drift check draws no claim and no button (criterion 4)", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, unanswerable(root, "aide"), 25);
    // Poll until the "not checked yet" state has cleared — a real,
    // timestamped `null` has replaced it — rather than asserting on the
    // very first load, which would still be in the unchecked state.
    const deadline = Date.now() + 2000;
    let html = await (await get(base, "aide", "deploy")).text();
    while (html.includes("origin drift not checked yet") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      html = await (await get(base, "aide", "deploy")).text();
    }
    expect(html).not.toContain("<h3>Deploy</h3>");
    expect(html).toMatch(/aria-current="page"[^>]*>Deploy/);
    expect(html).not.toContain("commits behind origin");
    expect(html).not.toContain("matches origin");
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

// Spec 378, REQ-5: Config's Refresh control forces the one cached answer
// the page has — origin drift — to be re-asked, rather than waiting for
// the background poll's own interval.
describe("POST /api/queue/projects/<name>/refresh (REQ-5)", () => {
  const JSON_AUTH = { ...AUTH, "content-type": "application/json", accept: "application/json" };

  test("busts the cached drift answer the schedule has not reached yet", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    // driftPollMs: 0 disables the background poll, so nothing but the
    // Refresh press itself could ever populate the drift answer.
    const base = serve(root, behindBy(root, "aide", 3), 0);
    const before = await (await get(base, "aide", "deploy")).text();
    expect(before).toContain("origin drift not checked yet");
    const res = await fetch(`${base}/api/queue/projects/aide/refresh`, { method: "POST", headers: JSON_AUTH });
    expect(res.status).toBe(200);
    const after = await (await get(base, "aide", "deploy")).text();
    expect(after).toContain("3 commits behind origin");
  });

  test("a project with no install command still succeeds — nothing cached to force (REQ-5 ungated case)", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"), 0);
    const res = await fetch(`${base}/api/queue/projects/aide/refresh`, { method: "POST", headers: JSON_AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("a no-script press redirects back to the Config tab", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, behindBy(root, "aide", 3), 0);
    const res = await fetch(`${base}/api/queue/projects/aide/refresh`, {
      method: "POST",
      redirect: "manual",
      headers: { "x-aide-token": TOKEN },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=config");
  });

  test("refuses for a project this dashboard does not know", async () => {
    const root = projectsRoot({ aide: null });
    const base = serve(root, settled(root, "aide"), 0);
    const res = await fetch(`${base}/api/queue/projects/nosuch/refresh`, { method: "POST", headers: JSON_AUTH });
    expect(res.status).toBe(404);
  });

  test("only POST — the button's route takes no other method", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, settled(root, "aide"), 0);
    const res = await fetch(`${base}/api/queue/projects/aide/refresh`, { headers: JSON_AUTH });
    expect(res.status).toBe(405);
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
    const html = await loadUntil(
      serve(root, serving(root, "aide", "abc1234deadbeef", "abc1234deadbeef")),
      "aide",
      "Serving",
      2000,
      "deploy",
    );
    expect(html).toContain("Serving commit abc1234 — matches this checkout.");
  });

  test("a checkout that has moved past the served SHA draws a warn line naming both (criterion 4)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await loadUntil(
      serve(root, serving(root, "aide", "abc1234deadbeef", "9999999cafefeed")),
      "aide",
      "Serving",
      2000,
      "deploy",
    );
    expect(html).toContain(
      "Serving commit abc1234, but this checkout is now at commit 9999999 — " +
        "the running service has not picked up the latest merge.",
    );
  });

  // Also covers spec 293 acceptance criterion 2: `other` has neither
  // drift (no AIDE_INSTALL_CMD) nor a Serving comparison (this process
  // runs from `aide`, not `other`), so the Deploy tab this spec's
  // behavior change hides is absent — unlike the old single-scroll
  // layout, where the section stayed regardless.
  test("a project this server does not run from shows no Serving line at all (criterion 5)", async () => {
    const root = projectsRoot({ aide: null, other: null });
    const base = serve(root, serving(root, "aide", "abc1234deadbeef", "abc1234deadbeef"));
    // Give the boot-time read every chance to resolve before asserting its
    // absence — the assertion must mean "this project truly has none", not
    // "the read had not finished yet".
    await loadUntil(base, "aide", "Serving", 2000, "deploy");
    const html = await (await get(base, "other")).text();
    expect(html).not.toContain("Serving");
    expect(html).not.toMatch(/>Deploy</);
  });

  // Spec 318 (REQ-1): the Deploy tab's ungated note stops naming
  // AIDE_INSTALL_CMD by its raw key. The Serving comparison, not drift,
  // is what keeps the Deploy tab present here (spec 293's showDeploy
  // gate), so this is the one case that exercises the "no install
  // command configured" branch without a drift answer at all.
  test("the Deploy tab's ungated note names the setting in plain words (REQ-1)", async () => {
    const root = projectsRoot({ aide: null });
    const html = await loadUntil(
      serve(root, serving(root, "aide", "abc1234deadbeef", "abc1234deadbeef")),
      "aide",
      "Serving",
      2000,
      "deploy",
    );
    expect(html).toMatch(/install command/i);
    expect(html).not.toContain("AIDE_INSTALL_CMD");
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
