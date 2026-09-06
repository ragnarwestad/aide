import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
} from "../../../src/serve/serve.ts";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import { ensureDashboardCheckout } from "../../../src/git/dashboard-checkout.ts";
import { statusSaying } from "../../helpers/queue-server.ts";
import {
  TOKEN,
  setupQueueRoutesHarness,
} from "../fixtures.ts";
import { checkoutSafetyHelpers } from "./checkout-safety-fixtures.ts";

const { harness } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];
const { git, realProject, recording } = checkoutSafetyHelpers(ownDirs);

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// Spec 205: the dashboard works in checkouts of its own.
//
// Split out of checkout-and-render-safety.test.ts by theme: this file
// carries the checkout-listing tests (spec 218). The write-direction
// tests and the checkout-freshness (spec 216) test are their own sibling
// files, sharing `git`, `realProject` and `recording` via
// ./checkout-safety-fixtures.ts.
describe("the dashboard works in checkouts of its own (spec 205)", () => {
  // Spec 218: what the list SHOWS and what a run can actually resolve
  // were two different directories.
  //
  // `aide-run-spec` resolves `--spec` against the clone the dashboard
  // owns; the walk that enumerated spec folders read the checkout a
  // person edits. A folder committed there and never pushed therefore
  // got a row, with every step on it offered — and every one of them
  // refused with `unknown spec: <folder> (not under
  // <dashboard-checkout>/specs/<project>)`.
  //
  // Real git again, and for the same reason as the rest of this block:
  // what is under test is which working tree the FOLDERS were read
  // from, and a fake that ignores its directory cannot tell two
  // checkouts apart.

  /** A page's HTML, through the token like a reader's browser. */
  const page = async (base: string, path: string): Promise<string> =>
    await (await fetch(`${base}${path}`, { headers: { "x-aide-token": TOKEN } })).text();

  /** Fetch a page until it says what is expected, and hand back the
   *  last thing it said either way.
   *
   *  Polling rather than one request, because the answer moves twice on
   *  purpose: the dashboard's own checkout is resolved by a background
   *  ensure (spec 205), and a page rendered before it settles falls
   *  back to the person's own list — which is criterion 3, not a
   *  failure. What is asserted is where it ARRIVES. */
  async function untilPage(
    base: string,
    path: string,
    says: (html: string) => boolean,
    budgetMs = 15000,
  ): Promise<string> {
    const deadline = Date.now() + budgetMs;
    let last = "";
    while (Date.now() < deadline) {
      last = await page(base, path);
      if (says(last)) return last;
      await new Promise((r) => setTimeout(r, 50));
    }
    return last;
  }

  /** Wait until the recorded git calls stop arriving, so a count taken
   *  afterwards is the REQUEST's own and not a tick's tail. */
  async function quiet(calls: unknown[], stillMs = 300, budgetMs = 20000): Promise<void> {
    const deadline = Date.now() + budgetMs;
    let seen = -1;
    let since = Date.now();
    while (Date.now() < deadline) {
      if (calls.length !== seen) {
        seen = calls.length;
        since = Date.now();
      } else if (Date.now() - since >= stillMs) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** A spec folder pushed to origin from a clone of its own, so the
   *  person's checkout never has it: a spec somebody else pushed, which
   *  is the only way to tell "listed from origin" apart from "listed
   *  from the person's disk". */
  function pushSpecToOrigin(projectsRoot: string, folder: string): void {
    const scratch = mkdtempSync(join(tmpdir(), "aide-218-push-"));
    ownDirs.push(scratch);
    const clone = join(scratch, "aide");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", join(projectsRoot, "..", "aide.git"), clone] });
    git(clone, "config", "user.name", "Somebody Else");
    git(clone, "config", "user.email", "else@example.com");
    mkdirSync(join(clone, "specs", folder), { recursive: true });
    writeFileSync(join(clone, "specs", folder, "1-description.md"), `# ${folder} - Description\n\nPushed.\n`);
    writeFileSync(join(clone, "specs", folder, "4-status.md"), statusSaying(["create"]));
    git(clone, "add", "-A");
    git(clone, "commit", "-qm", `add ${folder}`);
    git(clone, "push", "-q", "origin", "main");
  }

  /** Committed where a person works and pushed nowhere — the spec the
   *  list used to offer and every step used to refuse. */
  function commitSpecUnpushed(person: string, folder: string): void {
    mkdirSync(join(person, "specs", folder), { recursive: true });
    writeFileSync(join(person, "specs", folder, "1-description.md"), `# ${folder} - Description\n\nMine only.\n`);
    writeFileSync(join(person, "specs", folder, "4-status.md"), statusSaying(["create"]));
    git(person, "add", "-A");
    git(person, "commit", "-qm", `add ${folder}`);
  }

  // Criteria 1, 2 and 6: the unpushed folder is hidden and the pushed
  // one is listed, on the page a reader actually reads a spec list from.
  test("a spec only the person has is not listed, and one the dashboard has is (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);
    commitSpecUnpushed(person, "990-only-in-my-checkout");

    const server = createServer({
      siteDir: site, port: 0,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const html = await untilPage(base, "/", (h) => !h.includes("990-only-in-my-checkout"));
      expect(html).not.toContain("990-only-in-my-checkout");
      expect(html).toContain("81-queue-and-runner");
    } finally {
      server.stop();
    }
  }, 30000);

  // The same walk feeds the overview's counts, so they move with it: a
  // project's row said two specs while only one of them could be run.
  test("the projects overview counts what the dashboard has, not what the person has (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);
    commitSpecUnpushed(person, "991-only-in-my-checkout");

    const server = createServer({
      siteDir: site, port: 0,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const html = await untilPage(base, "/projects", (h) => h.includes("1 active · 0 archived"));
      expect(html).toContain("1 active · 0 archived");
      expect(html).not.toContain("991-only-in-my-checkout");
    } finally {
      server.stop();
    }
  }, 30000);

  // Criterion 3: a project whose own checkout CANNOT be made keeps
  // working exactly as it did before spec 205 — the same fallback
  // `machinerySpecDir` and `peekMachinerySpecDir` already take.
  test("a project with no checkout of its own is listed from the person's, as before (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    commitSpecUnpushed(person, "992-only-in-my-checkout");
    // The one question the clone rests on, refused: there is nothing to
    // clone from, so no checkout of the dashboard's own is ever
    // resolved. Nothing else is touched.
    const real = createGitRunner();
    const noOrigin: GitRunner = async (dir, args, timeoutMs) =>
      args.join(" ") === "remote get-url origin" ? { code: 1, stdout: "" } : await real(dir, args, timeoutMs);

    const server = createServer({
      siteDir: site, port: 0,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0, gitRun: noOrigin,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      expect(existsSync(join(owned, "aide", "code", ".git"))).toBe(false);
      const html = await page(base, "/");
      expect(html).toContain("81-queue-and-runner");
      // Not hidden, and not an empty list either: the person's own
      // checkout is all there is to read here.
      expect(html).toContain("992-only-in-my-checkout");
    } finally {
      server.stop();
    }
  }, 30000);

  // Criterion 4: a project with NOTHING queued. `tickRunner`'s own
  // per-project refresh (spec 216) never fires for one, so before this
  // spec its checkout was fetched once at boot and never again — a spec
  // pushed from another machine would have sat unlisted for as long as
  // the server ran.
  test("a spec pushed with no job queued is listed within one poll (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);

    const server = createServer({
      siteDir: site, port: 0,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0, specCachePollMs: 250,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      // The boot-time ensure has settled and the page is answering.
      expect(await untilPage(base, "/", (h) => h.includes("81-queue-and-runner"))).toContain(
        "81-queue-and-runner",
      );
      // Somebody else pushes. The person's own checkout never hears
      // about it, so the person's list cannot be where this comes from.
      pushSpecToOrigin(projectsRoot, "993-pushed-by-somebody-else");
      expect(existsSync(join(person, "specs", "993-pushed-by-somebody-else"))).toBe(false);

      const html = await untilPage(base, "/", (h) => h.includes("993-pushed-by-somebody-else"), 25000);
      expect(html).toContain("993-pushed-by-somebody-else");
    } finally {
      server.stop();
    }
  }, 45000);

  // Criterion 5, and spec 208's rule kept: the fetch that made the row
  // appear happened on the schedule. The request that shows it spawns
  // no git of its own.
  test("the request that lists the dashboard's own specs spawns no git (spec 218)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);
    pushSpecToOrigin(projectsRoot, "994-pushed-by-somebody-else");
    const recorded = recording();

    // One tick and then nothing for a hundred seconds, exactly as spec
    // 208's own suite does it: the schedule cannot fire again while the
    // request is in flight, so the count taken across it is the
    // request's.
    const server = createServer({
      siteDir: site, port: 0,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, driftPollMs: 0, specCachePollMs: 100_000, gitRun: recorded.run,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      expect(await untilPage(base, "/", (h) => h.includes("994-pushed-by-somebody-else"))).toContain(
        "994-pushed-by-somebody-else",
      );
      await quiet(recorded.calls);
      const before = recorded.calls.length;
      const html = await page(base, "/");
      expect(html).toContain("994-pushed-by-somebody-else");
      expect(recorded.calls.length).toBe(before);
    } finally {
      server.stop();
    }
  }, 45000);
});
