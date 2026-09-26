// A create that ends without a spec: one record and one push, from the
// same moment, with the same words (spec 506). Real queue store, real
// push observer, a fake `fetch`.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createPush } from "../../src/push";
import { deviceKeys, fakeFetch, makeStore, openCall, result, tempDir } from "./fixtures.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function board(lang = "en") {
  const tmp = tempDir();
  cleanups.push(tmp.done);
  const sent = fakeFetch();
  let push!: ReturnType<typeof createPush>;
  const store = makeStore(() => push.observe());
  push = createPush({
    jobs: () => store.list(),
    fetch: sent.fetch,
    subscriptionsPath: join(tmp.dir, "subs.json"),
    keyPath: join(tmp.dir, "key.json"),
    failedCreatesPath: join(tmp.dir, "failed-creates.json"),
    log: () => {},
  });
  const keys = await deviceKeys();
  await push.subscribe(
    { endpoint: "https://fcm.googleapis.com/fcm/send/device-1", keys: { p256dh: keys.p256dh, auth: keys.auth }, lang },
    "https://board.test",
  );
  const create = (title = "Layout of the new dashboard", steps?: string[]) => {
    const made = store.enqueueCreate({ project: "aide", title, description: "the typed text", ...(steps ? { steps } : {}) });
    if (!made.ok) throw new Error(made.error);
    store.transition(made.job.id, "start", { startedAt: new Date().toISOString() });
    return made.job;
  };
  return { push, store, sent, keys, create };
}

describe("a create that ends without a spec (AC-6)", () => {
  test("a failed step: one record, one push, and the url is the Try again link", async () => {
    const b = await board();
    const job = b.create();
    b.store.transition(job.id, "step-failed", {
      results: [result("create", "error", false)],
      error: "the session could not start",
    });
    await b.push.idle();
    expect(b.push.failedCreates.list().map((r) => r.id)).toEqual([job.id]);
    expect(b.push.failedCreates.get(job.id)).toMatchObject({
      project: "aide", title: "Layout of the new dashboard", description: "the typed text",
      reason: "the session could not start",
    });
    expect(b.sent.calls).toHaveLength(1);
    const p = await openCall(b.sent.calls[0]!, b.keys);
    expect(p.title).toBe("aide · Layout of the new dashboard");
    expect(p.body).toBe("Creating the spec failed: the session could not start — tap to try again with what you typed.");
    expect(p.url).toBe(`/new?retry=${job.id}`);
  });

  test("the body is in the device's own language", async () => {
    const b = await board("nb");
    const job = b.create();
    b.store.transition(job.id, "process-gone", {
      error: { key: "runner.serverRestarted", values: { button: "Create" } },
    });
    await b.push.idle();
    const p = await openCall(b.sent.calls[0]!, b.keys);
    expect(p.body).toStartWith("Opprettingen av specen feilet: serveren startet på nytt");
  });

  test("a timeout or provider limit (stopped) counts too", async () => {
    const b = await board();
    const job = b.create();
    b.store.transition(job.id, "run-stopped", { stopReason: "timeout" });
    await b.push.idle();
    expect(b.push.failedCreates.list().map((r) => r.id)).toEqual([job.id]);
    expect(b.sent.calls).toHaveLength(1);
  });

  test("a failed step counts once, and a later update sends nothing more", async () => {
    const b = await board();
    const job = b.create();
    b.store.transition(job.id, "step-failed", { results: [result("create", "error", false)] });
    b.store.update(job.id, { spentUsd: 1 });
    b.store.update(job.id, { spentUsd: 2 });
    await b.push.idle();
    expect(b.sent.calls).toHaveLength(1);
    expect(b.push.failedCreates.get(job.id)?.reason).toEqual({ key: "runner.createEndedNoReason" });
  });

  test("a create whose own merge failed while the job went on gets one, with the merge's reason", async () => {
    const b = await board();
    const job = b.create();
    b.store.update(job.id, { state: "queued", landingError: "cannot fast-forward main", error: "held back" });
    await b.push.idle();
    expect(b.push.failedCreates.get(job.id)?.reason).toBe("cannot fast-forward main");
    expect(b.sent.calls).toHaveLength(1);
  });

  test("a stopped create whose merge then gives it a real folder sends nothing (AC-7)", async () => {
    const b = await board();
    const job = b.create();
    b.store.update(job.id, { landing: true });
    b.store.transition(job.id, "step-failed", { results: [result("create", "error", false)] });
    b.store.update(job.id, { specFolder: "90-layout-of-the-new-dashboard", landing: false });
    await b.push.idle();
    expect(b.push.failedCreates.list()).toEqual([]);
    expect(b.sent.calls).toHaveLength(0);
  });

  test("a create that merges, or is cancelled, sends nothing (AC-7)", async () => {
    const b = await board();
    const merged = b.create("Merged");
    b.store.update(merged.id, { specFolder: "91-merged" });
    b.store.transition(merged.id, "step-succeeded-last", { results: [result("create")] });
    const cancelled = b.create("Cancelled");
    b.store.transition(cancelled.id, "cancel");
    await b.push.idle();
    expect(b.push.failedCreates.list()).toEqual([]);
    expect(b.sent.calls).toHaveLength(0);
  });

  test("two failures give two records and two pushes", async () => {
    const b = await board();
    for (const t of ["One", "Two"]) {
      const job = b.create(t);
      b.store.transition(job.id, "step-failed", { results: [result("create", "error", false)] });
    }
    await b.push.idle();
    expect(b.push.failedCreates.list()).toHaveLength(2);
    expect(b.sent.calls).toHaveLength(2);
  });

  test("a long reason is cut in the push at 500 characters and whole in the record", async () => {
    const b = await board();
    const job = b.create();
    const long = "x".repeat(2000);
    b.store.transition(job.id, "step-failed", { results: [result("create", "error", false)], error: long });
    await b.push.idle();
    const p = await openCall(b.sent.calls[0]!, b.keys);
    expect(p.body.length).toBeLessThanOrEqual(500);
    expect(p.body.endsWith("…")).toBe(true);
    expect(b.push.failedCreates.get(job.id)?.reason).toBe(long);
  });
});

describe("what was already there at boot (AC-1)", () => {
  test("a failure the store already holds is quiet once primed; a reconcile after it is not", async () => {
    const b = await board();
    const old = b.create("Old");
    b.store.transition(old.id, "step-failed", { results: [result("create", "error", false)] });
    await b.push.idle();
    b.sent.calls.length = 0;
    for (const r of b.push.failedCreates.list()) b.push.failedCreates.dismiss(r.id);

    b.push.prime();
    b.push.observe();
    await b.push.idle();
    expect(b.push.failedCreates.list()).toEqual([]);
    expect(b.sent.calls).toHaveLength(0);

    const running = b.create("Running at restart");
    b.push.prime();
    b.store.transition(running.id, "process-gone", { error: { key: "runner.serverRestarted", values: { button: "Create" } } });
    await b.push.idle();
    expect(b.push.failedCreates.list().map((r) => r.title)).toEqual(["Running at restart"]);
    expect(b.sent.calls).toHaveLength(1);
  });
});
