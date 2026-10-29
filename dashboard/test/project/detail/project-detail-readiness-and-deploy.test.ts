// Split out of project-detail-route.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { navEntries } from "../../../src/render";
import { NO_DEPLOY_SENTENCE } from "../../../src/render/pages/projects-page/project-page.ts";
import { parseArgs } from "../../../src/serve/serve.ts";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { fakeGit } from "../../helpers/fake-git.ts";
import { harness, ownDirs, projectsRoot, settled, stranded, serve, get, behindBy, unanswerable, INSTALLS, loadUntil, setTestCmd, setWorktreeLinks } from "./project-detail-route-fixtures.ts";

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

describe("what the page says about whether a run could start", () => {
  test("a checkout a run cannot move to its default branch says so, with nothing pressed", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, stranded(root, "aide")), "aide")).text();
    expect(html).toContain("there is no such branch, here or on origin");
    // The whole point: no Add, no Run, no query string — a plain GET.
    expect(html).toContain("cannot start");
  });

  test("a settled checkout says a run could start here", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).not.toContain("there is no such branch");
    expect(html).toContain("ready to run");
  });

  test("a worktree link with nothing to link is on the page", async () => {
    const root = projectsRoot({ aide: null });
    setWorktreeLinks(root, "aide", "node_modules");
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("A run refuses a worktree link with nothing to link");
  });

  // A field-owned check that is UNSET (nothing
  // configured at all, not merely misconfigured) now carries its
  // readiness note on the Config row too — closing the gap the Health
  // tab's removal would otherwise have left unreachable.
  test("no worktree links configured at all is on the Config row", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toMatch(/worktree links/i);
    expect(html).toContain("No worktree links are configured");
  });

  test("a specs root that is not there is on the page", async () => {
    const root = projectsRoot({ aide: "AIDE_SPECS_PATH=/tmp/aide-no-such-specs-root\n" });
    const html = await (await get(serve(root, settled(root, "aide")), "aide")).text();
    expect(html).toContain("There is no specs root at /tmp/aide-no-such-specs-root");
  });

  // Fail-open, the way the drift check on /projects already does: the
  // reader came for the project's page, and an unreachable git is no
  // reason to withhold the half of it that needs no git.
  test("a git that answers nothing still leaves the page standing", async () => {
    const root = projectsRoot({ aide: "" });
    setTestCmd(root, "aide", "make test");
    const res = await get(serve(root, fakeGit({})), "aide");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("make test");
  });

  test("a git that THROWS still leaves the page standing, with no readiness section", async () => {
    const root = projectsRoot({ aide: "" });
    setTestCmd(root, "aide", "make test");
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

// The Deploy tab is offered on every project, but only the board's own
// project has a Deploy: every other project's tab counts its checkout
// against origin and says plainly that nothing is offered there.

/** The buttons on a page whose label says Deploy. The tab bar's own Deploy is a link. */
const deployButtons = (page: string): string[] => {
  const html = page.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, "");
  return html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Deploy(?:(?!<\/button>)[\s\S])*<\/button>/g) ?? [];
};

/** The messages on a page, one string per box, so a test reads one line at a time. */
const messages = (html: string): string[] => html.match(/<div class="[^"]*\browmsg\b[^"]*">[\s\S]*?<\/div>/g) ?? [];

/** The board's own server: the checkout of `aide` is the one this process runs from. */
const serveBoard = (root: string, git: { run: GitRunner }, driftPollMs?: number): string =>
  harness.start({
    extra: {
      projectRoot: root,
      queueProjectRoot: root,
      gitRun: git.run,
      ...(driftPollMs !== undefined ? { driftPollMs } : {}),
      dashboardRoot: join(root, "aide"),
    },
  }).base;

/** The board's Deploy ask button, whole opening tag. */
const askTag = (html: string): string => html.match(/<button\b[^>]*data-ask="deployask"[^>]*>/)?.[0] ?? "";

