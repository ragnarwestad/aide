// What a Run press may start. A phase that has run may be run again —
// that is the reader's choice — and the route refuses only a start out
// of order, at the press and with the table's own sentence, before
// anything reaches the queue: implement before analyze, archive before
// implement, and create on a spec that exists. `job-actions.ts` is the
// one HTTP-reachable path both the spec page and the specs-list row
// post through.

import { afterEach, describe, expect, test } from "bun:test";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import { listUntil, rowSaysDone } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

const AUTH = { "content-type": "application/json", accept: "application/json" };

const queue = (base: string, steps: string[]) =>
  fetch(`${base}/api/queue`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps }),
  });

const queued = async (base: string): Promise<number> =>
  ((await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as { jobs: unknown[] }).jobs.length;

describe("a phase that has run may be run again", () => {
  test("analyze on an implemented spec is accepted", async () => {
    const { base } = harness.start({ extra: {}, status: statusSaying(["create", "analyze", "implement"]) });
    expect((await queue(base, ["analyze"])).status).toBe(200);
    expect(await queued(base)).toBe(1);
  });

  test("analyze again on an analyzed spec is accepted", async () => {
    const { base } = harness.start({ extra: {}, status: statusSaying(["create", "analyze"]) });
    expect((await queue(base, ["analyze"])).status).toBe(200);
  });

  test("implement again on an implemented spec is accepted", async () => {
    const { base } = harness.start({ extra: {}, status: statusSaying(["create", "analyze", "implement"]) });
    expect((await queue(base, ["implement"])).status).toBe(200);
  });

  test("analyze, implement and archive together on an implemented spec are accepted (AC-2)", async () => {
    const { base } = harness.start({ extra: {}, status: statusSaying(["create", "analyze", "implement"]) });
    expect((await queue(base, ["analyze", "implement", "archive"])).status).toBe(200);
  });

  test("analyze and implement together on a created spec are accepted", async () => {
    const { base } = harness.start({ extra: {}, status: statusSaying(["create"]) });
    expect((await queue(base, ["analyze", "implement"])).status).toBe(200);
  });
});

describe("a start out of order is refused at the press, with the reason", () => {
  const refused = async (done: string[], steps: string[], says: string) => {
    const { base } = harness.start({ extra: {}, status: statusSaying(done) });
    const res = await queue(base, steps);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(says);
    expect(await queued(base)).toBe(0);
  };

  test("implement before analyze", () => refused(["create"], ["implement"], "has not been analyzed yet"));

  test("archive before implement", () => refused(["create", "analyze"], ["archive"], "has not reached implement yet"));

  test("create on a spec that exists", () => refused(["create", "analyze"], ["create"], "create cannot run again"));

  // A new analysis takes the spec back to analyzed, so an archive queued
  // behind it in the same press starts out of order.
  test("archive in the same press as a new analysis (AC-2)", () =>
    refused(["create", "analyze", "implement"], ["analyze", "archive"], "has not reached implement yet"));
});

// Implement lands nothing: its record is on the spec's branch until
// archive merges it, and main still says "analyzed". The route reads what
// the row reads — the branch and the history as well as main — or every
// archive is refused as "not reached implement yet".
describe("a phase proved on the spec's branch counts, though main has not got it", () => {
  test("archive after an implement main does not show yet is accepted", async () => {
    const { base, dir } = harness.start({ extra: {}, status: statusSaying(["create", "analyze"]) });
    ran(dir, ["create", "analyze", "implement"]);
    await listUntil(base, rowSaysDone("implement"));
    expect((await queue(base, ["archive"])).status).toBe(200);
  });
});

// Implement starts from main. An analyze that ran but never merged there —
// its landing failed — is not "not analyzed", and saying so sent people to
// a run that had happened. The refusal names what did not happen.
describe("implement on an analysis that never merged into main", () => {
  test("is refused at the press, saying the merge is what is missing", async () => {
    const { base, dir } = harness.start({ extra: {}, status: statusSaying(["create"]) });
    ran(dir, ["create", "analyze"]);
    await listUntil(base, rowSaysDone("analyze"));
    const res = await queue(base, ["implement"]);
    expect(res.status).toBe(400);
    const error = ((await res.json()) as { error: string }).error;
    expect(error).toContain("not been merged into main");
    expect(error).not.toContain("not been analyzed");
    expect(await queued(base)).toBe(0);
  });

  test("with analyze in the same press, the job's own analysis merges first and it is accepted", async () => {
    const { base, dir } = harness.start({ extra: {}, status: statusSaying(["create"]) });
    ran(dir, ["create", "analyze"]);
    await listUntil(base, rowSaysDone("analyze"));
    expect((await queue(base, ["analyze", "implement"])).status).toBe(200);
  });
});
