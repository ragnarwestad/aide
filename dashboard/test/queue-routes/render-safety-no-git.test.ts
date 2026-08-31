import { afterEach, describe, expect, test } from "bun:test";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { ran, statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

// Spec 208: a render reads memory and disk, and nothing else.
//
// This has been introduced three times — spec 178 wrote the rule and
// was never merged, spec 203 fixed `/projects`, and spec 193 put a
// network `ls-remote` back on `/` the next day. So it is asserted here
// rather than left to care: the request path spawns NO git, warm or
// cold, and a cold page says what it does not know instead of holding
// the reader.
//
// Split out of checkout-and-render-safety.test.ts by theme: this
// describe was already self-contained, so it moves whole into its own
// file.
describe("no render path runs git or a network command (spec 208)", () => {
  /** Everything the render could conceivably ask git, recorded. The
   *  checkout the dashboard makes for itself is a background job of its
   *  own (spec 205) and is started at boot, not by a request — so the
   *  count is taken across a request rather than over the process. */
  function recording() {
    const calls: { dir: string; args: string[] }[] = [];
    const run: GitRunner = async (dir, args) => {
      calls.push({ dir, args });
      const line = args.join(" ");
      if (args[0] === "ls-remote") return { code: 0, stdout: "" };
      if (line.startsWith("log --format=%aI")) return { code: 0, stdout: "2026-08-17T09:00:00+02:00\n" };
      if (line.startsWith("log -1 --format=%H")) {
        return { code: 0, stdout: "deadbee\t2026-08-18T09:10:36+02:00\n" };
      }
      if (line.startsWith("log --all")) return { code: 0, stdout: "" };
      return { code: 1, stdout: "" };
    };
    return { run, calls };
  }

  const get = async (base: string, path: string): Promise<Response> =>
    await fetch(`${base}${path}`, { headers: { "x-aide-token": TOKEN } });

  async function until(check: () => boolean, budgetMs = 2000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return check();
  }

  // Criterion 5: the schedule is off, so nothing has ever been warmed —
  // and the pages still answer, with no git spawned by the request.
  test("cold, GET / and GET /?rows=1 spawn nothing and say what they do not know", async () => {
    const git = recording();
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
      archivedSpecs: { "77-old-thing": {} },
    });
    const before = git.calls.length;
    const html = await (await get(base, "/")).text();
    expect(git.calls.length).toBe(before);
    // Not a false "nothing has run": the row says the answer is not in
    // yet. This is the shape spec 178's own plan review flagged.
    expect(html).toContain("checking…");
    const rows = await (await get(base, "/?rows=1")).text();
    expect(git.calls.length).toBe(before);
    expect(rows).toContain("checking…");
  });

  // Criterion 6.
  test("warm, GET / spawns nothing of its own and shows the warmed answers", async () => {
    const git = recording();
    // One tick and then nothing for a hundred seconds: the schedule
    // cannot fire again while the request is in flight, so the count
    // taken across it is the REQUEST's own and nobody else's.
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 100_000 },
    });
    await until(() => git.calls.some((c) => c.args.join(" ").startsWith("log --format=%aI")));
    await new Promise((r) => setTimeout(r, 100));
    const before = git.calls.length;
    const html = await (await get(base, "/")).text();
    expect(git.calls.length).toBe(before);
    expect(html).not.toContain("checking…");
  });

  // Criterion 8. It asked `/archive` until spec 221 retired that page;
  // the rows are on the Specs list now, behind the chip that shows
  // them, and the rule they have to keep is the same one — peek, never
  // take, on the request path.
  test("cold, an archived row renders with a checking date rather than blocking on git", async () => {
    const git = recording();
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
      // No `Archived:` stamp on disk, so the date is git's to answer —
      // which is exactly the row that used to reach `lastCommitOf`.
      archivedSpecs: { "77-old-thing": { status: "# Status\n" } },
    });
    const before = git.calls.length;
    const res = await get(base, "/?state=archived");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(git.calls.length).toBe(before);
    expect(html).toContain("checking…");
  });

  // Criterion 9: the dashboard's own clone (spec 205) is started at
  // boot and takes seconds. A spec page opened before it lands falls
  // back to the person's own checkout instead of waiting for it.
  test("a spec page does not wait for the dashboard's own clone", async () => {
    let releaseClone = (): void => {};
    const held = new Promise<void>((r) => (releaseClone = r));
    const git = recording();
    const slowClone: GitRunner = async (dir, args) => {
      if (args[0] === "clone") await held;
      return git.run(dir, args);
    };
    const { base } = harness.start({
      extra: { gitRun: slowClone, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
    });
    const started = Date.now();
    const res = await get(base, "/specs/aide/81-queue-and-runner");
    const took = Date.now() - started;
    releaseClone();
    expect(res.status).toBe(200);
    // Well under a real clone, which measured 4.3 s for this very repo.
    expect(took).toBeLessThan(1500);
    expect(await res.text()).toContain("81-queue-and-runner");
  });

  // Criterion 10: the one cache a sweep over the live list cannot fill —
  // an archived spec's page is a real render path too. It fills itself
  // from the request, without the request ever waiting on it.
  test("a spec page's file stamps fill in behind the request, never during it", async () => {
    const git = recording();
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
    });
    const before = git.calls.length;
    // A document tab since spec 212: Overview carries no file text, so
    // the stamps this is about are on the tabs that do.
    const first = await (await get(base, "/specs/aide/81-queue-and-runner?tab=analysis")).text();
    // The stamps are not known yet, and the page says so rather than
    // holding for four `git log`s.
    expect(first).toContain("checking…");
    expect(first).not.toContain("deadbee");
    // The fire-and-forget fill did run — it was simply never awaited.
    expect(await until(() => git.calls.length > before)).toBe(true);
    let second = "";
    for (let i = 0; i < 40 && !second.includes("deadbee"); i += 1) {
      second = await (await get(base, "/specs/aide/81-queue-and-runner?tab=analysis")).text();
      if (!second.includes("deadbee")) await new Promise((r) => setTimeout(r, 25));
    }
    expect(second).toContain("deadbee");
  });

  const pipKind = (html: string, step: string): string =>
    html.match(new RegExp(`<span class="pip ([a-z]+)"[^>]* title="${step}">`))?.[1] ?? "";

  // Spec 241, criterion 5: `targets()` deliberately excludes an archived
  // spec (spec 150), so `specPageView()`'s old `done: target?.done ?? []`
  // always collapsed to `[]` for one — every phase but `create` (which is
  // coloured from `phases` alone) read `todo` regardless of what the
  // spec's own `4-status.md` claims. The fix trusts that file's claim for
  // an archived spec, the same source `archivedSteps()` already trusts
  // for the front page's archived rows (spec 224).
  test("an archived spec's Overview tab shows all four phases as past, not just create (criterion 5)", async () => {
    const { base } = harness.start({
      extra: { queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
      archivedSpecs: {
        "77-old-thing": { status: statusSaying(["create", "analyze", "implement", "archive"]) },
      },
    });
    // The specs LIST's own row, not the spec page: spec 294 dropped the
    // pip bar from the individual spec page entirely (its "Overview"
    // became a pure Checks tab, no progress bar) — `phasePips()` /
    // `head-row.ts` is the only render path left that still draws one,
    // same markup `pipKind` already parses.
    const html = await (await get(base, "/?state=archived")).text();
    expect(pipKind(html, "create")).toBe("past");
    expect(pipKind(html, "analyze")).toBe("past");
    expect(pipKind(html, "implement")).toBe("past");
    expect(pipKind(html, "archive")).toBe("past");
  });

  // Spec 241, criterion 6: a regression guard for the branch above — a
  // LIVE spec must keep reading `done` from `target?.done` (the
  // git-verified `workflowHistory`), never from the file's own claim.
  // Not expected to be RED on its own: the live branch of the new `done:`
  // line is byte-for-byte unchanged, but nothing before this task fetched
  // ANY spec's Overview tab through a real route and inspected its pips —
  // so a broken conditional (e.g. an inverted `ref?.archived` check) would
  // otherwise pass unnoticed.
  test("a live spec's Overview tab still reads its pips from its own git-verified history (criterion 6)", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 40 },
      status: statusSaying(["create", "analyze", "implement", "archive"]),
    });
    ran(dir, ["create", "analyze"]);
    await new Promise((r) => setTimeout(r, 100));
    // Same list-route note as criterion 5 above.
    const html = await (await get(base, "/")).text();
    expect(pipKind(html, "create")).toBe("past");
    expect(pipKind(html, "analyze")).toBe("past");
    expect(pipKind(html, "implement")).toBe("todo");
    expect(pipKind(html, "archive")).toBe("todo");
  });
});