describe("the Deploy tab of a project that is not the board's own", () => {
  test("a project with an install command, behind origin, has no Deploy button", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const html = await loadUntil(serve(root, behindBy(root, "aide", 2), 25), "aide", "2 commits behind origin", 2000, "deploy");
    expect(html).toContain("2 commits behind origin, checked");
    expect(deployButtons(html)).toEqual([]);
    expect(html).not.toContain('class="deployform"');
  });

  test("a project with no install command has no Deploy button", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide")), "aide", "deploy")).text();
    expect(deployButtons(html)).toEqual([]);
  });

  test("the tab says once that Deploy is not offered, with or without an install command, and never names the board", async () => {
    for (const config of [INSTALLS, null]) {
      const root = projectsRoot({ aide: config });
      const html = await (await get(serve(root, settled(root, "aide"), 0), "aide", "deploy")).text();
      expect(html.split(NO_DEPLOY_SENTENCE).length - 1).toBe(1);
      expect(NO_DEPLOY_SENTENCE).not.toMatch(/board/i);
      expect(messages(html).filter((m) => m.includes(NO_DEPLOY_SENTENCE))[0]).not.toMatch(/board/i);
    }
  });

  test("the tab bar offers Deploy, with or without an install command", async () => {
    for (const config of [INSTALLS, null]) {
      const root = projectsRoot({ aide: config });
      const html = await (await get(serve(root, settled(root, "aide"), 0), "aide", "config")).text();
      expect(html).toMatch(/<a [^>]*>Deploy<\/a>/);
    }
  });

  test("a project with no install command is counted against origin by the background poll, and the section carries the address the page asks origin through", async () => {
    const root = projectsRoot({ aide: null });
    const html = await loadUntil(serve(root, behindBy(root, "aide", 3), 25), "aide", "3 commits behind origin", 2000, "deploy");
    expect(html).toContain("3 commits behind origin, checked");
    expect(html).toContain('data-origin-check="/api/queue/projects/aide/drift"');
  });

  test("a project with no install command and no answer from origin yet reloads itself", async () => {
    const root = projectsRoot({ aide: null });
    const html = await (await get(serve(root, settled(root, "aide"), 0), "aide", "deploy")).text();
    expect(html).toContain("has not been checked yet");
    expect(html).toContain("data-reload-every=");
  });

  test("the behind-origin sentence names no Deploy action", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const html = await loadUntil(serve(root, behindBy(root, "aide", 2), 25), "aide", "2 commits behind origin", 2000, "deploy");
    const lines = messages(html).filter((m) => m.includes("2 commits behind origin"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("Deploy");
  });

  test("a project level with origin says so", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const html = await loadUntil(serve(root, behindBy(root, "aide", 0), 25), "aide", "matches origin", 2000, "deploy");
    expect(html).toContain("This checkout matches origin.");
    expect(deployButtons(html)).toEqual([]);
  });

  // The fail-open case: asked, unanswerable. Never "level" — that would
  // be a guess dressed as an answer.
  test("an unanswerable drift check draws no claim", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, unanswerable(root, "aide"), 25);
    // Poll until the "not checked yet" state has cleared — a real,
    // timestamped `null` has replaced it — rather than asserting on the
    // very first load, which would still be in the unchecked state.
    const deadline = Date.now() + 15_000;
    let html = await (await get(base, "aide", "deploy")).text();
    while (
      html.includes("Whether this checkout is behind origin has not been checked yet") &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 25));
      html = await (await get(base, "aide", "deploy")).text();
    }
    expect(html).toMatch(/aria-current="page"[^>]*>Deploy/);
    expect(html).not.toContain("commits behind origin");
    expect(html).not.toContain("matches origin");
    expect(html).not.toContain("Whether this checkout is behind origin has not been checked yet");
  });

  // The request itself spawns no git — with the schedule
  // disabled, any call at all could only have come from the GET handler.
  test("the request spawns no fetch, pull, merge or checkout", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const git = settled(root, "aide");
    await get(serve(root, git, 0), "aide");
    for (const forbidden of ["merge", "pull", "reset", "checkout", "fetch", "switch"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
  });
});

