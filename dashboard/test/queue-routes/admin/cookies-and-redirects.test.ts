// The cookie a token is kept in, who is admitted with a header instead,
// and the addresses the page has had over time.
//
// Split out of auth-and-navigation.test.ts 2026-09-04 (678 lines); the
// tests are unchanged and keep their names.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  renderQueuePage,
} from "../../../src/render.ts";
import {
  TOKEN,
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

// Spec 363: two boards on one host, and a proxy that can vouch for the
// reader without a token or a cookie at all.
describe("spec 363: port-scoped cookies and header-based admission", () => {
  const HEADER_AUTH = { header: "X-Test-User", users: ["alice@example.com"] };

  test("two boards on one host keep their own token, sort and state cookies (REQ-1/REQ-8)", async () => {
    const a = start({ queueToken: TOKEN });
    const b = start({ queueToken: TOKEN });
    expect(a.server.port).not.toBe(b.server.port);

    const resA = await fetch(`${a.base}/?token=${TOKEN}&sort=started&state=done`, { redirect: "manual" });
    const resB = await fetch(`${b.base}/?token=${TOKEN}&sort=cost&state=active`, { redirect: "manual" });
    const cookiesA = resA.headers.getSetCookie();
    const cookiesB = resB.headers.getSetCookie();

    expect(cookiesA.some((c) => c.startsWith(`aide_token_${a.server.port}=`))).toBe(true);
    expect(cookiesB.some((c) => c.startsWith(`aide_token_${b.server.port}=`))).toBe(true);
    expect(cookiesA.some((c) => c.startsWith(`aide_sort_${a.server.port}=`))).toBe(true);
    expect(cookiesB.some((c) => c.startsWith(`aide_sort_${b.server.port}=`))).toBe(true);
    expect(cookiesA.some((c) => c.startsWith(`aide_state_${a.server.port}=`))).toBe(true);
    expect(cookiesB.some((c) => c.startsWith(`aide_state_${b.server.port}=`))).toBe(true);

    // A real browser keeps ONE cookie jar for `127.0.0.1`, so both
    // boards' cookies arrive on every request to either — the exact
    // mechanism of the bug this fixes. Each board must still answer
    // using only its OWN name.
    const jar = [...cookiesA, ...cookiesB].map((c) => c.split(";")[0]).join("; ");
    const checkA = await fetch(`${a.base}/`, { headers: { cookie: jar } });
    const checkB = await fetch(`${b.base}/`, { headers: { cookie: jar } });
    expect(checkA.status).toBe(200);
    expect(checkB.status).toBe(200);
  });

  test("a pre-existing, unversioned aide_token cookie is ignored, not trusted (REQ-2)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/`, { headers: { cookie: `aide_token=${TOKEN}` } });
    expect(res.status).toBe(401);
  });

  test("the token link still works and sets the new, port-scoped cookie (REQ-2)", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`aide_token_${server.port}=`);
  });

  test("the header is inert while headerAuth is unset (REQ-5)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/`, { headers: { "X-Test-User": "alice@example.com" } });
    expect(res.status).toBe(401);
  });

  test("headerAuth admits an allowed identity with no token, when bound to loopback (REQ-3/REQ-4)", async () => {
    const { base } = start({ bindHost: "127.0.0.1", headerAuth: HEADER_AUTH });
    const res = await fetch(`${base}/`, { headers: { "X-Test-User": "alice@example.com" } });
    expect(res.status).toBe(200);
  });

  test("an identity not on the list falls through to the ordinary token check (REQ-4)", async () => {
    const { base } = start({ queueToken: TOKEN, bindHost: "127.0.0.1", headerAuth: HEADER_AUTH });
    const res = await fetch(`${base}/`, { headers: { "X-Test-User": "mallory@example.com" } });
    expect(res.status).toBe(401);
  });

  test("the token still works when headerAuth is also configured (REQ-6)", async () => {
    const { base } = start({ queueToken: TOKEN, bindHost: "127.0.0.1", headerAuth: HEADER_AUTH });
    const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
  });

  test("headerAuth on a non-loopback bind refuses to start (REQ-5)", () => {
    expect(() => start({ headerAuth: HEADER_AUTH })).toThrow(/loopback|127\.0\.0\.1/i);
  });
});

