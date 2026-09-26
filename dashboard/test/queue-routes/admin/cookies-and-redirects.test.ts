// The cookies the list keeps, the headerAuth bind rule, and the addresses the page has had over time.
//
// Split out of auth-and-navigation.test.ts 2026-09-04 (678 lines); the
// tests are unchanged and keep their names.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  JOB,
  setupQueueRoutesHarness,
} from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// Spec 363: two boards on one host keep their own cookies, and a header a
// proxy sets is only honoured on a loopback bind.
describe("spec 363: port-scoped cookies and the headerAuth bind", () => {
  const HEADER_AUTH = { header: "X-Test-User", users: ["alice@example.com"] };

  test("two boards on one host keep their own sort and state cookies (REQ-1/REQ-8)", async () => {
    const a = start();
    const b = start();
    expect(a.server.port).not.toBe(b.server.port);

    const resA = await fetch(`${a.base}/?sort=started&state=done`, { redirect: "manual" });
    const resB = await fetch(`${b.base}/?sort=cost&state=active`, { redirect: "manual" });
    const cookiesA = resA.headers.getSetCookie();
    const cookiesB = resB.headers.getSetCookie();

    expect(cookiesA.some((c) => c.startsWith(`aide_sort_${a.server.port}=`))).toBe(true);
    expect(cookiesB.some((c) => c.startsWith(`aide_sort_${b.server.port}=`))).toBe(true);
    expect(cookiesA.some((c) => c.startsWith(`aide_state_${a.server.port}=`))).toBe(true);
    expect(cookiesB.some((c) => c.startsWith(`aide_state_${b.server.port}=`))).toBe(true);

    // A real browser keeps ONE cookie jar for `127.0.0.1`, so both
    // boards' cookies arrive on every request to either.
    const jar = [...cookiesA, ...cookiesB].map((c) => c.split(";")[0]).join("; ");
    const checkA = await fetch(`${a.base}/`, { headers: { cookie: jar } });
    const checkB = await fetch(`${b.base}/`, { headers: { cookie: jar } });
    expect(checkA.status).toBe(200);
    expect(checkB.status).toBe(200);
  });

  test("headerAuth on a loopback bind starts, and the pages answer as they do without it (AC-6)", async () => {
    const { base } = start({ bindHost: "127.0.0.1", headerAuth: HEADER_AUTH });
    expect((await fetch(`${base}/`, { headers: { "X-Test-User": "alice@example.com" } })).status).toBe(200);
    expect((await fetch(`${base}/`, { headers: { "X-Test-User": "mallory@example.com" } })).status).toBe(200);
  });

  test("headerAuth on a non-loopback bind refuses to start (REQ-5)", () => {
    expect(() => start({ headerAuth: HEADER_AUTH })).toThrow(/loopback|127\.0\.0\.1/i);
  });
});

// Spec 87: the page is about SPECS. That a queue orders the runs is an
// implementation detail, and it stopped being the name a reader reads.
// The old address keeps working: people bookmark this page.
describe("the page moved from /queue to /specs to / (criteria 7-9, 12)", () => {
  // Spec 100 criterion 3: /queue was pointed at /specs; both now point
  // at `/`, because that is where the list itself is.
  test("GET /queue redirects to / with the query string intact (criterion 7)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/queue?state=active&sort=cost`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/?state=active&sort=cost`);
  });

  // Spec 100 criterion 2: the address this page used to live at.
  test("GET /specs redirects to / with the query string intact", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs?state=active&sort=cost`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/?state=active&sort=cost`);
  });

  test("GET /specs with nothing to carry redirects to exactly /", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  // Spec 100 criterion 4: the DETAIL page did not move, so this one
  // target is deliberately unchanged. A /<id> here would break every
  // job link already sent out.
  test("GET /queue/<id> redirects to /specs/<id>, tab and all (criterion 8)", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await fetch(`${base}/queue/${made.job.id}?tab=steps`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/specs/${made.job.id}?tab=steps`);
  });

  // Spec 100 criterion 5: the other half of the same guard — the detail
  // page answers where it always has, with no redirect hop in front.
  test("GET /specs/<id> renders the job page itself, no redirect", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await fetch(`${base}/specs/${made.job.id}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("81-queue-and-runner");
  });

  test("the JSON surface is not renamed and no redirect swallows it (criterion 12)", async () => {
    const { base } = start();
    const headers = { "content-type": "application/json", accept: "application/json" };
    const made = await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    expect(made.status).toBe(200);
    const id = ((await made.json()) as { job: { id: string } }).job.id;

    const list = await fetch(`${base}/api/queue`, { redirect: "manual" });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { jobs: unknown[] }).jobs.length).toBe(1);

    const one = await fetch(`${base}/api/queue/${id}`, { redirect: "manual" });
    expect(one.status).toBe(200);
    expect(((await one.json()) as { job: { id: string } }).job.id).toBe(id);

    const cancel = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST", headers, redirect: "manual",
    });
    expect(cancel.status).toBe(200);
  });
});