describe("the Deploy tab of the board's own project", () => {
  test("behind origin, it shows the count and a live Deploy ask button, and not the sentence that Deploy is not offered", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const html = await loadUntil(serveBoard(root, behindBy(root, "aide", 3), 25), "aide", "commits behind origin", 2000, "deploy");
    expect(html).toContain("3 commits behind origin, checked");
    expect(html).not.toContain(NO_DEPLOY_SENTENCE);
    expect(askTag(html)).not.toBe("");
    expect(askTag(html)).not.toMatch(/\bdisabled\b/);
    expect(deployButtons(html)).toHaveLength(1);
    // The list's own wording ends "— deploy is a hand step", which
    // would contradict the button right beside it here.
    expect(html).not.toContain("deploy is a hand step");
  });

  test("level with origin, the ask button is off", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const html = await loadUntil(serveBoard(root, behindBy(root, "aide", 0), 25), "aide", "matches origin", 2000, "deploy");
    expect(html).toContain("This checkout matches origin.");
    expect(askTag(html)).toMatch(/\bdisabled\b/);
    expect(askTag(html)).toContain('title="This checkout matches origin."');
  });

  // The never-asked state says so
  // in the same one sentence every other state uses, with a present,
  // inactive button.
  test("with no drift check yet, it shows the not-yet-checked sentence and an off button", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    // The schedule is off entirely, so the answer never arrives: exactly
    // the state a fresh boot or a project just added is in.
    const html = await (await get(serveBoard(root, settled(root, "aide"), 0), "aide", "deploy")).text();
    expect(html).toContain("Whether this checkout is behind origin has not been checked yet.");
    expect(html).not.toContain("AIDE_INSTALL_CMD");
    expect(askTag(html)).toMatch(/\bdisabled\b/);
    expect(askTag(html)).toContain('title="Origin has not been checked yet."');
  });

  // The one state where the panel names what the
  // served commit actually is — how far behind it is, and what the newest
  // change was — rather than a bare hash, because origin itself is still
  // unknown here.
  describe("the not-yet-checked sentence naming the served commit", () => {
    /** A never-checked drift (`settled`, no background poll) that is ALSO
     *  the checkout this server runs from: the boot-time `rev-parse HEAD`
     *  answers `bootSha` once, every later read (the page's own, and the
     *  two reads gated on the not-yet-checked state) answers
     *  `checkoutSha`/the given subject/count. */
    const servingUnchecked = (
      root: string,
      name: string,
      bootSha: string,
      checkoutSha: string,
      newestSubject: string,
      behindCount: number,
    ) =>
      fakeGit({
        "rev-parse --show-toplevel": { code: 0, stdout: `${join(root, name)}\n` },
        "rev-parse HEAD": [{ code: 0, stdout: `${bootSha}\n` }, { code: 0, stdout: `${checkoutSha}\n` }],
        "log -1 --format=%s": { code: 0, stdout: `${newestSubject}\n` },
        "rev-list --count": { code: 0, stdout: `${behindCount}\n` },
      });

    test("names how far behind the service is and the newest change", async () => {
      const root = projectsRoot({ aide: INSTALLS });
      const base = serveBoard(
        root,
        servingUnchecked(root, "aide", "abc1234deadbeef", "9999999cafefeed", "Add the frobnicator", 2),
        0,
      );
      const html = await loadUntil(base, "aide", "Whether this checkout", 2000, "deploy");
      // The sentence is rendered through `esc()`, so its quotes come out
      // as `&quot;` the same way any other HTML text does.
      expect(html).toContain(
        "Whether this checkout is behind origin has not been checked yet; the service is 2 commits " +
          "behind this checkout — the newest change is &quot;Add the frobnicator&quot;.",
      );
      expect(askTag(html)).toMatch(/\bdisabled\b/);
    });

    test("names the newest change with no 'behind' claim when the service is current", async () => {
      const root = projectsRoot({ aide: INSTALLS });
      const base = serveBoard(
        root,
        servingUnchecked(root, "aide", "abc1234deadbeef", "abc1234deadbeef", "Add the frobnicator", 0),
        0,
      );
      const html = await loadUntil(base, "aide", "Whether this checkout", 2000, "deploy");
      expect(html).toContain(
        "Whether this checkout is behind origin has not been checked yet; the service is already " +
          "running the newest change, &quot;Add the frobnicator&quot;.",
      );
      expect(html).not.toContain("commits behind this checkout");
    });
  });

  // A landing installs but never restarts (the person presses Deploy),
  // so the common case after one is exactly this: level with origin,
  // and a served process older than the checkout. A disabled button
  // there left no way to deploy at all (2026-09-03).
  test("level with origin but serving older code, the Deploy ask button is live", async () => {
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
    const base = serveBoard(root, { run }, 25);
    const deadline = Date.now() + 15_000;
    let html = await (await get(base, "aide", "deploy")).text();
    while ((!html.includes("matches origin") || !html.includes("still running commit")) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      html = await (await get(base, "aide", "deploy")).text();
    }
    expect(html).toContain(
      "This checkout matches origin, but the service is still running commit abc1234; " +
        "Deploy restarts it on commit 9999999.",
    );
    expect(askTag(html)).not.toBe("");
    expect(askTag(html)).not.toMatch(/\bdisabled\b/);
  });
});