// Spec 87: the page is about SPECS. That a queue orders the runs is an
// implementation detail, and it stopped being the name a reader reads.
// The old address keeps working: people bookmark this page, and the
// token arrives in the query string of exactly such a bookmark.
describe("the page moved from /queue to /specs to / (criteria 7-9, 12)", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };

  // Spec 100 criterion 3: /queue was pointed at /specs; both now point
  // at `/`, because that is where the list itself is.
  test("GET /queue redirects to / with the query string intact (criterion 7)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/queue?token=${TOKEN}&state=active&sort=cost`, {
      ...auth,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/?token=${TOKEN}&state=active&sort=cost`);
  });

  // Spec 100 criterion 2: the address this page used to live at.
  test("GET /specs redirects to / with the query string intact", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs?token=${TOKEN}&state=active&sort=cost`, {
      ...auth,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/?token=${TOKEN}&state=active&sort=cost`);
  });

  test("GET /specs with nothing to carry redirects to exactly /", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs`, { ...auth, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  // Spec 100 criterion 4: the DETAIL page did not move, so this one
  // target is deliberately unchanged. A /<id> here would break every
  // job link already sent out.
  test("GET /queue/<id> redirects to /specs/<id>, tab and all (criterion 8)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await fetch(`${base}/queue/${made.job.id}?tab=steps`, { ...auth, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/specs/${made.job.id}?tab=steps`);
  });

  // Spec 100 criterion 5: the other half of the same guard — the detail
  // page answers where it always has, with no redirect hop in front.
  test("GET /specs/<id> renders the job page itself, no redirect", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await fetch(`${base}/specs/${made.job.id}`, { ...auth, redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("81-queue-and-runner");
  });

  // Spec 100 criterion 1: the list itself, at the root, in one request.
  test("GET / is the spec list: rows, filter controls and the New-spec link", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/`, { ...auth, redirect: "manual" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="jobrows"');
    expect(html).toContain('data-folder="81-queue-and-runner"');
    // Spec 121: a link to the form's own page, not the form.
    expect(html).toContain('href="/new"');
    expect(html).not.toContain('action="/api/queue/create"');
    // The overview it replaced is gone from this address, not merely
    // pushed below the fold.
    expect(html).not.toContain("<h2>Projects</h2>");
  });

  test("the renamed page says Specs in its nav, heading and title (criterion 9)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, auth)).text();
    expect(html).toContain("<title>aide -board</title>");
    // No heading: the Specs tab right above it already says it
    // (2026-08-19). The tab bar is the page's name.
    expect(html).not.toContain("<h1>Specs</h1>");
    // Spec 119: the list has a tab of its own again, and it is the
    // current one here. The wordmark still goes home too.
    expect(html).toMatch(/<nav[^>]*>[\s\S]*aria-current="page"[^>]*>Specs<\/a>/);
    expect(html).toContain('<a class="brand" href="/">');
    // Not one label left saying it either — the button and the form's
    // heading were the other two places the retired word was read.
    expect(html).not.toContain("Queue a job");
    expect(html).not.toContain("Queue it");
  });

  // The whole page, with fixtures that carry no "queue" of their own:
  // the check above cannot sweep for the word, because this machine's
  // own spec 81 is CALLED `81-queue-and-runner`.
  test("nothing a reader reads on the page says Queue (criterion 9)", () => {
    const html = renderQueuePage(
      [
        {
          id: "j1", project: "aide", specFolder: "87-run-from-the-list",
          steps: ["analyze"], stepIndex: 0, state: "done", spentUsd: 1,
          timeoutSec: 1200, createdAt: "2026-08-17T00:00:00Z",
        },
      ],
      "2026-08-17T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: true, targets: [{ project: "aide", specFolder: "87-run-from-the-list" }] },
    );
    // Attribute values and the stylesheet are addresses and identifiers
    // — `action="/api/queue"`, `name="steps"` — never read by anyone.
    // What is left is the words on the page.
    const read = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/="[^"]*"/g, "");
    expect(read).not.toMatch(/queue/i);
  });

  test("the JSON surface is not renamed and no redirect swallows it (criterion 12)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    expect(made.status).toBe(200);
    const id = ((await made.json()) as { job: { id: string } }).job.id;

    const list = await fetch(`${base}/api/queue`, { ...auth, redirect: "manual" });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { jobs: unknown[] }).jobs.length).toBe(1);

    const one = await fetch(`${base}/api/queue/${id}`, { ...auth, redirect: "manual" });
    expect(one.status).toBe(200);
    expect(((await one.json()) as { job: { id: string } }).job.id).toBe(id);

    const cancel = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST", headers, redirect: "manual",
    });
    expect(cancel.status).toBe(200);
  });
});
