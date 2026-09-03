// Spec 189: the page stopped asking. `GET /api/queue/events` is held
// open, says nothing at all while nothing is happening, and writes one
// `changed` event the moment the server's own picture of a job moves.
// The browser answers that by fetching the rows it already knows how to
// fetch — the event carries no payload, so nothing here has to be kept
// in step with what a row looks like.
//
// Every read in this file is BOUNDED. A regression that stops the
// server writing has to fail the test promptly; it must never sit on
// the suite waiting out Bun's 120-second idle timeout.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness, statusSaying } from "./helpers/queue-server.ts";
import { connect as connectStream, type Stream } from "./helpers/sse.ts";
import { flippingGit } from "./helpers/fake-git.ts";

const TOKEN = "s3cret-token";

const harness = queueHarness("aide-queue-events-");

/** Every stream this suite opened, closed before the servers are, so a
 *  reader is never left holding a socket into the next file. */
const open_: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  while (open_.length) await open_.pop()!.close();
  harness.cleanup();
});

const JOB = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

const auth = { "x-aide-token": TOKEN };
const postJson = { "content-type": "application/json", accept: "application/json", ...auth };

/** One held-open connection, read frame by frame — `connectStream`
 *  (`helpers/sse.ts`) plus this file's own default query and cleanup
 *  registration. */
async function connect(base: string, query = `?token=${TOKEN}`): Promise<Stream> {
  const s = await connectStream(base, query);
  open_.push(s);
  return s;
}

/** The specs-root watch spec 204 opens is a recursive `fs.watch`, and
 *  FSEvents hands a fresh one the changes made in the milliseconds
 *  BEFORE it opened — here, the fixture's own project files, written by
 *  `start()` a moment before the server was made. One `changed` event
 *  at start-up is what that costs, and it costs nothing: a page open at
 *  the time redraws once, and a page opened afterwards never hears it.
 *  A test that asserts SILENCE has to let it pass first, or it is
 *  asserting something about the fixture rather than about the queue. */
const settled = (): Promise<void> => Bun.sleep(600);

async function enqueue(base: string): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: postJson,
    body: JSON.stringify(JOB),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { job: { id: string } }).job.id;
}

describe("GET /api/queue/events", () => {
  test("is behind the token like every other queue route (criterion 9)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    expect((await fetch(`${base}/api/queue/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue/events?token=wrong`)).status).toBe(401);
  });

  test("is 503, not a held-open stream, when no token is configured", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/api/queue/events`);
    expect(res.status).toBe(503);
    expect((await res.text()).toLowerCase()).toContain("token");
  });

  test("the cookie the page already carries is enough — EventSource cannot send a header", async () => {
    const { base, server } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/api/queue/events`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body!.cancel();
  });

  test("answers as an event stream, not as a page", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    expect(s.contentType).toContain("text/event-stream");
  });

  // The whole point of the spec: an open page that is looking at
  // nothing in particular makes no noise and redraws not at all.
  test("says nothing at all while nothing changes (criterion 1)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    await settled();
    const s = await connect(base);
    await s.quiet(400);
  });

  test("a `changed` event follows an enqueue (criterion 2)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    await enqueue(base);
    expect(await s.next()).toContain("event: changed");
  });

  test("a `changed` event follows a cancel (criterion 2)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    const id = await enqueue(base);
    expect(await s.next()).toContain("event: changed");
    const cancelled = await fetch(`${base}/api/queue/${id}/cancel`, { method: "POST", headers: postJson });
    expect(cancelled.status).toBe(200);
    expect(await s.next()).toContain("event: changed");
  });

  // The second change source (spec 80's emitter). Cost, subagent count
  // and live state reach a row through a store the queue knows nothing
  // about — before this, the browser's own five-second poll kept them
  // fresh by accident, and a push driven by the queue alone would have
  // let them sit still for the whole of a long step.
  test("a `changed` event follows POST /api/aide-run (criterion 3)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const s = await connect(base);
    const reported = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "implement", spec: "81" }),
    });
    expect(reported.status).toBe(200);
    expect(await s.next()).toContain("event: changed");
  });

  test("every open page is told, not just the first", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const a = await connect(base);
    const b = await connect(base);
    await enqueue(base);
    expect(await a.next()).toContain("event: changed");
    expect(await b.next()).toContain("event: changed");
  });

  // A subscriber that is never removed is a leak that grows for as long
  // as the server is up, and a broadcast that throws on the first dead
  // one would stop the live ones being told at all.
  test("a page that goes away does not take the others with it", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const gone = await connect(base);
    const still = await connect(base);
    await gone.close();
    // Give the cancel a moment to reach the server's own stream.
    await Bun.sleep(50);
    await enqueue(base);
    expect(await still.next()).toContain("event: changed");
    // And again, so a registry left in a broken state after the first
    // broadcast is caught rather than passed over.
    await fetch(`${base}/api/queue/${await enqueueOther(base)}/cancel`, { method: "POST", headers: postJson });
    expect(await still.next()).toContain("event: changed");
  });
});

/** A second job, in a spec folder of its own — the first one's analyze
 *  is still unfinished, and the queue refuses the same step twice. */
async function enqueueOther(base: string): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: postJson,
    body: JSON.stringify({ ...JOB, steps: ["implement"] }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { job: { id: string } }).job.id;
}