// The Projects-list banner these two tests originally proved is
// gone, but the schedule-level guarantee they prove — a hung origin never
// blocks a request, and never stalls the OTHER projects' own ticks — is
// still real, and `/projects/<name>?tab=deploy` makes the exact same
// `peekDrift` read the list used to. Ported from `projects-route.test.ts`
// rather than dropped.
describe("refreshDrift's schedule-level guarantees (ported from the /projects route)", () => {
  test("an origin that never answers does not hold a project's Deploy tab up", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const settledRun = settled(root, "aide").run;
    const stuck: GitRunner = async (dir, args) =>
      args[0] === "fetch" ? await new Promise(() => {}) : settledRun(dir, args);
    const base = serve(root, { run: stuck }, 25);
    const res = await Promise.race([
      get(base, "aide", "deploy"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the page waited on git")), 500)),
    ]);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/aria-current="page"[^>]*>Deploy/);
  });

  test("one project's git hanging does not stop refreshDrift asking about the one beside it", async () => {
    const calls: { dir: string; args: string[] }[] = [];
    const mixed: GitRunner = async (dir, args) => {
      calls.push({ dir, args });
      // atlasaurus's origin never answers. Only the FETCH hangs: the
      // readiness check beside the drift check reads local git and is
      // allowed to, so hanging everything would be a test about that
      // instead.
      if (dir.endsWith("/atlasaurus") && args[0] === "fetch") return await new Promise(() => {});
      const cmd = args.join(" ");
      if (cmd.startsWith("rev-parse --show-toplevel")) return { code: 0, stdout: `${dir}\n` };
      if (cmd.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/main\n" };
      if (cmd.startsWith("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "main\n" };
      if (cmd.startsWith("show-ref")) return { code: 0, stdout: "" };
      if (args[0] === "fetch") return { code: 0, stdout: "" };
      if (cmd.startsWith("rev-list --count")) return { code: 0, stdout: "5\n" };
      return { code: 1, stdout: "" };
    };
    const root = projectsRoot({ aide: INSTALLS, atlasaurus: INSTALLS });
    const base = serve(root, { run: mixed }, 25);
    const html = await loadUntil(base, "aide", "5 commits behind origin", 2000, "deploy");
    expect(html).toContain("5 commits behind origin");
    // And the schedule keeps ticking rather than being stuck on the round
    // that never finished. The hanging project is what shows it: nothing
    // ever answers for it, so every further tick asks it again.
    const asked = () =>
      calls.filter((c) => c.dir.endsWith("/atlasaurus") && c.args[0] === "fetch").length;
    const roundOne = asked();
    expect(roundOne).toBeGreaterThan(0);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && asked() === roundOne) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(asked()).toBeGreaterThan(roundOne);
  }, 15000);
});

// Whether the process actually serving this page has picked up
// what is on disk — a process-vs-disk question the drift banner above
// cannot answer, because it only ever compares the checkout to origin.
describe('the "Serving" line on a project\'s own page', () => {
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

  test("matching SHAs draw an info line naming the short SHA", async () => {
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

  test("a checkout that has moved past the served SHA draws a warn line naming both", async () => {
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

  // `other` has neither drift (no AIDE_INSTALL_CMD) nor a Serving
  // comparison (this process runs from `aide`, not `other`) — its Deploy
  // tab is still offered, it just has no Serving line
  // to show on it.
  test("a project this server does not run from shows no Serving line at all", async () => {
    const root = projectsRoot({ aide: null, other: null });
    const base = serve(root, serving(root, "aide", "abc1234deadbeef", "abc1234deadbeef"));
    // Give the boot-time read every chance to resolve before asserting its
    // absence — the assertion must mean "this project truly has none", not
    // "the read had not finished yet".
    await loadUntil(base, "aide", "Serving", 2000, "deploy");
    const html = await (await get(base, "other")).text();
    expect(html).not.toContain("Serving");
    expect(html).toMatch(/>Deploy</);
  });

});

// The served nav is Specs, Projects and Schedule — there is no Archive
// tab, since every archived spec is on the
// Specs list. A project is reached
// from the Projects page, which lists every one of them with its
// counts, its warnings and its controls — so naming them in the tab bar
// as well put each project there twice, and the bar grew with the
// machine's project count. The GENERATED site keeps them: it has no
// server, and its nav is the only way between its pages.
// A tab per project came from the days this was a generated site with
// a page per project and no server. Both went
// on 2026-08-22: a project is reached from the Projects page, which
// lists every one with its counts, its warnings and its controls.
describe("the nav does not name the projects", () => {
  test("it is the two aggregate tabs, whatever projects the machine has", () => {
    expect(navEntries().map((e) => e.label)).toEqual(["Projects", "Schedule"]);
  });

  test("a server started with --root builds a nav with no project in it", () => {
    const root = projectsRoot({ aide: null });
    const opts = parseArgs(["--root", root]);
    expect(opts.navEntries?.some((e) => e.label === "aide")).toBe(false);
    expect(opts.navEntries?.map((e) => e.label)).toEqual(["Projects", "Schedule"]);
  });
});

// A page rendered before the background drift poll has answered says
// "not checked yet" and, since nothing re-renders this page, keeps
// saying it — which is exactly what a Deploy press produces, because the
// restart it triggers empties the answer and the reader's next page load
// beats the first poll back. The sentence has to correct itself.
describe("the Deploy tab asks for itself again while the origin answer is missing", () => {

  test("no answer yet: the Deploy tab carries the reload marker", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    // Poll off, so the answer never arrives: the same state a page drawn
    // in the seconds after a restart is in.
    const html = await (await get(serve(root, settled(root, "aide"), 0), "aide", "deploy")).text();
    expect(html).toContain("has not been checked yet");
    expect(html).toContain("data-reload-every=");
  });

  test("no answer yet, but on Config: no refresh, because its forms would be cleared mid-edit", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const html = await (await get(serve(root, settled(root, "aide"), 0), "aide", "config")).text();
    expect(html).not.toContain("data-reload-every=");
  });

  test("once the answer is there, the Deploy tab stops refreshing", async () => {
    const root = projectsRoot({ aide: INSTALLS });
    const base = serve(root, behindBy(root, "aide", 0), 25);
    const html = await loadUntil(base, "aide", "matches origin", 2000, "deploy");
    expect(html).not.toContain("data-reload-every=");
  });

});
