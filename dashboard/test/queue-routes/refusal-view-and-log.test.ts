import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TOKEN,
  JOB,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

// "All" + "Spec, descending" survived the five-second refresh but not an
// action: every POST answered 303 to the bare list address, so pressing any
// button dropped the reader back into the default view.
describe("an action keeps the page's view (criterion 7)", () => {
  const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
  const VIEW = { "view.state": "active", "view.sort": "cost", "view.dir": "desc" };

  const post = (base: string, path: string, fields: Record<string, string>) =>
    fetch(`${base}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams(fields),
    });

  /** One job in the mirror, in the state the test needs it. */
  async function seededJob(state: string): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
        body: JSON.stringify(JOB),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    jobs.find((j) => j.id === made.job.id)!.state = state;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  test("Run carries the view forward on success", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await post(base, "/api/queue", {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "analyze",
      ...VIEW,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?state=active&sort=cost&dir=desc");
  });

  test("Run carries the view forward on a refusal too", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await post(base, "/api/queue", { project: "nope", specFolder: "x", steps: "analyze", ...VIEW });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/?state=active&sort=cost&dir=desc&error=")).toBe(true);
  });

  test("Cancel carries the view forward", async () => {
    const { mirror, id } = await seededJob("running");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const res = await post(base, `/api/queue/${id}/cancel`, VIEW);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?state=active&sort=cost&dir=desc");
  });

  // The exact assertion spec 81 wrote: with nothing to carry, the
  // redirect is `/` and not `/?`.
  test("with no view submitted the redirect stays exactly /", async () => {
    const { mirror, id } = await seededJob("running");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const res = await post(base, `/api/queue/${id}/cancel`, {});
    expect(res.headers.get("location")).toBe("/");
  });
});

// A refusal landed on the page that followed the redirect, at the top,
// belonging to no row — and serve.log had no line for any refusal at
// all on the day this was written.
describe("a refusal names its spec and reaches the log (criteria 8, 9, 11)", () => {
  const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
  const SPEC = "aide/81-queue-and-runner";

  /** `console.error` for the duration of one test. serve.log is both
   *  streams of the same launchd job, so the call IS the log line. */
  async function capturingLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      return { result: await fn(), lines };
    } finally {
      console.error = original;
    }
  }

  // Spec 106's own chain — git says "conflict", and the row ends up
  // showing it — used to run through this redirect, and was
  // tested here. Since spec 149 the reason is stored on the JOB instead,
  // because a landing has no browser to redirect; the chain is covered
  // end to end in "every step lands its own work" above.

  test("an enqueue refusal names the spec it was for (criterion 9)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const { result: res, lines } = await capturingLog(() =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: FORM,
        body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "nonsense" }),
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(`errorSpec=${encodeURIComponent(SPEC)}`);
    expect(lines.join("\n")).toContain(SPEC);
  });

  // Spec 101: the page stopped navigating on a refusal, so the row it
  // belongs to is now picked out from the JSON body rather than from a
  // redirect the server built. Merge already said which spec; Run and
  // approve said only why, which left three of the four actions with no
  // row to land on.
  test("a refused Run says which spec it was for, to a JSON caller too", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ ...JOB, steps: ["nonsense"] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ spec: SPEC });
  });

  // Criterion 9: the script above these forms is an enhancement, never
  // the mechanism. A browser with JavaScript off posts the form itself
  // and must still get the 303 back to the list.
  test("a form post with no JSON accept header still gets its 303", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const run = await fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
    });
    expect(run.status).toBe(303);
    const id = (JSON.parse(readFileSync(join(dir, "queue.json"), "utf-8")) as { id: string }[])[0]!.id;
    const cancelled = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ "view.state": "active" }),
    });
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.get("location")).toContain("state=active");
    const created = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ project: "aide", title: "", description: "" }),
    });
    expect(created.status).toBe(303);
  });
});