// --- spec 204: a spec is a folder, and a folder changes no job --------------
//
// Four specs added to a project on 2026-08-23 stayed invisible until
// somebody reloaded the page by hand. The queue's own writes are told
// to every open page; a `git pull`, a hand-run `/aide-create` or a
// headless run's own commit writes a folder and touches no job at all,
// so nothing was told. Each allowed project's specs root is watched for
// exactly that.
describe("a spec created outside the dashboard reaches an open page (spec 204)", () => {
  const madeByHand = (dir: string, folder: string): void => {
    const at = join(dir, "root", "aide", "specs", folder);
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, "1-description.md"), `# ${folder} - Description\n`);
    writeFileSync(join(at, "4-status.md"), statusSaying(["create"]));
  };

  test("a folder written straight to disk broadcasts `changed` (criterion 4)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    // Let the start-up echo pass first, so the event read below is the
    // one this test caused and not the fixture's own.
    await settled();
    const s = await connect(base);
    madeByHand(dir, "205-made-by-hand");
    expect(await s.next()).toContain("event: changed");
  });

  // The event alone is not the promise. The page answers it by asking
  // for the rows, and the scan behind those rows is cached for five
  // seconds — so a page that had just drawn itself would be told to
  // redraw and be handed the same list it already had, with nothing to
  // say when the next event would come. The watch drops that cache
  // before it speaks.
  test("the rows the page then asks for hold the new spec (criterion 4)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    await settled();
    const s = await connect(base);
    // Draw the page once, so the five-second scan is warm and stale.
    const first = await fetch(`${base}/?rows=1&token=${TOKEN}`);
    expect(first.status).toBe(200);
    expect(await first.text()).not.toContain("206-made-by-hand");

    madeByHand(dir, "206-made-by-hand");
    expect(await s.next()).toContain("event: changed");

    const again = await fetch(`${base}/?rows=1&token=${TOKEN}`);
    expect(await again.text()).toContain("206-made-by-hand");
  });

  // A watcher nobody closes is a handle held for the life of the
  // process — and `cleanup()` removes the very directories these point
  // at, in the same breath.
  test("stop() closes every watcher it opened (criterion 6)", () => {
    const { server } = harness.start({ extra: { queueToken: TOKEN } });
    expect(server.specWatchCount()).toBe(1);
    server.stop();
    expect(server.specWatchCount()).toBe(0);
  });
});

/** Bounded, like every other read in this file: a regression that never
 *  produces the awaited call has to fail promptly, not hang the suite. */
async function until(check: () => boolean, budgetMs = 2000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return check();
}

// Spec 275, criterion 2: `refreshSpecCaches` is the only OTHER writer of
// the "is this archived spec's branch still on origin" cache besides a
// landing's own fresh recheck (`land-branch/merge.ts`), and until now it
// found things out without telling the open tab reading it — a page
// stayed as it was until an unrelated queue event or a reload happened
// to ask again. This test connects an SSE stream the same way a browser
// tab does and confirms the schedule's own finding reaches it, and that
// the row a subsequent render draws reflects that finding.
//
// It exercises the DISCOVERY direction — an unwarmed archived spec's
// first-ever check finds its branch still on origin — rather than a
// stale-to-fresh FLIP: `BranchStatusChecker`'s `openSpecBranches` cache
// carries a fixed 30-second TTL that no `ServerOptions` field reaches
// (`setup-project-resolution.ts` builds it with none), so two ticks
// fired through the real schedule, milliseconds apart in test time,
// would have the second one answer straight out of cache without ever
// asking git again — there is no way to force a second REAL check within
// a fast test through the public surface this route exposes. The literal
// stale-to-fresh flip this bug is about — and the "exactly once, not per
// root" and "silent when unchanged" guarantees — are covered exactly and
// deterministically in `cache-warmer.test.ts`, which calls
// `refreshSpecCaches` directly against a hand-built `ScheduleContext`
// with a zero-TTL checker built for the purpose. What THIS test proves
// that the other one cannot: the notify this fix adds genuinely reaches
// a live SSE connection and the row an open tab redraws with is the
// corrected one — the wiring the other suite cannot see because it never
// opens a socket.
describe("a background discovery of an archived spec's branch reaches an open tab (spec 275, criterion 2)", () => {
  test("the schedule's first check pushes its finding to a connected tab", async () => {
    // A single, one-shot gate (never re-armed): everything that awaits
    // it — the initial concurrent batch AND any call chained off one of
    // THOSE calls once it resolves — unblocks the moment it is released
    // and stays unblocked, which is what lets one tick's full chain
    // (including `DescriptionFreshnessChecker`'s own follow-up query for
    // the live spec) run to completion after a single release.
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const git = flippingGit([true], { hold: () => gate, branch: "aide/77-old-thing" });
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 30_000 },
      archivedSpecs: { "77-old-thing": {} },
    });
    const lsRemotes = () => git.calls.filter((c) => c.args[0] === "ls-remote");
    // The schedule's one and only tick (the interval is longer than this
    // test), held before it can answer.
    await until(() => lsRemotes().length >= 1);

    // Before the tick resolves: nothing has been asked yet, from this
    // row's own point of view — an unwarmed archived spec reads as
    // ordinary "archived", not as a problem (spec 208's own contract:
    // fail closed, never claim a mark it cannot back up).
    const before = await fetch(`${base}/?rows=1&token=${TOKEN}&state=archived`);
    expect(await before.text()).not.toContain("its branch is still on origin — re-run archive");

    const s = await connect(base);
    release();
    expect(await s.next()).toContain("event: changed");

    const after = await fetch(`${base}/?rows=1&token=${TOKEN}&state=archived`);
    const html = await after.text();
    expect(html).toContain('data-folder="77-old-thing"');
    expect(html).toContain("its branch is still on origin — re-run archive");
  });
});
