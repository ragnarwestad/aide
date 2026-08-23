// Criterion 9 (spec 81): the queue surface is behind the token — read
// routes included — while /api/aide-runs and POST /api/aide-run stay open. A
// token that a page hands to anyone who can load the page is not a
// secret, so GET /queue is checked too.
//
// /queue carries page code; the generated pages do not —
// not by rule, but because they have nothing that needs it. /queue has
// a form, and a meta refresh every ten seconds would wipe whatever
// someone was half-way through filling in.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRootLock,
  createServer,
  parseArgs,
  parseQueueConcurrency,
  runnerArgv,
  type ServerOptions,
} from "../src/serve.ts";
import { createGitRunner, type GitRunner } from "../src/branch-status.ts";
import {
  computeSpecTotalDurationMs,
  renderNewSpecPage,
  renderQueuePage,
  renderQueueRows,
  type NewSpecPageOptions,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../src/render.ts";
import { failFetch, queueHarness, ran, statusSaying } from "./helpers/queue-server.ts";
import { fakeGit as gitFake } from "./helpers/fake-git.ts";

const TOKEN = "s3cret-token";

const harness = queueHarness("aide-queue-routes-");

const start = (extra: Partial<ServerOptions> = {}, alsoProjects: string[] = [], alsoSpecs: string[] = []) =>
  harness.start({ extra, alsoProjects, alsoSpecs });

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const JOB = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

/** A claude-usage that records the merges the dashboard reports to it
 *  (spec 158). The URL is never reached: what is under test is what the
 *  server decides to send, and to whom. */
function mergeEventSink(answer: () => Response | Promise<Response> = () => new Response("{}")) {
  const posted: Record<string, unknown>[] = [];
  const mergeEventFetch = (async (_url: unknown, init: unknown) => {
    posted.push(JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
    return answer();
  }) as unknown as typeof fetch;
  return { posted, mergeEventFetch, mergeEventUrl: "http://claude-usage.test/api/merge-event" };
}

/** One spec's header row, which since spec 94 is where its Run control
 *  lives — and the only line of the spec a collapsed row leaves in the
 *  page. */
const specHead = (html: string, folder: string): string =>
  html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";

/** The row's message panel (spec 143): the full-width row under the
 *  head, where every long message a row has to say is written — and
 *  since spec 151 that includes the queue's refusal of a press, which
 *  used to be squeezed into the name cell above. */
const specPanel = (html: string, folder: string): string =>
  html.match(new RegExp(`<tr class="specnotice"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";

/** Everything an OPEN row draws: its header line and the phase lines
 *  under it. Since spec 124 the row's controls are split across the
 *  two — Run and the other buttons stand in the header's own first
 *  cell, each phase's checkbox on the phase's own line — so a test
 *  about "what the row offers" reads the whole group. */
const specControls = (html: string, folder: string): string =>
  html.match(
    new RegExp(
      `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
        `(?=<tr class="[^"]*spechead|</tbody>)`,
    ),
  )?.[0] ?? "";

/** Whether a phase's own line says it is done. Since spec 124 the
 *  State column's badge is the one place that is said — the checkbox
 *  beside it carries no second mark, which is the duplication the spec
 *  set out to remove. */
const phaseDone = (group: string, step: string): boolean =>
  (
    group.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))?.[0] ?? ""
  ).includes('class="badge b-done"');

/** Since spec 103 a row is COLLAPSED unless the view names it, and the
 *  run control comes with opening it. A test about that control asks
 *  for the row open — the same query string the fold link builds. */
const openQuery = (...keys: string[]): string => `open=${encodeURIComponent(keys.join(","))}`;
const OPEN_81 = openQuery("aide/81-queue-and-runner");

/** The spec list, asked again until `ok` holds (spec 208).
 *
 *  A render reads memory now — the git answers behind a row arrive on
 *  the cache schedule's own tick, not inside the request. Every fixture
 *  below that makes its commits or edits its files AFTER the server
 *  started is therefore asserting something that lands a tick later,
 *  and the ONE thing that changed for these tests is that they ask
 *  again rather than once.
 *
 *  Bounded, and it falls through with the last answer it got: a genuine
 *  regression then reads as the assertion it broke rather than as a
 *  timeout with nothing to look at. The same idiom `projects-route.test.ts`
 *  has used for the drift poll since spec 203. */
const listUntil = async (
  base: string,
  ok: (html: string) => boolean,
  budgetMs = 3000,
): Promise<string> => {
  const deadline = Date.now() + budgetMs;
  let html = "";
  for (;;) {
    html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    if (ok(html) || Date.now() > deadline) return html;
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** Git has dated the spec's folder — which it can only do once the
 *  fixture's own `ran()` has made the repo, and once the cache schedule
 *  has come round since (spec 208). `–` is the cell before either. */
const dated = (html: string): boolean =>
  !specControls(html, "81-queue-and-runner").includes('data-col="started">–');

/** The commonest of those predicates: this phase's own line says done. */
const rowSaysDone = (step: string, folder = "81-queue-and-runner") => (html: string): boolean =>
  phaseDone(specControls(html, folder), step);

describe("no token configured", () => {
  test("every queue route is 503; /api/aide-runs and POST /api/aide-run are unaffected", async () => {
    const { base } = start();
    for (const [path, init] of [
      // Spec 100: `/` is the list now, so it is behind the token like
      // every other read route on the queue surface — including the two
      // old addresses, which redirect to it only once the token is in.
      ["/", {}],
      ["/queue", {}],
      ["/specs", {}],
      ["/specs/abc", {}],
      ["/api/queue", {}],
      ["/api/queue/abc/approve", { method: "POST" }],
      ["/api/queue/abc/cancel", { method: "POST" }],
      // Spec 189's stream is on the same surface and behind the same
      // guard — a held-open connection outside it would be a bypass
      // that told anyone who could reach the port when work moved.
      ["/api/queue/events", {}],
    ] as const) {
      const res = await fetch(`${base}${path}`, init);
      expect(res.status).toBe(503);
      expect((await res.text()).toLowerCase()).toContain("token");
    }
    expect((await fetch(`${base}/api/aide-runs`)).status).toBe(200);
    // The static overview kept its own address and its own openness: it
    // moved off `/`, not behind the token.
    expect((await fetch(`${base}/projects.html`)).status).toBe(200);
    const emitted = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "implement", spec: "81" }),
    });
    expect(emitted.status).toBe(200);
  });
});

describe("token configured", () => {
  test("a queue request without the token is 401", async () => {
    const { base } = start({ queueToken: TOKEN });
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect((await fetch(`${base}/queue`)).status).toBe(401);
    expect((await fetch(`${base}/specs`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`, { method: "POST", body: JSON.stringify(JOB) })).status).toBe(401);
    expect((await fetch(`${base}/?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/queue?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/specs?token=wrong`)).status).toBe(401);
    // Spec 189: and the event stream, which `EventSource` reaches with
    // the page's cookie and nothing else.
    expect((await fetch(`${base}/api/queue/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue/events?token=wrong`)).status).toBe(401);
  });

  test("the spec 80 emitter route stays open — a 401 there would empty /api/aide-runs silently", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "analyze", spec: "81" }),
    });
    expect(res.status).toBe(200);
    expect((await fetch(`${base}/api/aide-runs`)).status).toBe(200);
  });

  test("GET /?token=… returns 200 and sets an HttpOnly cookie; the cookie then suffices", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    // Lax, never Strict: a Strict cookie is withheld on a top-level
    // navigation that started somewhere else, and an installed app
    // launched from the home screen is one — the dashboard opened on
    // "unauthorized" on a phone whose browser was signed in
    // (2026-08-22). Lax still keeps it off a cross-site POST.
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("SameSite=Strict");
    const jar = cookie.split(";")[0];
    expect((await fetch(`${base}/`, { headers: { cookie: jar } })).status).toBe(200);
  });

  test("the header works for API callers", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jobs: [] });
  });

  test("a form POST answers 303 to /; a JSON caller gets JSON", async () => {
    const { base } = start({ queueToken: TOKEN });
    const form = await fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
    });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/");

    const json = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      // A different step: the same one is refused while the first is
      // unfinished, which is a separate rule with its own tests.
      body: JSON.stringify({ ...JOB, steps: ["implement"] }),
    });
    expect(json.status).toBe(200);
    const listed = (await (await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })).json()) as {
      jobs: { project: string }[];
    };
    expect(listed.jobs.length).toBe(2);
  });

  test("an unknown project is 400 and stores nothing; an oversize body is 413", async () => {
    const { base } = start({ queueToken: TOKEN });
    const bad = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ ...JOB, project: "claude-usage" }),
    });
    expect(bad.status).toBe(400);
    const big = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ ...JOB, pad: "x".repeat(5000) }),
    });
    expect(big.status).toBe(413);
    const listed = (await (await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })).json()) as {
      jobs: unknown[];
    };
    expect(listed.jobs).toEqual([]);
  });

  test("cancel marks the job cancelled", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const id = made.job.id;
    expect((await fetch(`${base}/api/queue/${id}/cancel`, { method: "POST", headers })).status).toBe(200);
    const after = (await (await fetch(`${base}/api/queue`, { headers })).json()) as {
      jobs: { id: string; state: string }[];
    };
    expect(after.jobs.find((j) => j.id === id)?.state).toBe("cancelled");
    expect((await fetch(`${base}/api/queue/nope/cancel`, { method: "POST", headers })).status).toBe(404);
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

// The row is where you SEE which phases have run; spec 94 makes it
// where you run them. Any subset of the four, one job, on the model the
// row picked.
describe("running a spec's phases from its own row (criteria 1-4, 11)", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
  const CHOICES = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  /** Exactly what the row's form posts: no target, no caps. */
  const postRow = (base: string, fields: Record<string, string>) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(fields).toString(),
    });

  // Spec 171: there was a Resolve form here that posted a fixed
  // `steps=resolve`. The step is retired, and the route is where that
  // is enforced for anything still holding the old body — a bookmark,
  // a script, a stale page left open in a tab.
  test("a body still naming the retired resolve step is refused (spec 171)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "resolve",
    });
    expect(res.status).toBe(400);
  });

  test("the row's fields queue the step it ticked, on the model it picked (criteria 1-3)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "implement",
      model: "fable",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: { steps: string[]; gateAfter?: string[]; model: Record<string, string> };
    };
    expect(body.job.steps).toEqual(["implement"]);
    expect(body.job.model).toEqual({ implement: "fable" });
    // Spec 149: there is no gate to name at all any more, so the field
    // is not on the job the queue hands back.
    expect(body.job.gateAfter).toBeUndefined();
  });

  test("the default option queues no override at all (criterion 4)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "implement",
      model: "",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number } };
    expect(body.job.model).toEqual({ implement: "opus" });
    expect(body.job.budgetUsd).toBe(3);
  });

  // Spec 181, criterion 7: the review of the plan runs inside analyze
  // now, so the step is two steps' worth of work. The shipped table
  // gives it more clock than the fallback every unnamed step falls to
  // — `archive` is not in the table, so its limit IS that fallback.
  test("analyze's own time limit is longer than the default (spec 181)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze", "archive"] }),
    });
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: { timeoutSec: Record<string, number> } };
    expect(job.timeoutSec.analyze!).toBeGreaterThan(job.timeoutSec.archive!);
  });

  test("every row offers all three steps — the row is the way a spec starts (criterion 11)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    const line = specControls(html, "81-queue-and-runner");
    for (const step of ["analyze", "implement", "archive"]) {
      expect(line).toContain(`<input type="checkbox" name="steps" value="${step}"`);
    }
  });

  // Spec 116 gave create a phase line of its own; spec 139 gave it the
  // same source as every other step. `/aide-create` writes
  // `Workflow steps completed: create` into 4-status.md, so a created
  // spec says so — and the line is a report, never a box to tick.
  // Its box is ticked and disabled since 2026-08-21 — the hole where
  // the other four have one made the line read as a different kind of
  // thing. What must still hold is that no press can post it.
  test("a created spec reads create as done, and its box cannot be posted (spec 116)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create"]);
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    const create = html.match(/<tr class="subrow[^"]*"[^>]*data-step="create">.*?<\/tr>/)?.[0] ?? "";
    expect(create).toContain("b-done");
    const controls = specControls(html, "81-queue-and-runner");
    expect(controls).toContain('data-phase="create"');
    // Ticked, disabled, and carrying no field name — three reasons a
    // press can never send `steps=create`.
    expect(controls).toMatch(/<input type="checkbox" value="create" checked disabled/);
    expect(controls).not.toContain('name="steps" value="create"');
  });

  test("ticking two phases queues ONE job with both, in workflow order (criterion 3)", async () => {
    const { base } = start({ queueToken: TOKEN });
    // A browser sends one `steps` value per ticked box, in the order the
    // boxes are drawn — never in the order they were clicked.
    const body = new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner" });
    body.append("steps", "analyze");
    body.append("steps", "implement");
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    const made = (await res.json()) as { job: { steps: string[]; gateAfter?: string[] } };
    expect(made.job.steps).toEqual(["analyze", "implement"]);
    expect(made.job.gateAfter).toBeUndefined();
  });

  // The checkbox that used to send this key went in spec 133 and the
  // gate itself in spec 149, so a urlencoded body naming `gate` is a
  // stray from somewhere else. It is ignored, like any other unknown
  // key, and the job runs straight through.
  test("a stray gate key is ignored (criterion 3)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const body = new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner" });
    body.append("steps", "analyze");
    body.append("steps", "implement");
    body.append("gate", "on");
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    const made = (await res.json()) as { job: { gateAfter?: string[]; state: string } };
    expect(made.job.gateAfter).toBeUndefined();
    expect(made.job.state).toBe("queued");
  });

  test("ticking a phase that is already done reruns it, with no new refusal (criterion 4)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const html = await listUntil(base, rowSaysDone("analyze"));
    // Said done by the phase line's own State column — the box beside
    // it carries no second mark (spec 124) — and still submittable.
    const analyze = specControls(html, "81-queue-and-runner")
      .match(/<tr class="subrow[^"]*"[^>]*data-step="analyze">[\s\S]*?<\/tr>/)![0];
    expect(analyze).toContain('class="badge b-done"');
    expect(analyze).toContain('<input type="checkbox" name="steps" value="analyze"');
    expect(analyze).not.toContain("already done");
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "analyze",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: { steps: string[] } }).job.steps).toEqual(["analyze"]);
  });

  // Spec 87's criterion 10 said the opposite — "a spec nothing has ever
  // run gets no row, so the form is its only way in". Spec 90 reverses
  // it deliberately: the dropdown and the list held the same things, and
  // a spec crossing from one to the other told the reader nothing.
  test("a spec nothing has ever run is a row, and analyze starts from it (spec 90, criterion 16)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    expect(html).toContain('<tr class="spechead');
    expect(html).toContain('data-folder="81-queue-and-runner"');
    const line = specControls(html, "81-queue-and-runner");
    // Nothing has ever run for it, so analyze is ticked — the step
    // every spec here is actually started as.
    expect(line).toContain('value="analyze" checked');
    // Spec 176: the State column says what the process says comes
    // next, on a row nothing has run as on one that has.
    expect(html).toContain('class="badge b-ready"');
    expect(html).toContain("ready for analyze");
    expect(html).not.toContain("not started");
  });

  test("the fold survives the refresh the page performs on itself (spec 90, criterion 17)", async () => {
    const { base } = start({ queueToken: TOKEN });
    // The refresh the page performs on itself sends `location.search`
    // back, so the row the reader opened is still open in the swap —
    // and a row nobody opened is still shut (spec 103's default).
    const shut = await (await fetch(`${base}/?rows=1`, auth)).text();
    expect(shut).toContain('data-folder="81-queue-and-runner"');
    expect(shut).not.toContain('<tr class="subrow');
    const opened = await (await fetch(`${base}/?rows=1&${OPEN_81}`, auth)).text();
    expect(opened).toContain('data-folder="81-queue-and-runner"');
    expect(opened).toContain('<tr class="subrow');
  });
});

describe("GET / (the spec list, HTML)", () => {
  test("layout, forms, labels, and the runner notice", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("<nav");
    expect(html).toContain("81-queue-and-runner");
    expect(html).toContain('<form id="rowrun-aide/81-queue-and-runner" method="post"');
    expect(html).toContain('<a class="brand" href="/">');
    // Every control says what it is: an unlabelled checkbox next to some
    // buttons tells the reader nothing. The steps, the row's one button
    // and what is left of the fields nobody sets every time are all on
    // the one line an open row grows (spec 117) — nothing waits behind
    // a second click. 81a ships no runner, so the job posted above is
    // sitting in "queued": the row's one control is the way to stop it,
    // named for the step it would stop (spec 157).
    const line = specControls(html, "81-queue-and-runner");
    expect(line).toContain(">Cancel</button>");
    for (const step of ["analyze", "implement", "archive"]) {
      expect(line).toContain(`name="steps" value="${step}"`);
      expect(line).toContain(`aria-label="${step}"`);
    }
    expect(html).not.toContain(">more</summary>");
    // 81a ships no runner: the page must say so rather than leave a
    // job sitting in "queued" with no explanation.
    expect(html.toLowerCase()).toContain("no runner");
  });

  test("the blunt meta refresh is a no-JS fallback, not the mechanism", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    // A page with a form must not reload underneath someone filling it
    // in; the script swaps the table body instead.
    expect(html).toContain("<noscript><meta http-equiv=\"refresh\"");
    expect(html).toContain("<script");
    expect(html).toContain('id="jobrows"');
  });

  // Spec 107 narrowed this, deliberately and by exactly one script. A
  // theme the reader chose has to be applied before the page paints,
  // and a generated page is a FILE — there is no server in front of it
  // to have decided. So every page now carries the theme switcher, and
  // this test says which script that is rather than allowing scripts
  // in general: anything else appearing here is still the drift the
  // test was written to stop.
  //
  // Spec 115 widened it by exactly one more, on exactly one page: the
  // overview is a redirect now, and sending a reader on is what that
  // page is FOR. Named here rather than allowed in general — the rule
  // for every other page is unchanged, and this one's second script is
  // asserted to be the redirect and nothing else.
  test("the generated pages carry no page code beyond the shared theme switcher", async () => {
    const { renderSite, OVERVIEW_PAGE } = await import("../src/render.ts");
    for (const page of renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "x")) {
      const scripts = [...page.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      const allowed = page.path === OVERVIEW_PAGE ? 2 : 1;
      expect([page.path, scripts.length]).toEqual([page.path, allowed]);
      expect(scripts[0]).toContain("data-theme-choice");
      if (allowed === 2) expect(scripts[1]).toBe("location.replace('/projects' + location.search);");
      expect(page.html.match(/<script/g)).toHaveLength(allowed);
    }
  });

  test("?rows=1 returns the table body alone, for the script to swap in", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (
      await fetch(`${base}/?rows=1&${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(rows).toContain("<tr");
    expect(rows).toContain("81-queue-and-runner");
    expect(rows).not.toContain("<html");
    // The row's own control belongs to a ROW, so unlike the retired top
    // form it must survive the swap: without it, every five seconds the
    // page would lose the only way to act on a spec (criterion 8). The
    // job posted above is queued with no runner to take it, so that
    // control is Cancel.
    const line = specControls(rows, "81-queue-and-runner");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('<input type="checkbox" name="steps" value="analyze"');
    expect(line).toContain(">Cancel</button>");
  });

  // A generated page is a FILE, and the list it points at is served.
  // Both ways there are absolute: the wordmark and, since spec 119, the
  // Specs tab — which is never the current one on a generated page.
  test("generated pages reach the list through the wordmark and the Specs tab", async () => {
    const { renderSite } = await import("../src/render.ts");
    const pages = renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "2026-08-16");
    for (const p of pages) {
      expect(p.html).toContain('<a class="brand" href="/">');
      expect(p.html).toContain('<a class="tab" data-nav data-goto href="/">Specs</a>');
    }
  });
});

describe("renderQueuePage state labels", () => {
  // Every job gets its own spec: the list holds one line per SPEC, so
  // nine jobs sharing a folder would be nine attempts at one phase, of
  // which only the latest shows — and this test is about how each state
  // is put into WORDS, not about which of them the list picks.
  let seq = 0;
  const row = (state: string, extra: Partial<QueueRowView> = {}): QueueRowView => {
    const n = ++seq;
    return {
      id: `id-${state}-${n}`,
      project: "aide",
      specFolder: `81-queue-and-runner-${n}`,
      steps: ["analyze"],
      stepIndex: 0,
      state: state as QueueRowView["state"],
      spentUsd: 0,
      timeoutSec: 1200,
      createdAt: "2026-08-16T00:00:00Z",
      ...extra,
    };
  };

  test("stopped is never rendered as failed", () => {
    const html = renderQueuePage(
      [
        row("stopped", { stopReason: "budget" }),
        row("stopped", { stopReason: "timeout" }),
        row("failed", { error: "boom" }),
        row("queued"),
        row("running"),
        row("done"),
        row("cancelled"),
        row("interrupted"),
      ],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: false, targets: [] },
    );
    expect(html).toContain("stopped — budget");
    expect(html).toContain("stopped — 20 min");
    expect(html).toContain("failed");
    expect(html).not.toContain("stopped — failed");
  });
});

describe("every row answers for itself", () => {
  // The title and the phase left the row on 2026-08-21 — the folder name
  // says the one and the pips say the other — and the percentage left it
  // in spec 167. The point of the test is unchanged: the row answers for
  // itself, server-rendered, with no selection and no data block for a
  // script to read. This is the one test that follows the percentage all
  // the way from a real 4-status.md on disk to the served HTML, so it is
  // the one that can still go red if the figure ever creeps back.
  test("a spec's progress stays off its own row (criterion 9)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // A status file that DOES carry a percentage: the row must ignore it.
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"),
      statusSaying(
        ["create", "analyze"],
        "- **Total progress:** `64% (14 of 22 completed)`\n\n## Phase 2: GREEN\n\n| t | ⬜ |\n",
      ),
    );
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    // Server-rendered on the row itself: there is no selection left to
    // answer, and no data block for a script to answer it from.
    const line = specHead(html, "81-queue-and-runner");
    // The figure counted the checkbox rows implement ticks, so it was 0
    // with analyze done and 90-something the moment implement ended. The pips say how far the spec has got and the
    // State column says what is happening now.
    expect(line).not.toContain("% done");
    expect(line).not.toContain("64%");
    expect(line).not.toContain("Phase 2: GREEN");
    // What the row DOES still read off this same file: the steps behind
    // it, as green pips. The percentage is gone; the file is still read.
    expect(line).toContain('class="pips"');
    expect(html).not.toContain('id="targetdata"');
    expect(html).not.toContain('<select name="target"');
  });

  // Spec 93 put this reason in ONE place, above the table, and said so:
  // "it belongs to the PAGE, not to one control". That held while the
  // page had one form; it lists up to 25 rows, and a reason attached to
  // none of them does not say which button was pressed. Spec 99 moved
  // it onto the row that posted it — the same reason, read off the same
  // query string, one row further down.
  test("a refusal is shown once, on the row that posted it (criterion 6)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
        body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
      });
    await post();
    const refused = await post();
    expect(refused.status).toBe(303);
    const location = refused.headers.get("location") ?? "";
    expect(location.startsWith("/?error=")).toBe(true);
    const html = await (await fetch(`${base}${location}`, { headers: { "x-aide-token": TOKEN } })).text();
    // In the row's own panel since spec 151, not in the name cell.
    expect(specPanel(html, "81-queue-and-runner")).toContain("already queued");
    expect(specHead(html, "81-queue-and-runner")).not.toContain("already queued");
    // Once, not twice: the banner is the fallback for a refusal that
    // belongs to no row.
    expect(html).not.toContain('<p class="refusal">');
  });

  test("state is a chip with its own class, so a failure is not a wall of grey", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (await fetch(`${base}/?rows=1`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(rows).toContain('class="badge b-idle"');
    expect(rows).toContain("queued");
  });
});

describe("page code placement", () => {
  /** Where the <script> whose code contains `needle` starts. The served
   *  page has carried two inline scripts since spec 107 — the theme
   *  switcher in <head> and the list's own code at the end of <body> —
   *  so "the first one" stopped naming either of them. */
  const scriptAt = (html: string, needle: string): number => {
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      if (m[1]!.includes(needle)) return m.index!;
    }
    return -1;
  };

  test("the script comes AFTER the elements it wires up", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    const rows = html.indexOf('id="jobrows"');
    const script = scriptAt(html, "jobrows");
    expect(rows).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(-1);
    // An inline script in <head> runs before the DOM exists, so every
    // listener attaches to nothing — and the failure is silent.
    expect(script).toBeGreaterThan(rows);
    expect(html.indexOf("</head>")).toBeLessThan(script);
  });

  // Spec 107. The other placement, and the opposite reason for it: the
  // theme has to be on the html element before the first paint, so this
  // script deliberately goes where the one above must not.
  test("the theme switcher comes BEFORE anything it could be seen to change", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    const theme = scriptAt(html, "data-theme-choice");
    expect(theme).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(html.indexOf("</head>"));
    expect(theme).toBeLessThan(html.indexOf("<body>"));
    expect(theme).toBeLessThan(html.indexOf('id="jobrows"'));
  });

  test("the two scripts are two, and each is found by what it says", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(scriptAt(html, "jobrows")).not.toBe(scriptAt(html, "data-theme-choice"));
  });
});

describe("the step boxes on a row follow that spec", () => {
  test("a step the spec has already had is marked done and left unticked (criterion 1)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const html = await listUntil(base, rowSaysDone("analyze"));
    const line = specControls(html, "81-queue-and-runner");
    // analyze is done; implement is what you came for.
    expect(line).toMatch(/data-phase="analyze"[^]*?value="analyze"(?![^>]*checked)/);
    expect(line).toMatch(/data-phase="implement"[^]*?value="implement"[^>]*checked/);
    expect(phaseDone(line, "analyze")).toBe(true);
  });

  test("a spec nothing has run yet offers analyze (criterion 1a)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "2-analysis.md"),
      "# Analysis\n\n[filled in by /aide-analyze]\n",
    );
    // Created and nothing else: the record, not the file's size, is
    // what says so (spec 139).
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    const line = specControls(html, "81-queue-and-runner");
    expect(line).toMatch(/value="analyze" checked/);
    expect(phaseDone(line, "analyze")).toBe(false);
  });

  test("with the analysis already on disk, implement is pre-ticked (criterion 1b)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // Analysed by hand and committed with the subject the runner uses
    // (spec 154), so the row must not tick and mark the same box at
    // once.
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"),
      statusSaying(["create", "analyze"]),
    );
    ran(dir, ["create", "analyze"], "81-queue-and-runner", { headless: false });
    const line = specControls(await listUntil(base, rowSaysDone("analyze")), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(line).not.toMatch(/value="analyze" checked/);
    expect(line).toMatch(/value="implement" checked/);
  });
});

// Slice 81c: what the server actually hands the runner. The binary is a
// recording stub — one tiny local process, no claude, no network.
describe("the runner invocation", () => {
  function stub(dir: string): { bin: string; argvFile: string } {
    const argvFile = join(dir, "runner-argv.txt");
    const bin = join(dir, "fake-run-spec");
    writeFileSync(bin, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${argvFile}\n`, { mode: 0o755 });
    return { bin, argvFile };
  }

  async function argvOf(argvFile: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      try {
        return readFileSync(argvFile, "utf-8");
      } catch {
        await Bun.sleep(50);
      }
    }
    throw new Error("the runner was never invoked");
  }

  test("the push mode, the permission mode and the model all reach the command line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-spawn-"));
    ownDirs.push(dir);
    const { bin, argvFile } = stub(dir);
    const { base } = start({
      queueToken: TOKEN,
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush: "branch",
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(res.status).toBe(200);
    const argv = await argvOf(argvFile);
    expect(argv).toContain("--push branch");
    expect(argv).toContain("--permission-mode bypassPermissions");
    expect(argv).toContain("--model opus");
    expect(argv).toContain("--command implement");
  });
});

// Spec 108: the FILES say what has happened to a spec — not the queue's
// own record of what it ran. The two used to be unioned, so either one
// being true was enough, which is how an archive job that finished
// without moving anything counted as an archived spec.
// Spec 139: one record says how far a spec has got. The dashboard used
// to GUESS — 2-analysis.md over 400 bytes meant analysed, a "Plan
// review" heading in 3-solution.md meant reviewed, 100% in 4-status.md
// meant implemented. On 2026-08-20 the first of those marked spec 138
// analysed before any analyze had run: its untouched analysis template
// is 693 bytes and carries a placeholder the check did not know. The
// row then offered review-plan, and review-plan ran three times against
// an empty template.
describe("spec 139: the steps a spec has had say so themselves", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
  const specDir = (dir: string) => join(dir, "root", "aide", "specs", "81-queue-and-runner");

  test("an untouched analysis template is not an analysis (criterion 2)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // Spec 138's own file, at its own size, with the placeholder
    // `/aide-create` actually writes — the exact shape that read as
    // done. The record beside it says the spec has only been created.
    writeFileSync(
      join(specDir(dir), "2-analysis.md"),
      "# X - Analysis\n\n## Findings\n\n[not analyzed yet]\n" + "Section placeholder. ".repeat(40),
    );
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create"]));
    const line = specControls(await (await fetch(`${base}/?${OPEN_81}`, auth)).text(), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    // And the box that comes pre-ticked is the one that has not run.
    expect(line).toMatch(/value="analyze" checked/);
  });

  test("the recorded list is what the row marks done, and implement is next (criterion 3)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listUntil(base, rowSaysDone("analyze")), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(phaseDone(line, "implement")).toBe(false);
    expect(line).toMatch(/value="implement" checked/);
    expect(line).not.toMatch(/value="analyze" checked/);
  });

  // Implement's mark used to be earned from the percentage, which says
  // how far the TDD phases inside the step have got — not whether the
  // step ran. A spec whose plan has 22 tasks all ticked is implemented
  // because implement SAYS so.
  test("100% without the record does not make implement done (criterion 2)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(
      join(specDir(dir), "4-status.md"),
      statusSaying(["create", "analyze"], "- **Total progress:** `100% (22 of 22 completed)`\n"),
    );
    ran(dir, ["create", "analyze"]);
    const line = specControls(await (await fetch(`${base}/?${OPEN_81}`, auth)).text(), "81-queue-and-runner");
    expect(phaseDone(line, "implement")).toBe(false);
    expect(line).toMatch(/value="implement" checked/);
  });

  test("a spec with no status file at all has had nothing, and does not throw (criterion 4)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    rmSync(join(specDir(dir), "4-status.md"));
    const line = specControls(await listUntil(base, rowSaysDone("create")), "81-queue-and-runner");
    // Spec 176: the folder is on disk, so `create` happened — whatever
    // git records. The steps this test is the guard for are the other
    // four, which stay correctly not done.
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(line).toMatch(/value="analyze" checked/);
  });
});

describe("the spec's own history says what has happened, not the queue's", () => {
  test("a step the queue completed is NOT done while the history says otherwise", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    // Analysed already; the status says 95%, so implement is what is
    // still to do.
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(["create", "analyze"], "- **Total progress:** `95% (21 of 22 completed)`\n"),
    );
    ran(dir, ["create", "analyze"]);

    let html = await listUntil(base, rowSaysDone("analyze"));
    expect(html).toMatch(/value="implement" checked/);

    // Record a completed implement in the queue's own history, exactly
    // as a finished step does.
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST", headers, body: JSON.stringify({ ...JOB, steps: ["implement"] }),
      })
    ).json()) as { job: { id: string } };
    const mirror = JSON.parse(readFileSync(join(dir, "queue.json"), "utf-8")) as Record<string, unknown>[];
    // Finished, not still queued: since spec 105 a spec with a job in
    // flight pre-ticks nothing at all — every box on the row is locked.
    mirror[0].state = "done";
    mirror[0].results = [
      { step: "implement", ok: true, costUsd: 12.34, costMeasured: true,
        terminalReason: "completed", at: "2026-08-16T18:00:00Z" },
    ];
    writeFileSync(join(dir, "queue.json"), JSON.stringify(mirror));
    expect(made.job.id).toBeTruthy();

    // A fresh process reading both: the job's `ok` flag changes nothing.
    // The percentage is still 95, so implement is still what to run.
    const second = start({
      queueToken: TOKEN,
      queueMirrorPath: join(dir, "queue.json"),
      projectRoot: join(dir, "root"),
    });
    html = await listUntil(second.base, rowSaysDone("analyze"));
    expect(html).toMatch(/value="implement" checked/);
    // `archive` is ticked here too and always is (spec 200: every phase
    // the spec has left starts ticked), so what says implement is not
    // behind us is the BUTTON — it names the first ticked phase, and
    // would read "Archive" if the queue's own record counted.
    expect(html).toContain(">Implement</button>");
    // And the phase line says the same: a step the queue ran is not a
    // step the spec has HAD.
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "implement")).toBe(false);
  });

  test("the same step IS done once the runner has committed it", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "- **Total progress:** `100% (22 of 22 completed)`\n",
      ),
    );
    ran(dir, ["create", "analyze", "implement"]);

    const html = await listUntil(base, rowSaysDone("implement"));
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "implement")).toBe(true);
    expect(html).toMatch(/value="archive" checked/);
    // The button is named for the phase a press would run (spec 157) —
    // the bare word "Run" went with the again-variant that preceded it.
    expect(html).not.toContain("Run again");
    expect(html).toContain(">Archive</button>");
  });

  test("a spec whose archive run declined says why, on the row and in the sentence", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "- **Total progress:** `100% (22 of 22 completed)`\n\n" +
          "## Archive held back\n\n- the Slack webhook (Phase 4, still unchecked)\n",
      ),
    );

    // Spec 208: written after the server started, so the disk scan the
    // boot-time cache warm took is a scan of the file before this one.
    // The watcher clears it and the row catches up a tick later.
    const html = await listUntil(base, (h) => h.includes("held back"));
    expect(html).toContain("held back");
    expect(html).toContain("the Slack webhook (Phase 4, still unchecked)");
  });

  test("a spec whose folder has been archived is off the list entirely (criterion 7)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const archived = join(dir, "root", "aide", "specs", "archive", "80-already-archived");
    mkdirSync(archived, { recursive: true });
    writeFileSync(join(archived, "1-description.md"), "# 80 - Description\n");

    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("81-queue-and-runner");
    expect(html).not.toContain("80-already-archived");
  });
});

// Reserving the heaviest model for the heaviest jobs. The page offers
// exactly what the config lists — a dropdown that could name a model
// the server has not granted a budget to would be a way to spend more
// than the machine agreed to.
describe("picking a model for a job", () => {
  const CHOICES = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  // The choice belongs to a row the reader has opened (spec 103), so
  // every page here opens the one spec it renders.
  const OPEN = { open: "aide/81-queue-and-runner" };

  test("the form offers the configured models, one picker per phase", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
      modelChoices: [
        { name: "sonnet", budgetUsd: 3 },
        { name: "fable", budgetUsd: 12 },
      ],
    });
    expect(html).toContain('name="model.analyze"');
    expect(html).toContain('name="model.implement"');
    expect(html).toContain("fable");
    // What each is granted is still said — in the option's tooltip
    // since spec 123, not read out on every label.
    expect(html).toContain('title="$12 per step"');
    // No "default" entry any more (2026-08-19): the select is pre-filled
    // with a real name, and only real names are offered.
    for (const step of ["analyze", "implement"]) {
      const select = html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))![0];
      expect([step, select.includes('<option value=""')]).toEqual([step, false]);
    }
  });

  // The "default" option is gone (asked for 2026-08-19): the select is
  // pre-filled with a real name instead, and every option's figure lives
  // in its tooltip — never on the label.
  test("no default option, no figure on any label; the tooltips keep them", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
      modelChoices: [{ name: "fable", budgetUsd: 12 }],
      defaultModels: { default: "fable" },
    });
    expect(html).not.toContain('<option value=""');
    expect(html).toMatch(/<option value="fable"[^>]*title="[^"]*\$12[^"]*"[^>]*>/);
    expect(html).not.toMatch(/<option[^>]*>[^<]*\$/);
  });

  test("with nothing configured the page offers no model at all", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
    });
    expect(html).not.toContain('name="model"');
  });

  test("a row says which model it ran on — as the select's pre-filled value", () => {
    const html = renderQueuePage(
      [
        {
          id: "a", project: "aide", specFolder: "81-queue-and-runner",
          steps: ["implement"], stepIndex: 0, state: "done", spentUsd: 24.5,
          timeoutSec: 1200, createdAt: "2026-08-16T00:00:00Z", model: "fable",
        },
      ],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      {
        runnerAvailable: true, targets: [], filter: OPEN,
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12 }],
        defaultModels: { default: "sonnet" },
      },
    );
    expect(html).toMatch(/<select name="model\.implement"[^>]*>[^]*?<option value="fable"[^>]*selected/);
  });

  test("posting a chosen model runs every step on it, with the config's budget", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "implement",
        model: "fable",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number; jobCapUsd: number } };
    expect(body.job.model).toEqual({ implement: "fable" });
    expect(body.job.budgetUsd).toBe(12);
    expect(body.job.jobCapUsd).toBe(30);
  });

  test("an empty model field means 'use the configuration', not an error", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "implement",
        model: "",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number } };
    expect(body.job.model).toEqual({ implement: "opus" });
    expect(body.job.budgetUsd).toBe(3);
  });

  // Spec 123: the choice moved onto the phase lines, so a form now
  // posts one field PER PHASE — `model.analyze=…&model.implement=…`.
  // A urlencoded body cannot carry a nested object, so the dotted keys
  // are folded back into one on the way in. Tested through the real
  // route rather than against the two functions separately: they are
  // only proven to AGREE if something drives an actual wire body from
  // one end to the other.
  test("one press can run two phases on two different models", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "analyze",
        "model.analyze": "sonnet",
      }).toString() + "&steps=implement&model.implement=fable",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: { model: Record<string, string>; budgetUsd: number; jobCapUsd: number };
    };
    expect(body.job.model).toEqual({ analyze: "sonnet", implement: "fable" });
    // The more generous of the two grants, not the two added together.
    expect(body.job.budgetUsd).toBe(12);
    expect(body.job.jobCapUsd).toBe(30);
  });

  // Every select on the page posts, including the ones left alone —
  // a browser sends `model.implement=` for a phase whose picker still
  // reads "default". Passed through as an empty string it would be
  // refused as an invalid model name; it has to be dropped instead.
  test("a phase left on 'default' posts a blank that is dropped, not refused", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body:
        "target=aide%2F81-queue-and-runner&steps=analyze&steps=implement" +
        "&model.analyze=fable&model.implement=",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ analyze: "fable", implement: "opus" });
  });

  test("every phase left on 'default' queues no override at all", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "target=aide%2F81-queue-and-runner&steps=implement&model.implement=",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number } };
    expect(body.job.model).toEqual({ implement: "opus" });
    expect(body.job.budgetUsd).toBe(3);
  });

  test("a per-phase field naming a model the config does not list is refused", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "target=aide%2F81-queue-and-runner&steps=implement&model.implement=gpt-9",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("gpt-9");
  });
});

// A refusal has to land where the person who pressed the button can
// read it. Answering a form post with a JSON body puts the reason on a
// blank page with no way back.
describe("a refused form post says so on the page", () => {
  test("a duplicate returns to / carrying the reason, and the page shows it", async () => {
    const { base } = start({ queueToken: TOKEN });
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
        body: new URLSearchParams({ target: "aide/81-queue-and-runner", steps: "analyze" }),
      });
    expect((await post()).status).toBe(303);

    const again = await post();
    expect(again.status).toBe(303);
    const location = again.headers.get("location") ?? "";
    expect(location.startsWith("/?")).toBe(true);
    expect(decodeURIComponent(location)).toContain("already queued");

    const html = await (
      await fetch(`${base}${location}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(html).toContain("already queued");
    // And only one job was made.
    const listed = (await (
      await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })
    ).json()) as { jobs: unknown[] };
    expect(listed.jobs.length).toBe(1);
  });

  test("a JSON caller still gets a 400 with the reason, not a redirect", async () => {
    const { base } = start({ queueToken: TOKEN });
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
        body: JSON.stringify(JOB),
      });
    expect((await post()).status).toBe(200);
    const again = await post();
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain("already");
  });
});

// One list, with the sorting and filtering that makes a fixed "Active"
// section unnecessary: asking for the running jobs is a filter, not a
// second table.
describe("the job list sorts and filters", () => {
  const row = (id: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: `${id}-spec`,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T00:00:00Z",
    ...extra,
  });

  /** A spec on disk, as the server hands it to the page. `createdAt` is
   *  what git answered for the folder's first commit (spec 199). */
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  /** The specs down the page, in the order they are drawn — off the
   *  header rows alone: `data-folder` is written more than once per
   *  spec, and a bare match counts a row twice. */
  const specOrder = (html: string): (string | undefined)[] =>
    [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map((m) => m[1]);

  /** One spec's own Started cell, off its header row. */
  const startedCell = (html: string, folder: string): string =>
    html
      .match(new RegExp(`<tr class="spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0]
      .match(/<td data-col="started">.*?<\/td>/)?.[0] ?? "";

  const page = (
    rows: QueueRowView[],
    filter?: QueuePageOptions["filter"],
    // Spec 199: "Started" is the spec's own creation date, and a
    // creation date comes off the TARGET (git), never off a job — so a
    // test about that column has to be able to give one.
    targets: QueueTarget[] = [],
  ) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets,
      filter,
    });

  test("one table holds every job — no fixed section above it", () => {
    const html = page([row("a", { state: "running" }), row("b")]);
    expect(html.match(/<table class="list"/g)).toHaveLength(1);
    expect(html).toContain("a-spec");
    expect(html).toContain("b-spec");
  });

  test("the state filter is offered with a count on each choice", () => {
    const html = page([row("a", { state: "running" }), row("b"), row("c", { state: "failed" })]);
    expect(html).toMatch(/>All · 3</);
    expect(html).toMatch(/>Active · 1</);
    expect(html).toMatch(/>Done · 1</);
    expect(html).toMatch(/>Problems · 1</);
  });

  test("asking for active work leaves the finished jobs out", () => {
    const rows = [row("a", { state: "running" }), row("b"), row("c", { state: "queued" })];
    const html = page(rows, { state: "active" });
    expect(html).toContain("a-spec");
    expect(html).toContain("c-spec");
    expect(html).not.toContain("b-spec");
  });

  test("a stopped job is a problem, not a success", () => {
    const html = page([row("a", { state: "stopped" }), row("b")], { state: "problem" });
    expect(html).toContain("a-spec");
    expect(html).not.toContain("b-spec");
  });

  // A chip per project stood above the list until 2026-08-23: one
  // control that grew with the machine, and nobody had asked to filter
  // by project. Every spec is listed now, whatever project it is from.
  test("no project filter is drawn, however many projects there are", () => {
    const rows = [row("a"), row("b", { project: "aide-dashboard" })];
    const html = page(rows);
    expect(html).not.toContain('data-filter="project"');
    expect(html).toContain("a-spec");
    expect(html).toContain("b-spec");
  });

  // The default view is the newest SPEC at the top — by number, not by
  // last activity (chosen 2026-08-19: activity order put a spec that
  // had just been created at the bottom, under everything that had
  // ever run). Started is still one click away.
  test("newest spec first is the default order", () => {
    const html = page([
      row("104", { startedAt: "2026-08-16T11:00:00Z" }),
      row("109", { startedAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(html.indexOf("109-spec")).toBeLessThan(html.indexOf("104-spec"));
    // The Spec heading spans two columns since spec 165 — the phase
    // name's and the row's AI — which is why the attribute is not
    // pinned to sitting straight after the class.
    expect(html).toMatch(
      /<th class="[^"]*" colspan="2" aria-sort="descending"><a class="sortlink on"[^>]*>Spec<svg/,
    );
  });

  // Spec 199: it used to put the most recent ACTIVITY first, so a spec
  // made months ago and re-run an hour ago outranked one made this
  // morning. The column and the sort hold when the spec was MADE now,
  // and a run does not move it.
  test("sorting by started puts the most recently CREATED spec first", () => {
    const html = page(
      // The older spec has the NEWER run, which is what used to decide
      // this order and no longer does.
      [row("old", { startedAt: "2026-08-16T11:00:00Z" }), row("new", { startedAt: "2026-08-16T09:00:00Z" })],
      { sort: "started" },
      [
        target("old-spec", { createdAt: "2026-08-10T09:00:00Z" }),
        target("new-spec", { createdAt: "2026-08-14T09:00:00Z" }),
      ],
    );
    expect(specOrder(html)).toEqual(["new-spec", "old-spec"]);
  });

  // The literal requirement: a phase being started, finished or run
  // again must not move the row. The older spec has the newer run.
  test("a run on an older spec does not move it up the started sort (criterion 1)", () => {
    const targets = [
      target("old-spec", { createdAt: "2026-08-10T09:00:00Z" }),
      target("new-spec", { createdAt: "2026-08-14T09:00:00Z" }),
    ];
    const before = page([row("old"), row("new")], { sort: "started" }, targets);
    const after = page(
      [
        row("old", { state: "running", startedAt: "2026-08-16T11:00:00Z" }),
        row("new", { startedAt: "2026-08-11T09:00:00Z" }),
      ],
      { sort: "started" },
      targets,
    );
    expect(specOrder(after)).toEqual(specOrder(before));
    expect(specOrder(after)).toEqual(["new-spec", "old-spec"]);
  });

  // The 200-job cap is what makes git the only possible source: a spec
  // older than two hundred jobs has no `Job` record left to read a date
  // off. `createdAt` comes off the target and touches no job at all, so
  // a target with NO rows is, for this code, exactly a spec whose job
  // was evicted (criterion 2).
  test("a spec with no job rows at all still shows its Started date (criterion 2)", () => {
    const html = page([], { sort: "started" }, [
      target("77-evicted", { createdAt: "2026-03-01T09:00:00Z" }),
    ]);
    expect(html).toContain("77-evicted");
    expect(html).toContain('title="2026-03-01T09:00:00Z"');
    expect(startedCell(html, "77-evicted")).not.toContain("–");
  });

  // Neither spec can be dated and neither has ever run: the same
  // folder-name-descending fallback the old `activityAt === 0`
  // tie-break gave, and no throw (criterion 8). It passes before the
  // change as well as after — deliberately: the criterion is that this
  // order is PRESERVED while the field the tie-break reads is replaced.
  test("two specs git cannot date fall back to folder order (criterion 8)", () => {
    const html = page([], { sort: "started" }, [target("88-undatable"), target("89-undatable")]);
    expect(specOrder(html)).toEqual(["89-undatable", "88-undatable"]);
  });

  test("sorting by cost puts the expensive job on top", () => {
    const html = page([row("cheap", { spentUsd: 0.5 }), row("dear", { spentUsd: 12 })], {
      sort: "cost",
    });
    expect(html.indexOf("dear-spec")).toBeLessThan(html.indexOf("cheap-spec"));
  });

  test("the same column clicked again turns the order round", () => {
    const html = page([row("cheap", { spentUsd: 0.5 }), row("dear", { spentUsd: 12 })], {
      sort: "cost",
      dir: "asc",
    });
    expect(html.indexOf("cheap-spec")).toBeLessThan(html.indexOf("dear-spec"));
  });

  test("sorting by spec ascending is alphabetical", () => {
    const html = page([row("zz"), row("aa")], { sort: "spec", dir: "asc" });
    expect(html.indexOf("aa-spec")).toBeLessThan(html.indexOf("zz-spec"));
  });

  // Spec folders lead with a number, and the first three-digit one
  // (100, on 2026-08-18) sorted BEFORE 81 as text. The number is what a
  // person reads the column by, so it is what the column sorts by.
  test("sorting by spec orders by the leading number, not by text", () => {
    const html = page([row("103"), row("81"), row("9"), row("104")], { sort: "spec", dir: "asc" });
    const at = (n: string) => html.indexOf(`${n}-spec"`);
    expect(at("9")).toBeLessThan(at("81"));
    expect(at("81")).toBeLessThan(at("103"));
    expect(at("103")).toBeLessThan(at("104"));
  });

  test("a column header is a link that keeps the filter you are already in", () => {
    const html = page([row("a", { state: "running" })], { state: "active" });
    expect(html).toContain('href="/?state=active&amp;sort=cost"');
  });

  test("the sorted column says which way it is going", () => {
    const html = page([row("a")], { sort: "cost" });
    expect(html).toMatch(/aria-sort="descending"/);
  });

  // The direction was a text glyph (▴/▾) glued to the label: faint, and
  // no larger than the letters. It is an SVG chevron now, turned by a
  // class, and the header link is a control with a hover flat.
  test("the sort direction is a chevron, not a glyph", () => {
    const desc = page([row("a")], { sort: "cost" });
    expect(desc).toMatch(
      /<th class="[^"]*" data-col="cost" aria-sort="descending"><a class="sortlink on"[^>]*><span class="u-usd">Cost<\/span>/,
    );
    expect(desc).not.toContain("▾");
    const asc = page([row("a")], { sort: "cost", dir: "asc" });
    expect(asc).toMatch(/<a class="sortlink on asc"[^>]*><span class="u-usd">Cost<\/span>/);
    expect(asc).not.toContain("▴");
    // An unsorted column carries the chevron too (faint in CSS), pointing
    // the way its first click will sort: Started defaults to descending.
    expect(desc).toMatch(/<a class="sortlink"[^>]*>Started<svg/);
    // …and State to ascending, so its chevron is already turned.
    expect(desc).toMatch(/<a class="sortlink asc"[^>]*>State<svg/);
  });

  test("a filter that matches nothing says so instead of showing a bare table", () => {
    const html = page([row("a")], { state: "active" });
    // "spec", not "job": the table has been one line per spec since
    // spec 86, and since spec 90 it lists specs that have no job at all.
    expect(html).toContain("No spec matches");
  });

  test("the list is capped, and says how many it left out", () => {
    const html = page(Array.from({ length: 29 }, (_, i) => row(`j${i}`)), { sort: "started" });
    expect(html).toContain("j0-spec");
    expect(html).toContain("j24-spec");
    expect(html).not.toContain("j25-spec");
    expect(html).toContain("4 older");
  });

  test("the partial refresh carries the controls too, so the filter survives a tick", async () => {
    const { base } = start({ queueToken: TOKEN });
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-aide-token": TOKEN, accept: "application/json" },
      body: JSON.stringify(JOB),
    });
    const rows = await (
      await fetch(`${base}/?rows=1&state=active`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(rows).toContain('data-filter="state"');
    expect(rows).toMatch(/aria-current="true"[^>]*>Active/);
  });
});

// Spec 86: the list is one line per SPEC, so filtering and sorting are
// questions about specs — "which spec has something running?" — not
// about the individual jobs a spec happens to have been split into.
describe("filtering and sorting work on specs, not jobs", () => {
  const job = (id: string, spec: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: spec,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T00:00:00Z",
    ...extra,
  });

  // `open` names the specs whose phase lines are drawn: this block
  // asserts that a filtered spec keeps every job it has had, and those
  // are read off the lines an open row draws.
  const page = (
    rows: QueueRowView[],
    filter?: QueuePageOptions["filter"],
    targets: QueueTarget[] = [],
  ) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets,
      filter: { open: "aide/aa-spec", ...filter },
    });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });


  test("a spec with one job in flight is active, one with only finished jobs is not (criterion 8)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
        job("a2", "aa-spec", {
          state: "running",
          steps: ["implement"],
          startedAt: "2026-08-16T11:00:00Z",
        }),
        job("b1", "bb-spec", { state: "done" }),
      ],
      { state: "active" },
    );
    expect(html).toContain("aa-spec");
    expect(html).not.toContain("bb-spec");
    // Its finished job comes along with it — the spec is one line, and
    // that line carries every phase it has had, filter or no filter.
    expect(html.match(/<tr class="spechead/g)).toHaveLength(1);
    expect(html).toContain('href="/specs/a1"');
    expect(html).toContain('href="/specs/a2"');
  });

  test("the filter tabs count specs, not jobs (criterion 9)", () => {
    const html = page([
      job("a1", "aa-spec", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
      job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      job("b1", "bb-spec", { state: "running" }),
    ]);
    expect(html).toMatch(/>All · 2</);
    expect(html).toMatch(/>Active · 1</);
    expect(html).toMatch(/>Done · 1</);
  });

  test("sorting by cost uses the spec's total, not one job's (criterion 10)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { spentUsd: 2.5 }),
        job("a2", "aa-spec", { spentUsd: 2.5 }),
        // Dearer than either aa job on its own, cheaper than the two together.
        job("b1", "bb-spec", { spentUsd: 4 }),
      ],
      { sort: "cost" },
    );
    expect(html.indexOf("aa-spec")).toBeLessThan(html.indexOf("bb-spec"));
    expect(html).toContain("$5.00");
  });

  test("the cap counts specs, and says how many specs it left out (criterion 11)", () => {
    const rows = Array.from({ length: 26 }, (_, i) => [
      job(`x${i}`, `s${String(i).padStart(2, "0")}-spec`, {
        startedAt: `2026-08-16T${String(i % 24).padStart(2, "0")}:00:00Z`,
      }),
      job(`y${i}`, `s${String(i).padStart(2, "0")}-spec`, {
        startedAt: `2026-08-16T${String(i % 24).padStart(2, "0")}:30:00Z`,
      }),
    ]).flat();
    const html = page(rows, { sort: "spec", dir: "asc" });
    expect(html).toContain("s00-spec");
    expect(html).toContain("s24-spec");
    expect(html).not.toContain("s25-spec");
    expect(html).toContain("1 older");
  });

  // Every spec is ONE line, so its place in the order is the group's —
  // it can no longer have one job near the top and another near the
  // bottom of the same list.
  const specOrder = (html: string) =>
    [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map((m) => m[1]);

  // Spec 199: the group's place is its spec's CREATION date. `aa-spec`
  // has the newest run of the three jobs here and is still second,
  // because it was made first.
  test("sorting by started uses the spec's creation date, not its jobs (criterion 13)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T08:00:00Z" }),
        job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T12:00:00Z" }),
        job("b1", "bb-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      ],
      { sort: "started" },
      [
        target("aa-spec", { createdAt: "2026-08-01T09:00:00Z" }),
        target("bb-spec", { createdAt: "2026-08-05T09:00:00Z" }),
      ],
    );
    expect(specOrder(html)).toEqual(["bb-spec", "aa-spec"]);
  });

  test("sorting by state uses the spec's representative state (criterion 13)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T08:00:00Z" }),
        job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T12:00:00Z" }),
        job("b1", "bb-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      ],
      { sort: "state" },
    );
    expect(specOrder(html)).toEqual(["bb-spec", "aa-spec"]);
  });
});
// --- spec 199: time becomes something worth reading -------------------------
//
// A phase says how long it TOOK. Nothing stores a per-step duration —
// a job has one `startedAt` however many steps it ran — so a step's
// own span is sliced out of the boundaries that do exist: the previous
// step's end, or the job's own start for the first one. Getting that
// wrong by reaching for the job's whole span instead is the one
// mistake this block exists to catch.
describe("a phase says how long it took", () => {
  const NOW = "2026-08-16T12:00:00Z";

  const job = (id: string, spec: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: spec,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T08:00:00Z",
    ...extra,
  });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // `renderQueueRows`, not `renderQueuePage`: the page reads the clock
  // itself and takes no `now`, and every figure in this block is
  // measured against one.
  const page = (rows: QueueRowView[], targets: QueueTarget[] = [], spec = "aa-spec") =>
    renderQueueRows(
      rows,
      { runnerAvailable: true, targets, filter: { open: `aide/${spec}` } },
      Date.parse(NOW),
    );

  /** One phase line's Started cell — which since spec 199 holds that
   *  phase's own duration, not when it began. */
  const phaseCell = (html: string, step: string): string =>
    html
      .match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  /** The spec header row's own Started cell. */
  const headCell = (html: string, folder: string): string =>
    html
      .match(new RegExp(`<tr class="spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  test("a finished single-step phase shows its own span (criterion 3)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze"],
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:04:12Z" }],
      }),
    ]);
    expect(phaseCell(html, "analyze")).toContain("4m12s");
  });

  // The trap: a job that ran two steps has ONE `startedAt`, and the
  // whole job's span belongs to neither step. The second step's own
  // duration runs from where the first one ended.
  test("a two-step job's second phase shows its own slice, not the job's span (criterion 7)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze", "implement"],
        stepIndex: 1,
        startedAt: "2026-08-16T09:00:00Z",
        results: [
          { step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:10:00Z" },
          { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:40:00Z" },
        ],
      }),
    ]);
    expect(phaseCell(html, "analyze")).toContain("10m00s");
    expect(phaseCell(html, "implement")).toContain("30m00s");
    // 40 minutes is the whole job — the answer a reach for
    // `finishedAt - startedAt` would have given.
    expect(phaseCell(html, "implement")).not.toContain("40m");
  });

  test("a phase nobody has run shows nothing at all", () => {
    const html = page([
      job("a1", "aa-spec", {
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:04:12Z" }],
      }),
    ]);
    expect(phaseCell(html, "archive")).toBe("");
  });

  // A running phase carries the instant it began, so the browser can
  // count up from it without waiting for the server to redraw
  // (criterion 4). The server still writes a readable figure into the
  // cell, so the page says something with script switched off.
  test("a running phase carries its start for the page's own clock (criterion 4)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze", "implement"],
        stepIndex: 1,
        state: "running",
        startedAt: "2026-08-16T11:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T11:30:00Z" }],
      }),
    ]);
    const cell = phaseCell(html, "implement");
    expect(cell).toContain('data-elapsed="2026-08-16T11:30:00Z"');
    expect(cell).toContain("30m00s");
  });

  test("a running FIRST step counts from the job's own start (criterion 4)", () => {
    const html = page([
      job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T11:45:00Z" }),
    ]);
    expect(phaseCell(html, "analyze")).toContain('data-elapsed="2026-08-16T11:45:00Z"');
    expect(phaseCell(html, "analyze")).toContain("15m00s");
  });

  // The work, not the calendar. These two jobs are three days apart and
  // the spec took twenty minutes (criteria 5 and 6).
  test("a finished spec's total is the sum of its phases, not the calendar span", () => {
    const html = page(
      [
        job("a1", "aa-spec", {
          steps: ["analyze"],
          startedAt: "2026-08-13T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-13T09:05:00Z" }],
        }),
        job("a2", "aa-spec", {
          steps: ["implement", "archive"],
          stepIndex: 1,
          startedAt: "2026-08-16T09:00:00Z",
          results: [
            { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:10:00Z" },
            { step: "archive", ok: true, costUsd: 1, at: "2026-08-16T09:15:00Z" },
          ],
        }),
      ],
      [target("aa-spec", { createdAt: "2026-08-13T08:00:00Z", done: ["analyze", "implement", "archive"] })],
    );
    // 5 + 10 + 5 minutes of work; three days of waiting in between.
    // The total is the work. (The date beside it still reads "3 d ago"
    // — that is when the spec was made, and it is the other half of
    // this cell.)
    const total = headCell(html, "aa-spec").match(/data-total="1"[^>]*>([^<]+)</)?.[1];
    expect(total).toBe("20m00s");
    // And it is exactly what the phase lines add up to.
    expect(phaseCell(html, "analyze")).toContain("5m00s");
    expect(phaseCell(html, "implement")).toContain("10m00s");
    expect(phaseCell(html, "archive")).toContain("5m00s");
  });

  test("a spec with a phase still ahead of it shows no total", () => {
    const html = page(
      [
        job("a1", "aa-spec", {
          startedAt: "2026-08-16T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:05:00Z" }],
        }),
      ],
      [target("aa-spec", { createdAt: "2026-08-13T08:00:00Z", done: ["analyze"] })],
    );
    expect(headCell(html, "aa-spec")).not.toContain("data-total");
  });

  // The header row's own cell is the spec's date, and it does not move
  // because a phase ran.
  test("the header row shows the spec's creation date, whatever its jobs did", () => {
    const html = page(
      [job("a1", "aa-spec", { startedAt: "2026-08-16T11:59:00Z" })],
      [target("aa-spec", { createdAt: "2026-06-01T09:00:00Z" })],
    );
    expect(headCell(html, "aa-spec")).toContain('title="2026-06-01T09:00:00Z"');
  });

  test("a spec git could not date shows a dash rather than a job's time", () => {
    const html = page(
      [job("a1", "aa-spec", { startedAt: "2026-08-16T11:59:00Z" })],
      [target("aa-spec")],
    );
    expect(headCell(html, "aa-spec")).toContain("–");
    expect(headCell(html, "aa-spec")).not.toContain("2026-08-16T11:59:00Z");
  });
});

// Spec 207: the summing the spec list has always done, lifted out of
// the render so the archive-time write calls the SAME function. The
// figure stored in `4-status.md` and the figure the list drew cannot
// drift apart if there is only one of them.
//
// Called directly rather than through a page: what is under test is the
// math and where `done` comes from, and a route test proves neither on
// its own.
describe("computeSpecTotalDurationMs (spec 207)", () => {
  const row = (id: string, extra: Partial<QueueRowView>): QueueRowView => ({
    id,
    project: "aide",
    specFolder: "aa-spec",
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-13T08:00:00Z",
    ...extra,
  });

  /** The same three jobs the list's own "sum, not span" test uses: five
   *  minutes of analyze, ten of implement, five of archive, three days
   *  apart. */
  const rows = (): QueueRowView[] => [
    row("a1", {
      steps: ["analyze"],
      startedAt: "2026-08-13T09:00:00Z",
      results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-13T09:05:00Z" }],
    }),
    row("a2", {
      steps: ["implement", "archive"],
      stepIndex: 1,
      startedAt: "2026-08-16T09:00:00Z",
      results: [
        { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:10:00Z" },
        { step: "archive", ok: true, costUsd: 1, at: "2026-08-16T09:15:00Z" },
      ],
    }),
  ];

  const ALL_DONE = ["create", "analyze", "implement", "archive"];

  test("adds the phases up, and answers in milliseconds", () => {
    expect(computeSpecTotalDurationMs(rows(), ALL_DONE)).toBe(20 * 60 * 1000);
  });

  // The whole reason `done` is a PARAMETER. These rows' own results say
  // analyze finished — and `withFreshness` takes analyze back out of
  // `done` when the description was committed after the last analyze
  // ran, which is exactly when the live list shows no total at all. A
  // function that re-derived `done` from the results would store a
  // figure the list itself would not have shown.
  test("`done` is the caller's, never re-derived from the job results", () => {
    expect(computeSpecTotalDurationMs(rows(), ["create", "implement", "archive"])).toBeUndefined();
  });

  test("a phase still ahead of the spec is no total yet", () => {
    expect(computeSpecTotalDurationMs(rows(), ["create", "analyze"])).toBeUndefined();
  });

  test("a spec nothing has ever run for measures nothing", () => {
    expect(computeSpecTotalDurationMs([], ALL_DONE)).toBeUndefined();
  });

  // The figure the list draws and the figure this returns are the same
  // number, because they are the same call. Read off the rendered page
  // as a label, which is all the page has.
  test("is the figure the spec list draws for the same jobs", () => {
    const html = renderQueueRows(
      rows(),
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "aa-spec", createdAt: "2026-08-13T08:00:00Z", done: ALL_DONE }],
        filter: { open: "aide/aa-spec" },
      },
      Date.parse("2026-08-16T12:00:00Z"),
    );
    const drawn = html
      .match(/<tr class="spechead[^"]*"[^>]*data-folder="aa-spec">.*?<\/tr>/)?.[0]
      ?.match(/data-total="1"[^>]*>([^<]+)</)?.[1];
    expect(drawn).toBe("20m00s");
  });
});

// Spec 83 let a job name other repos a run would also watch, commit and
// push, and they reached the runner as --extra-project-dir. Both went
// when the tick box that named them turned out never to have been used.
// What a run touches is the project and its specs root, and nothing the
// argv can add.
describe("a run reaches its own project and no other", () => {
  test("no --extra-project-dir is ever built, whatever the job carries", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const job = {
      project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"],
      budgetUsd: 15, timeoutSec: 2700, permissionMode: {}, model: {},
      // A job mirrored before the removal still has the key.
      extraProjects: ["aide-dashboard"],
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(argv).not.toContain("--extra-project-dir");
    expect(argv).not.toContain("/home/dev/aide-dashboard");
    expect(argv[argv.indexOf("--project-dir") + 1]).toBe("/home/dev/aide");
  });
});

// --- spec 110: what a new spec builds on --------------------------------------

describe("a chosen dependency reaches the runner and the page", () => {
  const createJob = (dependsOn?: string[]) =>
    ({
      project: "aide", specFolder: "new-abcd1234", steps: ["create"],
      budgetUsd: 15, timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      ...(dependsOn ? { createDependsOn: dependsOn } : {}),
    }) as unknown as Parameters<typeof import("../src/serve.ts").runnerArgv>[0];

  const argvFor = async (dependsOn?: string[]) => {
    const { runnerArgv } = await import("../src/serve.ts");
    return runnerArgv(createJob(dependsOn), "create", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
  };

  test("every chosen folder goes over as one --depends-on value", async () => {
    const argv = await argvFor(["92-a-spec-can-depend", "97-freshness"]);
    expect(argv).toContain("--depends-on");
    expect(argv[argv.indexOf("--depends-on") + 1]).toBe("92-a-spec-can-depend,97-freshness");
    // The two fields it sits beside are untouched.
    expect(argv[argv.indexOf("--title") + 1]).toBe("A new spec");
  });

  test("a create that names none passes no such flag", async () => {
    expect(await argvFor()).not.toContain("--depends-on");
    expect(await argvFor([])).not.toContain("--depends-on");
  });

  test("one ticked chip arrives as a list, not a bare string", async () => {
    const { base } = start({ queueToken: TOKEN, queueProjects: ["aide"] });
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        project: "aide",
        title: "A new spec",
        description: "Do the thing",
        dependsOn: "81-queue-and-runner",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { createDependsOn: string[] } };
    expect(body.job.createDependsOn).toEqual(["81-queue-and-runner"]);
  });
});

describe("the New-spec form offers what the spec may build on (criterion 7)", () => {
  // On its own page since spec 121 — the chips, their order and their
  // scoping are unchanged, only the page that draws them.
  const page = (targets: NewSpecPageOptions["targets"]) =>
    renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-08-16T00:00:00Z", {
      targets,
      createProjects: ["aide", "aide-dashboard"],
    });
  const form = (html: string): string => html.slice(html.indexOf('action="/api/queue/create"'));

  const TARGETS = [
    { project: "aide", specFolder: "09-ninth" },
    { project: "aide", specFolder: "92-a-spec-can-depend" },
    { project: "aide-dashboard", specFolder: "01-first" },
  ];

  test("one chip per active spec, each saying which project it belongs to", () => {
    const html = form(page(TARGETS));
    expect(html).toContain('name="dependsOn"');
    expect(html).toContain('value="92-a-spec-can-depend"');
    expect(html).toContain('value="01-first"');
    // The chip's own project, so the browser can scope the list to
    // whichever one the reader picks.
    expect(html).toMatch(/data-project="aide-dashboard"[^]*?value="01-first"/);
  });

  test("newest first — the number is the order a reader thinks in", () => {
    const html = form(page(TARGETS));
    expect(html.indexOf('value="92-a-spec-can-depend"')).toBeLessThan(html.indexOf('value="09-ninth"'));
  });

  test("none ticked by default, and no field at all when there is nothing to depend on", () => {
    const html = form(page(TARGETS));
    const chips = html.slice(html.indexOf('name="dependsOn"'));
    expect(chips.slice(0, 200)).not.toContain("checked");
    expect(form(page([]))).not.toContain('name="dependsOn"');
  });
});

describe("a spec's row says what it depends on (criterion 12)", () => {
  const row = (dependsOn: string[]) =>
    specHead(
      renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "109-expanded-row", title: "Expanded row", dependsOn }],
      }),
      "109-expanded-row",
    );

  // By NUMBER since 2026-08-21. It used to name the whole folder, to
  // match `aide-run-spec`'s dependency refusal word for word; the folder
  // name made the line longer than the row it sits in, and a number is
  // what a reader recognises and is unambiguous — a spec number is never
  // reused. A dependency written as a bare number already reads the same.
  test("named by number, however the dependency itself was written", () => {
    expect(row(["105-busy-row"])).toContain("depends on: 105");
    expect(row(["105-busy-row", "92-a-spec-can-depend"])).toContain("depends on: 105, 92");
    expect(row(["105"])).toContain("depends on: 105");
    // Anything that does not open with a number is shown whole rather
    // than silently truncated.
    expect(row(["a-named-thing"])).toContain("depends on: a-named-thing");
  });

  test("a spec that names none reads exactly as it does today", () => {
    expect(row([])).not.toContain("depends on");
  });
});
// The row asked which other repos a job would touch, with a tick box
// per project. Box, field and runner flag are all gone: no job the
// queue ever held had named one.


// --- spec 89: merging a spec's branches from the page ------------------------

// Spec 149: the Merge button is gone, and this whole block with it. What it
// covered — the per-repo merge, the plan-before-code order, the install
// afterwards, the conflict that offers a resolve — is what a step's own
// landing does now, and is covered in "every step lands its own work" below.

// --- Spec 91, criterion 26: how many at once -------------------------------
// The slot count is a number, and a number that turns out wrong should
// cost a config edit and a restart, not a release (`queue.ts:325-327`).
describe("the queue config decides how many run at once", () => {
  test("a number in 1-4 is taken; anything else falls back to two", () => {
    expect(parseQueueConcurrency(3)).toBe(3);
    expect(parseQueueConcurrency(1)).toBe(1);
    expect(parseQueueConcurrency(4)).toBe(4);
    // FALLS BACK, does not clamp: `concurrency: 9` would otherwise have
    // to be both 4 and 2 depending on which rule you read.
    expect(parseQueueConcurrency(9)).toBe(2);
    expect(parseQueueConcurrency(0)).toBe(2);
    expect(parseQueueConcurrency(-1)).toBe(2);
    expect(parseQueueConcurrency(2.5)).toBe(2);
    expect(parseQueueConcurrency("3")).toBe(2);
    expect(parseQueueConcurrency(undefined)).toBe(2);
  });

  test("with concurrency 3, three jobs for three specs really do run at once", async () => {
    // Not a unit test of the option: this starts three real runner
    // processes through the server's own spawn path, because "the number
    // reaches the runner" is not the same claim as "three run".
    const own = mkdtempSync(join(tmpdir(), "aide-concurrency-"));
    ownDirs.push(own);
    const go = join(own, "go");
    const fakeRunner = join(own, "fake-run-spec");
    writeFileSync(fakeRunner, `#!/bin/sh\nwhile [ ! -f ${go} ]; do sleep 0.05; done\n`, { mode: 0o755 });
    const specs = ["82-second", "83-third"];
    const { base } = start({
      queueToken: TOKEN,
      queueRunnerBin: fakeRunner,
      queueResultDir: join(own, "jobs"),
      queueConcurrency: 3,
    }, [], specs);
    try {
      for (const specFolder of ["81-queue-and-runner", ...specs]) {
        const res = await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-aide-token": TOKEN },
          body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
        });
        expect(res.status).toBe(200);
      }
      // The runner ticks on a 2s timer.
      const deadline = Date.now() + 15000;
      let running: unknown[] = [];
      while (Date.now() < deadline) {
        const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
        const body = (await res.json()) as { jobs: { state: string }[] };
        running = body.jobs.filter((j) => j.state === "running");
        if (running.length >= 3) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(running.length).toBe(3);
    } finally {
      writeFileSync(go, "");
    }
  }, 30000);
});

// --- spec 96: what a merge does, and in what order ---------------------------

// --- spec 93: making a spec from the page ------------------------------------

// Every spec that exists is a row here and can be started from its own
// line. A spec that does not exist yet has no row, and until now the only
// way to make one was `/aide-create` in a terminal, then a push, then a
// pull on the serving host. This is the third way in: a form, a job like
// any other, and — because a spec stays invisible to the list until its
// branch lands on the default branch — a landing step that merges through
// the very same function the Merge button already uses.
describe("POST /api/queue/create (spec 93)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const CREATE = { project: "aide", title: "A new spec", description: "Do the thing" };

  test("a create request is accepted and queued as a create job", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(CREATE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; job: { steps: string[]; specFolder: string } };
    expect(body.ok).toBe(true);
    expect(body.job.steps).toEqual(["create"]);
    expect(body.job.specFolder).toMatch(/^new-[0-9a-f]{8}$/);
  });

  test("a project that is allowlisted but has never had a spec is still accepted", async () => {
    // `resolveProject` answers "not found" for such a project — the gap
    // that makes a project's FIRST spec uncreatable today.
    const { base } = start({ queueToken: TOKEN, queueProjects: ["aide", "brandnew"] });
    const ok = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ ...CREATE, project: "brandnew" }),
    });
    expect(ok.status).toBe(200);
    // ...while the ORDINARY route still refuses it: the widening is for
    // one endpoint, not for the queue.
    const refused = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "brandnew", specFolder: "01-first", steps: ["analyze"] }),
    });
    expect(refused.status).toBe(400);
  });

  test("a project outside the allowlist is refused, and so is a half-filled form", async () => {
    const { base } = start({ queueToken: TOKEN });
    for (const body of [
      { ...CREATE, project: "someone-elses" },
      { project: "aide", description: "Do the thing" },
      { project: "aide", title: "A new spec" },
    ]) {
      const res = await fetch(`${base}/api/queue/create`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  test("it is behind the same token as the rest of the queue, and POST only", async () => {
    const { base } = start({ queueToken: TOKEN });
    expect(
      (await fetch(`${base}/api/queue/create`, { method: "POST", body: JSON.stringify(CREATE) })).status,
    ).toBe(401);
    expect((await fetch(`${base}/api/queue/create`, { headers: AUTH })).status).toBe(405);
  });

  // Spec 100 criterion 7: the form posts here without an `accept:
  // application/json`, so the answer is a redirect rather than JSON.
  // Spec 121 split the two destinations: a success goes to the list,
  // where the new spec's row is; a refusal goes back to the page the
  // form is ON (`/new`), where the reader can read the reason and try
  // again — the same rule `/projects`' own forms follow.
  test("a form submit lands on /new when refused and / when accepted", async () => {
    const { base } = start({ queueToken: TOKEN });
    const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
    const refused = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ project: "someone-elses", title: "t", description: "d" }),
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")!.startsWith("/new?error=")).toBe(true);

    const ok = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams(CREATE),
    });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/");
  });

  test("the form offers every allowlisted project, spec or no spec", async () => {
    const { base } = start({ queueToken: TOKEN, queueProjects: ["aide", "brandnew"] });
    const html = await (await fetch(`${base}/new`, { headers: { "x-aide-token": TOKEN } })).text();
    const form = html.slice(html.indexOf('action="/api/queue/create"'));
    expect(form).toContain('value="brandnew"');
    expect(form).toContain('name="title"');
    expect(form).toContain('name="description"');
  });
});

// --- spec 121: GET /new -----------------------------------------------------
//
// The form left `/` for a page of its own. Served like `/` and
// `/projects` are — same guard, same one-time token handover — because
// it carries a real form and a real form needs a token checked per
// request.
describe("GET /new (spec 121)", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };

  test("it is behind the same token as the rest of the queue, and GET only", async () => {
    const { base } = start({ queueToken: TOKEN });
    expect((await fetch(`${base}/new`, { redirect: "manual" })).status).toBe(401);
    expect((await fetch(`${base}/new`, { method: "POST", ...auth })).status).toBe(405);
  });

  test("it carries the create form and nothing about the spec list", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/new`, { ...auth, redirect: "manual" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/api/queue/create"');
    expect(html).toContain('<a class="btn" href="/">Cancel</a>');
    // No rows, and so nothing for the five-second swap to reach for.
    expect(html).not.toContain('id="jobrows"');
  });

  test("the chips name every spec the new one may build on", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/new`, auth)).text();
    expect(html).toContain('value="81-queue-and-runner"');
  });

  test("with no project on the allowlist it says so instead of drawing an empty form", async () => {
    const { base } = start({ queueToken: TOKEN, queueProjects: [] });
    const html = await (await fetch(`${base}/new`, auth)).text();
    expect(html).not.toContain('action="/api/queue/create"');
    expect(html).toContain("No project on this machine");
  });

  test("a refusal carried back in the query string is shown on the page", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (
      await fetch(`${base}/new?error=${encodeURIComponent("no such project: nope")}`, auth)
    ).text();
    expect(html).toContain("no such project: nope");
  });

  test("the token handover works here too, the way it does on / and /projects", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/new?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("aide_token=");
  });
});

// A create step's work is on a branch, in a worktree, on the machine that
// ran it. The list reads the main checkout and nothing else, so the spec
// stays invisible until that branch is merged — which is why this one step
// lands itself instead of waiting for a button nobody was told to press.
describe("landing a created spec (spec 93)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPECS_REPO = "/repos/aide-specs";
  const BRANCH = "aide/new-abc123de";

  /** A git that answers per repo, like the merge route's own harness.
   *  `conflicting` names the roots whose merge fails. */
  function gitFor(conflicting: string[] = []) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  /** The result `aide-run-spec` writes for a create step that worked. */
  const CREATE_RESULT = {
    ok: true,
    exitCode: 0,
    costUsd: 0.4,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    specFolder: "94-a-new-spec",
    branchUrls: [{ root: SPECS_REPO, url: "https://example.test/aide-specs" }],
    repos: [],
  };

  /** A server whose runner spawns `/bin/true` and reads its results from a
   *  directory this suite owns — so a test can put the JSON there itself. */
  function serverWithRunner(
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Partial<ServerOptions> = {},
  ) {
    const results = mkdtempSync(join(tmpdir(), "aide-create-results-"));
    ownDirs.push(results);
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: git.run as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      ...extra,
    });
    return { base, dir, results };
  }

  async function createJob(base: string, title = "A new spec"): Promise<{ id: string; specFolder: string }> {
    const made = (await (
      await fetch(`${base}/api/queue/create`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", title, description: "Do the thing" }),
      })
    ).json()) as { job: { id: string; specFolder: string } };
    return made.job;
  }

  /** Wait for the runner's own 2-second tick to pick the result up and for
   *  the landing it triggers to finish. Polled, never slept blindly: what
   *  is under test is asynchronous by nature. */
  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 100; n++) {
      const res = await fetch(`${base}/api/queue/${id}`, { headers: AUTH });
      const body = (await res.json()) as { job: Record<string, unknown> };
      if (done(body.job)) return body.job;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("the job never settled");
  }

  test("a successful create step is merged into every repo it pushed to, and renamed", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    // The branch `aide-run-spec` REPORTED, never one re-derived from a
    // folder name that did not exist when the branch was made.
    const merges = git.calls.filter(
      (c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`),
    );
    expect(merges.length).toBeGreaterThan(0);
    expect(merges.every((c) => c.dir === SPECS_REPO)).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);

    const landedJob = await settle(base, job.id, () => true);
    expect(landedJob.error).toBeFalsy();
    expect(landedJob.landing).toBeFalsy();
  });

  // The landing races the runs that pull the same checkout: 111 and 112
  // were both stranded by a first-try index.lock loss. A transient
  // failure is retried; only a merge that keeps failing is reported.
  test("a landing that fails once and then succeeds lands on the retry", async () => {
    let failures = 1;
    const inner = gitFor([]);
    const git = {
      calls: inner.calls,
      run: (dir: string, args: string[]) => {
        if (args.join(" ").startsWith("merge -q --no-edit") && dir === SPECS_REPO && failures > 0) {
          failures -= 1;
          return Promise.resolve({ code: 1, stdout: "", stderr: "index.lock" });
        }
        return inner.run(dir, args);
      },
    };
    const { base, results } = serverWithRunner(git as never);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    const landed = await settle(base, job.id, (j) => j.specFolder !== job.specFolder || !!j.error);
    expect(landed.error).toBeFalsy();
    expect(landed.specFolder).not.toBe(job.specFolder);
  });

  test("a landing that fails keeps the provisional key and says which repo and why", async () => {
    const git = gitFor([SPECS_REPO]);
    const { base, results } = serverWithRunner(git);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(failed.specFolder).toBe(job.specFolder);
    expect(String(failed.error)).toContain(SPECS_REPO);
    expect(failed.landing).toBeFalsy();
    // Nothing half-merged is left for the next thing to trip over.
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args.join(" ") === "merge --abort")).toBe(true);
  });

  test("a landed spec is an ordinary row: analyze runnable, nothing left to merge", async () => {
    const git = gitFor();
    const { base, dir, results } = serverWithRunner(git);
    const job = await createJob(base);
    // The merge really does put the folder on disk, which is the whole
    // reason the landing step exists.
    mkdirSync(join(dir, "root", "aide", "specs", "94-a-new-spec"), { recursive: true });
    writeFileSync(
      join(dir, "root", "aide", "specs", "94-a-new-spec", "1-description.md"),
      "# A new spec - Description\n",
    );
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    const html = await (
      await fetch(`${base}/?${openQuery("aide/94-a-new-spec")}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    const row = specHead(html, "94-a-new-spec");
    expect(row).not.toBe("");
    const group = specControls(html, "94-a-new-spec");
    // Runnable from its own phase lines, like every other spec...
    expect(group).toContain('name="steps" value="analyze"');
    // ...and with nothing left to merge: the branch is landed, and
    // since spec 149 there is no control to merge it with either.
    expect(group).not.toContain("/merge");
    expect(group).not.toContain(">Merge</button>");
    expect(group).not.toContain("ready to merge");
  });

  // Spec 158, criterion 6. A create job's key is provisional until the
  // run reports the folder it actually made, and the job record is only
  // renamed AFTER every repo has been landed — so an event built from
  // `job.specFolder` would name a spec nobody can look up. It reads the
  // outcome the landing itself is about to write.
  test("the merge event for a create landing names the renamed folder, not the provisional key", async () => {
    const git = gitFor();
    const sink = mergeEventSink();
    const { base, results } = serverWithRunner(git, sink);
    const job = await createJob(base);
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(CREATE_RESULT));
    await settle(base, job.id, (j) => j.specFolder === "94-a-new-spec");

    expect(sink.posted.length).toBe(1);
    expect(sink.posted[0]).toMatchObject({
      project: "aide",
      specFolder: "94-a-new-spec",
      branch: BRANCH,
      repoRoot: SPECS_REPO,
      step: "create",
      jobId: job.id,
    });
    expect(sink.posted[0].specFolder).not.toBe(job.specFolder);
  });

  test("a create job that has not landed yet is still a row on the page", async () => {
    // `groupBySpec` drops any job whose spec is not a known target. A
    // create job's spec is unknown BY CONSTRUCTION until it lands, so
    // without an allowance the job running right now renders nothing.
    const { base } = start({ queueToken: TOKEN });
    const job = await createJob(base, "A brand new spec");
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain(job.specFolder);
    // Labelled by its title: the provisional key says nothing to anyone.
    expect(html).toContain("A brand new spec");
  });
});

// Spec 136: an archive run's whole diff is two markdown changes in the
// specs repo — the date stamped into 4-status.md and the folder moved
// into `archive/` — and, like every other step, it leaves them on a
// branch. The list reads the main checkout, so the spec stayed in the
// active list and the row asked to be merged: the step that ENDS a spec
// ended by handing back a task (133, archived twice for exactly this).
// So archive lands its own work, the way `create` has since spec 93 —
// the same helper, the same per-repo report, the same visible refusal
// when a merge genuinely cannot be made.
describe("landing an archived spec (spec 136)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPECS_REPO = "/repos/aide-specs";
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;

  /** A git that answers per repo. `conflicting` names the roots whose
   *  merge fails both ways; `needsRealMerge` names the ones where the
   *  base has moved on — ff-only refuses, a real merge commit works;
   *  `gone` names the ones where origin has no such branch left, which
   *  `ls-remote --exit-code` reports as code 2 (spec 153). */
  function gitFor({
    conflicting = [] as string[],
    needsRealMerge = [] as string[],
    gone = [] as string[],
  } = {}) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("ls-remote") && gone.includes(dir)) return { code: 2, stdout: "" };
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only")) {
        return { code: conflicting.includes(dir) || needsRealMerge.includes(dir) ? 1 : 0, stdout: "" };
      }
      if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  /** The result `aide-run-spec` writes for an archive step that moved the
   *  folder and pushed the specs repo. No `specFolder`: that field is
   *  create's, and an archive step reports none. */
  const ARCHIVE_RESULT = {
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    branchUrls: [{ root: SPECS_REPO, url: "https://example.test/aide-specs" }],
    repos: [],
  };

  function serverWithRunner(
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Partial<ServerOptions> = {},
  ) {
    const results = mkdtempSync(join(tmpdir(), "aide-archive-results-"));
    ownDirs.push(results);
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: git.run as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      ...extra,
    });
    return { base, dir, results };
  }

  /** Queue one step for the harness's own spec, straight through — no
   *  gate, so the run reaches `onStepDone` without a press. */
  async function runStep(base: string, step: string): Promise<{ id: string; specFolder: string }> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [step] }),
      })
    ).json()) as { job: { id: string; specFolder: string } };
    return made.job;
  }

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 100; n++) {
      const res = await fetch(`${base}/api/queue/${id}`, { headers: AUTH });
      const body = (await res.json()) as { job: Record<string, unknown> };
      if (done(body.job)) return body.job;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("the job never settled");
  }

  const merges = (calls: { dir: string; args: string[] }[]) =>
    calls.filter((c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`));

  // Criterion 1. This archive job is the FIRST the queue has ever run
  // for this spec, so `branchesFor()` — read synchronously inside the
  // same call stack, before the runner has written this step's own
  // record — would answer with nothing. The landing reads the outcome
  // in hand instead, which has no such timing to get wrong.
  test("a successful archive step is merged and pushed with no Merge press", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls).length).toBeGreaterThan(0);
    expect(merges(git.calls).every((c) => c.dir === SPECS_REPO)).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
    // Landed, so the row stops advertising a branch to merge.
    expect(landed.branchUrls).toEqual([]);
  });

  // Criterion 2. Main moves while a job runs — 124, 133 and five older
  // specs were each refused with "cannot fast-forward" for that alone.
  // A real merge commit is the answer, not a failure to report.
  test("a base that moved is a real merge commit, not a refusal", async () => {
    const git = gitFor({ needsRealMerge: [SPECS_REPO] });
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(git.calls.some((c) => c.args.join(" ").startsWith("merge -q --no-edit"))).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
    expect(git.calls.some((c) => c.args.join(" ") === "merge --abort")).toBe(false);
  });

  // Criterion 3. The fallback is not being removed: a merge that cannot
  // be made says which repo and why, keeps the branch on the row, and
  // leaves the spec where it was.
  test("a genuine conflict keeps the branch, names the repo, and reports it", async () => {
    const git = gitFor({ conflicting: [SPECS_REPO] });
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(String(failed.error)).toContain(SPECS_REPO);
    expect(String(failed.error)).toContain("conflict");
    expect(failed.landing).toBeFalsy();
    // Nothing half-merged is left behind, and the branch is still there
    // to press Merge (or resolve) against.
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args.join(" ") === "merge --abort")).toBe(true);
    expect(failed.branchUrls).toEqual([{ root: SPECS_REPO, url: "https://example.test/aide-specs" }]);
    // The spec is still in the active list, exactly as it was.
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(specHead(html, SPEC)).not.toBe("");
  });

  // Criterion 4. A run that pushed nothing has nothing to land. Silence
  // is the right answer — create says "no pushed branch to land it
  // from" because for create that IS the failure; for archive a HEAD
  // that never moved is an ordinary outcome.
  test("an archive step that pushed nothing is a no-op, not an error", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branch: undefined, branchUrls: [] }),
    );
    const done = await settle(base, job.id, (j) => j.state === "done");

    expect(done.error).toBeFalsy();
    expect(merges(git.calls)).toEqual([]);
  });

  // --- spec 153: a branch that is already gone is not a failed landing ------
  //
  // The archive landing looks back through the whole history of branches
  // this spec's steps pushed (`branchesFor`), because `implement` never
  // lands its own and archive is what finally does. Since spec 149 a
  // `resolve` step lands AND DELETES its own branch, so that history
  // names a branch that is provably gone by the time archive reaches it.
  // Job 15932abc (2026-08-21) was the first: `ok: true`, archived, and
  // an error on the row saying "there is nothing left to merge".
  test("a code branch already merged and deleted is nothing to land, not a failure", async () => {
    const CODE_REPO = "/repos/aide";
    const git = gitFor({ gone: [CODE_REPO] });
    const { base, results } = serverWithRunner(git, { queueProjectRoot: "/repos" });
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ...ARCHIVE_RESULT,
        branchUrls: [
          { root: SPECS_REPO, url: "https://example.test/aide-specs" },
          { root: CODE_REPO, url: "https://example.test/aide" },
        ],
      }),
    );
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
    // The specs repo in the same landing still merges and pushes.
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
    // And nothing was merged in the repo whose branch is gone.
    expect(merges(git.calls).some((c) => c.dir === CODE_REPO)).toBe(false);
  });

  // The guard against over-fixing: "gone" is excluded from the report,
  // not every refusal beside it.
  test("a gone branch beside a genuine conflict still reports the conflict", async () => {
    const CODE_REPO = "/repos/aide";
    const git = gitFor({ gone: [CODE_REPO], conflicting: [SPECS_REPO] });
    const { base, results } = serverWithRunner(git, { queueProjectRoot: "/repos" });
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ...ARCHIVE_RESULT,
        branchUrls: [
          { root: SPECS_REPO, url: "https://example.test/aide-specs" },
          { root: CODE_REPO, url: "https://example.test/aide" },
        ],
      }),
    );
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(String(failed.error)).toContain(SPECS_REPO);
    expect(String(failed.error)).toContain("conflict");
    // The gone repo contributes nothing to the sentence a person reads.
    expect(String(failed.error)).not.toContain("nothing left to merge");
    expect(failed.errorReason).toBe("conflict");
    // Two repos, each running the landing's three tries with a pause
    // between them, so this one is genuinely slower than the default.
  }, 20000);

  // Criterion 6. Nobody is watching an automatic landing to press the
  // button again, and this one races the runs that pull the same
  // checkout — 111 and 112 were both stranded by a first-try loss.
  test("a landing that loses the index.lock race once lands on the retry", async () => {
    let failures = 1;
    const inner = gitFor();
    const git = {
      calls: inner.calls,
      run: (dir: string, args: string[]) => {
        if (args.join(" ").startsWith("merge -q --ff-only") && dir === SPECS_REPO && failures > 0) {
          failures -= 1;
          return Promise.resolve({ code: 1, stdout: "", stderr: "index.lock" });
        }
        return inner.run(dir, args);
      },
    };
    const { base, results } = serverWithRunner(git as never);
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
  });

  // Criterion 7. Merged is not deployed, and the manual route runs the
  // project's install for exactly that reason — but an archive run
  // writes two markdown changes in the SPECS repo and moves no code, so
  // there is nothing on this machine to reinstall.
  test("landing an archive runs no install command", async () => {
    // A REAL directory for the specs repo, carrying an install command
    // of its own: a landing that reached for `installAfterMerge` at all
    // would find it and run it, which is what this test is here to
    // notice. `/repos/aide-specs` is a name to git and nothing else, so
    // against that path the question cannot be asked.
    const specsRepo = mkdtempSync(join(tmpdir(), "aide-specs-repo-"));
    ownDirs.push(specsRepo);
    const marker = join(specsRepo, "installed");
    mkdirSync(join(specsRepo, ".aide"), { recursive: true });
    writeFileSync(join(specsRepo, ".aide", "config"), `AIDE_INSTALL_CMD=/usr/bin/touch ${marker}\n`);

    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: [{ root: specsRepo, url: "https://example.test/s" }] }),
    );
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(git.calls.some((c) => c.dir === specsRepo && c.args[0] === "push")).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  // Criterion 8. A run that DECLINES to archive writes a reason into
  // 4-status.md and nothing else. That reason is read off disk in the
  // main checkout, so it too was invisible until someone merged — and
  // the page caches its scan for five seconds, so the landing has to
  // clear it or the very next request still shows the old answer.
  test("a held-back note is landed and shows on the row without a merge press", async () => {
    const git = gitFor();
    const { base, dir, results } = serverWithRunner(git);
    const specDir = join(dir, "root", "aide", "specs", SPEC);
    // The page is read once first, so the scan is cached WITHOUT the note.
    const before = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(before).not.toContain("archive held back");

    // What the merge brings into the main checkout.
    writeFileSync(
      join(specDir, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "\n## Archive held back\n\n- the implementation was reverted\n",
      ),
    );
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);
    expect(landed.error).toBeFalsy();

    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("archive held back — the implementation was reverted");
  });

  // Criterion 5, as spec 149 leaves it. `analyze` lands itself now too,
  // so the steps that still land nothing are `implement` — whose pushed
  // branch IS the place a person tests the code — and the two that
  // belong to no spec's branch at all.
  test("no other step lands itself — implement's branch stays open", async () => {
    const steps = ["implement", "explore", "manifest"];
    const checked = await Promise.all(
      steps.map(async (step) => {
        const git = gitFor();
        const { base, results } = serverWithRunner(git);
        const job = await runStep(base, step);
        writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
        const done = await settle(base, job.id, (j) => j.state === "done");
        return { step, done, merged: merges(git.calls).length };
      }),
    );
    for (const { step, done, merged } of checked) {
      expect(`${step}: ${merged}`).toBe(`${step}: 0`);
      expect(`${step}: ${!!done.landing}`).toBe(`${step}: false`);
      // The branch is still on the row, waiting for the Merge button.
      expect(`${step}: ${JSON.stringify(done.branchUrls)}`).toBe(
        `${step}: ${JSON.stringify(ARCHIVE_RESULT.branchUrls)}`,
      );
    }
  });
});

// --- spec 187: a stopped step keeps its work --------------------------------
//
// A step whose clock runs out still commits what it wrote — `aide-run-spec`'s
// commit loop runs on every path — and still pushes it, because the push is
// gated on the push mode and not on `ok`. Landing was the one thing gated on
// `ok`, so that work sat on a branch nothing on the page mentioned: spec 184
// stopped on 2026-08-22 with a complete analysis, and the only way to learn
// that was to check the branch out by hand.
//
// What lands is decided by what the run TOUCHED, never by which step it was:
// a run that moved a code root's HEAD is left alone, exactly as a failed run
// is. That way there is no second list of "which steps are safe" to keep in
// step with the first.
describe("landing a stopped step's specs-only work (spec 187)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPECS_REPO = "/repos/aide-specs";
  const CODE_REPO = "/repos/aide";
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;

  /** A git that answers per repo, as the landing suites above do. */
  function gitFor(conflicting: string[] = []) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  /** The result `aide-run-spec` writes for a step SIGTERMed at its own
   *  `--timeout-sec` deadline: not ok, no exit code of its own, and the
   *  branch it had already committed and pushed to. */
  const STOPPED_RESULT = {
    ok: false,
    exitCode: 143,
    costUsd: 0.6,
    costMeasured: true,
    terminalReason: "timeout",
    branch: BRANCH,
    branchUrls: [{ root: SPECS_REPO, url: "https://example.test/aide-specs" }],
    repos: [],
  };

  function serverWithRunner(
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Partial<ServerOptions> = {},
  ) {
    const results = mkdtempSync(join(tmpdir(), "aide-stopped-results-"));
    ownDirs.push(results);
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: git.run as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      queueProjectRoot: "/repos",
      ...extra,
    });
    return { base, dir, results };
  }

  async function runStep(base: string, step: string): Promise<{ id: string; specFolder: string }> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [step] }),
      })
    ).json()) as { job: { id: string; specFolder: string } };
    return made.job;
  }

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 100; n++) {
      const res = await fetch(`${base}/api/queue/${id}`, { headers: AUTH });
      const body = (await res.json()) as { job: Record<string, unknown> };
      if (done(body.job)) return body.job;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("the job never settled");
  }

  const mergesOf = (calls: { dir: string; args: string[] }[], branch = BRANCH) =>
    calls.filter((c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${branch}`));

  // Criterion 1. The work is on the branch already; the only thing that
  // kept it off the page was the `ok` gate in front of the landing.
  test("a stopped analyze step that pushed only the specs repo is merged", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "analyze");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(STOPPED_RESULT));
    const landed = await settle(base, job.id, (j) => j.state === "stopped" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(mergesOf(git.calls).length).toBeGreaterThan(0);
    expect(mergesOf(git.calls).every((c) => c.dir === SPECS_REPO)).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
    // Landed, so the row stops advertising a branch to compare.
    expect(landed.branchUrls).toEqual([]);
    // It still stopped: landing the work does not make the step a success.
    expect(landed.stopReason).toBe("timeout");
  });

  // Criterion 1's step-agnostic reach. `create` is not on any list here —
  // what decides is that nothing outside the specs repo moved. Its job row
  // keeps its provisional key (a stopped create reports no `specFolder`),
  // which is accepted: the folder itself reaches the list, which reads the
  // main checkout off disk.
  test("a stopped create step's specs-repo work is landed too", async () => {
    const CREATE_BRANCH = "aide/new-abc123de";
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const made = (await (
      await fetch(`${base}/api/queue/create`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", title: "A half-written spec", description: "Do the thing" }),
      })
    ).json()) as { job: { id: string; specFolder: string } };
    writeFileSync(
      join(results, `${made.job.id}.json`),
      JSON.stringify({ ...STOPPED_RESULT, branch: CREATE_BRANCH }),
    );
    const landed = await settle(base, made.job.id, (j) => j.state === "stopped" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(mergesOf(git.calls, CREATE_BRANCH).length).toBeGreaterThan(0);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(true);
  });

  // Criterion 2. The description's third requirement, and the reason the
  // check reads repos rather than step names: code stays on its branch,
  // where a person tests it, however the run ended.
  test("a stopped step that also pushed the project repo lands nothing", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "implement");
    const pushed = [
      { root: SPECS_REPO, url: "https://example.test/aide-specs" },
      { root: CODE_REPO, url: "https://example.test/aide" },
    ];
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify({ ...STOPPED_RESULT, branchUrls: pushed }));
    const stopped = await settle(base, job.id, (j) => j.state === "stopped");

    expect(stopped.landing).toBeFalsy();
    // Not "the code repo was skipped" — no repo in this outcome is merged,
    // the specs one included.
    expect(mergesOf(git.calls)).toEqual([]);
    expect(stopped.branchUrls).toEqual(pushed);
  });

  // The same, for a run whose ONLY branch is a code branch.
  test("a stopped step that pushed only the project repo lands nothing", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "implement");
    const pushed = [{ root: CODE_REPO, url: "https://example.test/aide" }];
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify({ ...STOPPED_RESULT, branchUrls: pushed }));
    const stopped = await settle(base, job.id, (j) => j.state === "stopped");

    expect(stopped.landing).toBeFalsy();
    expect(mergesOf(git.calls)).toEqual([]);
    expect(stopped.branchUrls).toEqual(pushed);
  });

  // Criterion 3. A run that pushed nothing has nothing to land, and
  // silence is the whole of the right answer — no error on the row.
  test("a stopped step that pushed nothing is a no-op, not an error", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(git);
    const job = await runStep(base, "analyze");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...STOPPED_RESULT, branch: undefined, branchUrls: [] }),
    );
    const stopped = await settle(base, job.id, (j) => j.state === "stopped");

    expect(stopped.error).toBeFalsy();
    expect(stopped.landing).toBeFalsy();
    expect(mergesOf(git.calls)).toEqual([]);
  });

  // Criterion 4. Scoped to the wall clock. A cost cap can stop a step
  // mid-sentence with no commit boundary of its own, and a CLI error is
  // not a stop at all — neither is landed.
  test("a stop for a reason other than the clock lands nothing", async () => {
    for (const reason of ["budget", "cli-error"]) {
      const git = gitFor();
      const { base, results } = serverWithRunner(git);
      const job = await runStep(base, "analyze");
      writeFileSync(
        join(results, `${job.id}.json`),
        JSON.stringify({ ...STOPPED_RESULT, terminalReason: reason }),
      );
      const ended = await settle(base, job.id, (j) => j.state === "stopped" || j.state === "failed");

      expect(`${reason}: ${mergesOf(git.calls).length}`).toBe(`${reason}: 0`);
      expect(`${reason}: ${!!ended.landing}`).toBe(`${reason}: false`);
      expect(`${reason}: ${JSON.stringify(ended.branchUrls)}`).toBe(
        `${reason}: ${JSON.stringify(STOPPED_RESULT.branchUrls)}`,
      );
    }
  });
});

// --- spec 149: merging happens inside the steps, never by hand --------------
//
// A queue job that ran analyze, implement and archive in one go ended
// with the spec archived and the code still on a branch, waiting for
// someone to press Merge; the same steps run one at a time piled
// "ready to merge" buttons on the row for the specs repo and one for
// the code. None of those buttons exist any more. Every step lands the work
// it produced, and `implement` is the one exception ON PURPOSE: its branch
// is where a person tests the code, by leaving `archive` unticked.
//
// `archive` is therefore the one step that sends CODE to a default branch —
// so it is the one landing that has to look past its own outcome (the code
// branch moved during implement, not during archive) and the one that has
// to install afterwards, exactly as the Merge button did.
describe("every step lands its own work (spec 149)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;

  /** A projects root this suite owns, so `projectDir("aide")` is a path
   *  the test can name — and can hang an `AIDE_INSTALL_CMD` off. The
   *  shared harness leaves `queueProjectRoot` unset, which resolves the
   *  project's checkout to a bare relative name. */
  function own(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    return dir;
  }

  /** A git that answers per repo. `conflicting` names the roots whose
   *  merge fails both ways. `slow` delays the ff-only merge, so two
   *  landings on one root can be caught overlapping.
   *
   *  `openOn` (spec 193) names the roots whose ORIGIN still has the
   *  spec branch, and a merge that succeeds in a root takes it out of
   *  that set — which is what `mergeBranchIntoDefault` really does, by
   *  deleting the branch on origin once it has landed. `lsRemoteCode`
   *  is what a root that cannot be asked answers: an unreachable host,
   *  not an empty list. */
  function gitFor({
    conflicting = [] as string[],
    slow = null as null | (() => Promise<void>),
    openOn = [] as string[],
    lsRemoteCode = 0,
  } = {}) {
    const calls: { dir: string; args: string[] }[] = [];
    const open = new Set(openOn);
    const merged = (dir: string): { code: number; stdout: string } => {
      if (conflicting.includes(dir)) return { code: 1, stdout: "" };
      open.delete(dir);
      return { code: 0, stdout: "" };
    };
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("ls-remote --heads origin refs/heads/aide/*")) {
        return {
          code: lsRemoteCode,
          stdout: lsRemoteCode === 0 && open.has(dir) ? `a3f9c21\trefs/heads/${BRANCH}\n` : "",
        };
      }
      if (a.startsWith("merge -q --ff-only")) {
        if (slow) await slow();
        return merged(dir);
      }
      if (a.startsWith("merge -q --no-edit")) return merged(dir);
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  /** A discoverable project root with a real directory for the project's
   *  own checkout, plus the specs repo the run pushes to.
   *
   *  `archiveSpec` is what the specs-root merge brings into the main
   *  checkout (spec 193): the folder move the archive run committed on
   *  its branch. Until it is called the spec is LIVE on disk, which is
   *  why an archive-landing test that never calls it steps straight
   *  past the archived filter and can assert nothing about it. */
  function repos(dir: string): {
    root: string;
    project: string;
    specs: string;
    archiveSpec: () => void;
  } {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    const specs = join(dir, "aide-specs");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(project, "specs", SPEC), { recursive: true });
    writeFileSync(join(project, "specs", SPEC, "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", SPEC, "4-status.md"), statusSaying(["create", "analyze"]));
    mkdirSync(specs, { recursive: true });
    return {
      root: projectsRoot,
      project,
      specs,
      archiveSpec: () => {
        mkdirSync(join(project, "specs", "archive"), { recursive: true });
        renameSync(join(project, "specs", SPEC), join(project, "specs", "archive", SPEC));
      },
    };
  }

  /** The install the project runs once its code has landed — a `touch`,
   *  so the test can ask whether it ran by asking the filesystem. */
  function installs(project: string): string {
    const marker = join(project, "installed");
    writeFileSync(join(project, ".aide", "config"), `AIDE_INSTALL_CMD=/usr/bin/touch ${marker}\n`);
    return marker;
  }

  function serverWith(
    dir: string,
    paths: { root: string },
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
    extra: Partial<ServerOptions> = {},
  ): { base: string } {
    const results = join(dir, "jobs");
    mkdirSync(results, { recursive: true });
    return harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        gitRun: git.run as never,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
        ...extra,
      },
    });
  }

  const resultDir = (dir: string) => join(dir, "jobs");

  async function runStep(base: string, step: string): Promise<{ id: string }> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [step] }),
      })
    ).json()) as { job: { id: string } };
    return made.job;
  }

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 100; n++) {
      const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
        job: Record<string, unknown>;
      };
      if (done(body.job)) return body.job;
      await Bun.sleep(50);
    }
    throw new Error("the job never settled");
  }

  const merges = (calls: { dir: string; args: string[] }[], root?: string) =>
    calls.filter(
      (c) =>
        c.args[0] === "merge" &&
        c.args.includes(`refs/remotes/origin/${BRANCH}`) &&
        (root === undefined || c.dir === root),
    );

  const result = (over: Record<string, unknown> = {}) => ({
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    repos: [],
    ...over,
  });

  /** Run one step to completion with the result `aide-run-spec` would
   *  have written for it, and hand back the job as the queue left it. */
  async function stepWithResult(
    base: string,
    dir: string,
    step: string,
    over: Record<string, unknown>,
    settled: (job: Record<string, unknown>) => boolean = (j) => j.state === "done" && !j.landing,
  ): Promise<Record<string, unknown>> {
    const job = await runStep(base, step);
    writeFileSync(join(resultDir(dir), `${job.id}.json`), JSON.stringify(result(over)));
    return settle(base, job.id, settled);
  }

  // Criteria 1 and 2. The argument that made `create` and `archive` land
  // themselves holds word for word here: analyze writes markdown in the
  // specs repo and nothing else, so there is no diff for a person to
  // weigh and nothing that reaches the serving host.
  test.each(["analyze"])(
    "a finished %s step lands its own branch, with no press and no HTTP request",
    async (step) => {
      const dir = own(`aide-149-${step}-`);
      const paths = repos(dir);
      const git = gitFor();
      const { base } = serverWith(dir, paths, git);

      const landed = await stepWithResult(base, dir, step, {
        branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
      });

      expect(landed.error).toBeFalsy();
      expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
      expect(git.calls.some((c) => c.dir === paths.specs && c.args[0] === "push")).toBe(true);
      // Landed, so the row stops advertising a branch at all.
      expect(landed.branchUrls).toEqual([]);
    },
  );

  // Criterion 3. The one step that deliberately does not land. The code
  // stays on `aide/<spec>`, which is where a person tests it — by
  // leaving `archive` unticked. The worktree is gone when the run ends,
  // so the branch on origin is what remains.
  test("a finished implement step merges nothing and leaves its branch open", async () => {
    const dir = own("aide-149-implement-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(dir, paths, git);
    const marker = installs(paths.project);

    const branchUrls = [
      { root: paths.project, url: "https://example.test/aide" },
      { root: paths.specs, url: "https://example.test/aide-specs" },
    ];
    const done = await stepWithResult(base, dir, "implement", { branchUrls }, (j) => j.state === "done");

    expect(merges(git.calls)).toEqual([]);
    expect(done.landing).toBeFalsy();
    expect(done.branchUrls).toEqual(branchUrls);
    expect(existsSync(marker)).toBe(false);
  });

  // Criterion 4. The one landing that sends CODE to a default branch —
  // and the reason it cannot read its own outcome alone. The code branch
  // moved during IMPLEMENT; archive's own run may touch the project
  // checkout without moving its HEAD at all, so the project root need
  // never appear in archive's `branchUrls`. `queue.branchesFor` is the
  // record that still has it.
  test("archive lands the code branch an earlier implement left, and installs it", async () => {
    const dir = own("aide-149-archive-code-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(dir, paths, git);
    const marker = installs(paths.project);

    // Implement first: it lands nothing, and its record is what carries
    // the project's branch forward.
    await stepWithResult(
      base,
      dir,
      "implement",
      {
        branchUrls: [
          { root: paths.project, url: "https://example.test/aide" },
          { root: paths.specs, url: "https://example.test/aide-specs" },
        ],
      },
      (j) => j.state === "done",
    );

    // Archive's own run reports the specs repo alone.
    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls, paths.project).length).toBeGreaterThan(0);
    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    // Merged is not deployed: for a tool that lives in `~/.local/bin`,
    // the default branch moving changes nothing on the machine until the
    // install runs. That is spec 92's bug, and the Merge button ran the
    // install for exactly this reason.
    for (let i = 0; i < 40 && !existsSync(marker); i++) await Bun.sleep(25);
    expect(existsSync(marker)).toBe(true);
  });

  // Criterion 5. A code merge that cannot be made stops the step: nothing
  // is left half-merged, the reason names the repo, and the spec stays in
  // the active list. `errorReason` is what makes the way out survive —
  // there is no browser attached to an automatic landing, so the one-shot
  // redirect the Merge button used cannot carry it.
  test("an archive landing that conflicts records errorReason and archives nothing", async () => {
    const dir = own("aide-149-archive-conflict-");
    const paths = repos(dir);
    // Plan first, code last: the specs merge lands the folder move, and
    // only then does the code merge conflict. So the spec IS archived on
    // disk by the time the row is asked for — which is the whole reason
    // the row needed spec 193 to survive at all.
    const git = gitFor({ conflicting: [paths.project], openOn: [paths.project] });
    const { base } = serverWith(dir, paths, git);
    const marker = installs(paths.project);

    await stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
      (j) => j.state === "done",
    );
    const archiving = await runStep(base, "archive");
    paths.archiveSpec();
    writeFileSync(
      join(resultDir(dir), `${archiving.id}.json`),
      JSON.stringify(result({ branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] })),
    );
    const failed = await settle(base, archiving.id, (j) => !!j.error);

    expect(String(failed.error)).toContain(paths.project);
    expect(String(failed.error)).toContain("conflict");
    expect(failed.errorReason).toBe("conflict");
    expect(failed.landing).toBeFalsy();
    // Nothing half-merged, and nothing deployed from a merge that never
    // happened.
    expect(git.calls.some((c) => c.dir === paths.project && c.args.join(" ") === "merge --abort")).toBe(true);
    expect(existsSync(marker)).toBe(false);
    // Still in the active list, with its branch, exactly as it was.
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(specHead(html, SPEC)).not.toBe("");
  }, 20000);

  // Criterion 6. A middle-of-the-workflow step lands what its OWN run
  // reports and nothing else; reading `branchesFor` history instead
  // would let a step that touched only the specs repo drag an
  // unarchived implement's code onto the default branch as a side
  // effect. (`resolve` was the step this was written for, until spec
  // 171 retired it, and `review-plan` was the other, until spec 181
  // folded it into analyze; the rule it proves belongs to
  // `landStepBranch`, which still lands `analyze`.)
  test("analyze lands the repos its own run reports, and installs a code root among them", async () => {
    const dir = own("aide-149-analyze-lands-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(dir, paths, git);
    const marker = installs(paths.project);

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.project, url: "https://example.test/aide" }],
    });

    expect(landed.error).toBeFalsy();
    expect(merges(git.calls, paths.project).length).toBeGreaterThan(0);
    expect(landed.branchUrls).toEqual([]);
    for (let i = 0; i < 40 && !existsSync(marker); i++) await Bun.sleep(25);
    expect(existsSync(marker)).toBe(true);
  });

  // The other half of criterion 6, and the whole of the risk this spec
  // accepted knowingly: a step that touched only the specs repo must
  // not reach back into the queue's history and land the code an
  // earlier implement left open.
  test("analyze does not land an unarchived implement's code branch", async () => {
    const dir = own("aide-149-analyze-scope-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(dir, paths, git);

    await stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
      (j) => j.state === "done",
    );
    await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(merges(git.calls, paths.project)).toEqual([]);
  });

  // Criterion 7, as spec 171 leaves it. The reason is still stored on
  // the job and still read from there on any later request — a landing
  // has no browser to redirect a query string to. What is gone is the
  // control it used to draw: `archive` resolves a conflict itself now,
  // so a conflict that reaches the page is one no press would settle.
  test("a stored conflict draws no control on a fresh request (spec 171)", async () => {
    const dir = own("aide-171-conflict-offer-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const { base } = serverWith(dir, paths, git);

    await stepWithResult(
      base,
      dir,
      "analyze",
      { branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] },
      (j) => !!j.error,
    );

    const url = `${base}/?${OPEN_81}`;
    const html = await (await fetch(url, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toContain("resolveform");
    expect(specControls(html, SPEC)).not.toContain('value="resolve"');
    // The failure itself is still on the row, and still names the repo
    // the reader has to go and look at.
    expect(specControls(html, SPEC)).not.toBe("");
  });

  // Criterion 8. Both routes are gone, not merely unreachable from the
  // page: the actions they offered are what this whole spec removes.
  test.each(["merge", "approve"])("POST /api/queue/<id>/%s is not a route any more", async (verb) => {
    const dir = own(`aide-149-route-${verb}-`);
    const paths = repos(dir);
    const { base } = serverWith(dir, paths, gitFor());
    const job = await runStep(base, "analyze");

    const res = await fetch(`${base}/api/queue/${job.id}/${verb}`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(404);
    // Cancel is untouched — it is the one thing on that route that was
    // never about merging.
    const cancel = await fetch(`${base}/api/queue/${job.id}/cancel`, { method: "POST", headers: AUTH });
    expect(cancel.status).toBe(200);
  });

  // Criterion 9. No form on the page could ever set a gate, and the
  // three jobs that ever had one were posted as JSON by hand. A request
  // that still names it is accepted and the field ignored, like every
  // other unknown key — and no job can reach the state it produced.
  test("a POST naming gateAfter is accepted, and the job runs straight through", async () => {
    const dir = own("aide-149-gate-");
    const paths = repos(dir);
    const { base } = serverWith(dir, paths, gitFor());
    const made = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({
        project: "aide",
        specFolder: SPEC,
        steps: ["analyze", "implement"],
        gateAfter: ["analyze"],
      }),
    });
    expect(made.status).toBe(200);
    const body = (await made.json()) as { job: Record<string, unknown> };
    expect("gateAfter" in body.job).toBe(false);
    expect(body.job.state).not.toBe("awaiting-approval");
  });

  // --- spec 158: a merge is an event claude-usage can see ---------------
  //
  // The dashboard merges in its own Bun process, so nothing writes a
  // transcript for claude-usage to read a merge out of. It has to say
  // what it did — for EVERY repo it lands, not only the code roots
  // `installAfterMerge` cares about, because the spec-markdown merges
  // an `analyze` makes are exactly the ones the ledger
  // is missing today.

  // Criterion 1. Every other test in this file is the other half of this
  // proof: none of them configures a URL, and none of them would issue a
  // request even with a live fetch in the harness.
  test("no url configured means no request, whatever lands", async () => {
    const dir = own("aide-158-inert-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink();
    const { base } = serverWith(dir, paths, git, { mergeEventFetch: sink.mergeEventFetch });

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted).toEqual([]);
  });

  // Criteria 2, 5 and 7 at once. The step name is threaded through from
  // the call site rather than stubbed — `archive` says "archive" — and
  // the specs repo is not a code root, so an event for it proves the
  // report is not gated the way the install is.
  test.each(["analyze", "archive"])(
    "a landed %s step reports the merge of a specs-only repo",
    async (step) => {
      const dir = own(`aide-158-${step}-`);
      const paths = repos(dir);
      const git = gitFor();
      const sink = mergeEventSink();
      const { base } = serverWith(dir, paths, git, sink);
      // A code root that is never landed here: an event for it would
      // mean the report followed the install's gate after all.
      installs(paths.project);

      const landed = await stepWithResult(base, dir, step, {
        branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
      });

      expect(landed.error).toBeFalsy();
      expect(sink.posted.length).toBe(1);
      expect(sink.posted[0]).toEqual({
        project: "aide",
        specFolder: SPEC,
        branch: BRANCH,
        repoRoot: paths.specs,
        step,
        jobId: landed.id,
        timestamp: expect.any(String),
      });
      const stamp = sink.posted[0].timestamp as string;
      expect(new Date(stamp).toISOString()).toBe(stamp);
    },
  );

  // Criterion 4. One run, two repos, two events — each naming its own
  // root. A single event per landing would leave the code merge, the
  // one that matters most, unreported whenever a specs merge preceded it.
  test("a landing that merges two repos reports both, each by its own root", async () => {
    const dir = own("aide-158-two-repos-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink();
    const { base } = serverWith(dir, paths, git, sink);

    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [
        { root: paths.project, url: "https://example.test/aide" },
        { root: paths.specs, url: "https://example.test/aide-specs" },
      ],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted.map((e) => e.repoRoot).sort()).toEqual([paths.project, paths.specs].sort());
    expect(sink.posted.every((e) => e.step === "archive" && e.branch === BRANCH)).toBe(true);
  });

  // Criterion 3. The same rule `installAfterMerge` already keeps: the
  // merge happened, so a report that cannot be delivered is noted beside
  // it and never turns a completed merge into a failed one.
  test("a report that throws leaves the landing successful", async () => {
    const dir = own("aide-158-report-fails-");
    const paths = repos(dir);
    const git = gitFor();
    const thrower = (async () => {
      throw new Error("claude-usage is down");
    }) as unknown as typeof fetch;
    const { base } = serverWith(dir, paths, git, {
      mergeEventUrl: "http://claude-usage.test/api/merge-event",
      mergeEventFetch: thrower,
    });

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(landed.branchUrls).toEqual([]);
  });

  // And the same for a sink that answers but refuses.
  test("a report the sink refuses leaves the landing successful", async () => {
    const dir = own("aide-158-report-refused-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink(() => new Response("no", { status: 500 }));
    const { base } = serverWith(dir, paths, git, sink);

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted.length).toBe(1);
  });

  // A merge that never happened is not an event. The ledger's whole
  // question is "was this merge reviewed?" — a refused merge reported as
  // one would be an answer about work that is not on the default branch.
  test("a landing that conflicts reports nothing for the repo it could not merge", async () => {
    const dir = own("aide-158-conflict-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const sink = mergeEventSink();
    const { base } = serverWith(dir, paths, git, sink);

    const failed = await stepWithResult(
      base,
      dir,
      "analyze",
      { branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] },
      (j) => !!j.error,
    );

    expect(String(failed.error)).toContain(paths.specs);
    expect(sink.posted).toEqual([]);
  }, 20000);

  // --- spec 193: a landing that failed is not a spec that is done ----------
  //
  // Three specs reached the archive with their code still on a branch,
  // and every row said done: the archive STEP succeeded, so the job
  // stayed `done`, and the landing after it wrote only a sentence
  // nothing was drawing. The queue's memory of its own pushes is not
  // the answer to "does this spec still have a branch open" — origin
  // is.
  describe("an archive landing asks origin whether anything stayed open", () => {
    /** Spec 146's shape: the implement was run BY HAND, so the queue
     *  holds no job carrying the project root and archive's own run
     *  reports the specs repo alone. Nothing in the merge loop ever
     *  mentions the code branch, and it is still on origin. */
    const onlyTheSpecsRepo = (paths: { specs: string }) => ({
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    // Criterion 2.
    test("a branch left on origin in a repo the loop never saw is a failed job", async () => {
      const dir = own("aide-193-unlanded-");
      const paths = repos(dir);
      const git = gitFor({ openOn: [paths.project] });
      const { base } = serverWith(dir, paths, git);

      const failed = await stepWithResult(
        base,
        dir,
        "archive",
        onlyTheSpecsRepo(paths),
        (j) => !!j.error,
      );

      expect(failed.state).toBe("failed");
      expect(failed.errorReason).toBe("unlanded");
      expect(String(failed.error)).toContain(paths.project);
      expect(String(failed.error)).toContain(BRANCH);
      // Spec 201: the state is half the sentence — the other half is
      // the move. The row's own button already offers it; the message
      // has to say so.
      expect(String(failed.error).toLowerCase()).toContain("run archive again");
    }, 20000);

    // Criterion 3. The happy path is the one this whole change must not
    // break: a landing that merged everything leaves no branch behind,
    // so origin agrees and the job stays exactly as it was.
    test("a landing that left nothing on origin stays done, with no error", async () => {
      const dir = own("aide-193-clean-");
      const paths = repos(dir);
      const git = gitFor({ openOn: [paths.project, paths.specs] });
      const { base } = serverWith(dir, paths, git);

      await stepWithResult(
        base,
        dir,
        "implement",
        { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }] },
        (j) => j.state === "done",
      );
      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      expect(landed.state).toBe("done");
      expect(landed.error).toBeFalsy();
      expect(landed.errorReason).toBeFalsy();
    });

    // Criterion 4. An unanswerable question is not evidence. Same
    // fixture as criterion 2 — the branch really is still open — with
    // an origin that cannot be reached.
    test("a question origin cannot answer invents no failure", async () => {
      const dir = own("aide-193-unanswerable-");
      const paths = repos(dir);
      const git = gitFor({ openOn: [paths.project], lsRemoteCode: 128 });
      const { base } = serverWith(dir, paths, git);

      const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

      expect(landed.state).toBe("done");
      expect(landed.error).toBeFalsy();
    });

    // Criterion 9. The verification is ARCHIVE's alone. An analyze runs
    // while implement's code branch is legitimately open, and the same
    // check there would call a healthy landing failed.
    test("an analyze landing is not asked, and stays done beside an open code branch", async () => {
      const dir = own("aide-193-analyze-");
      const paths = repos(dir);
      const git = gitFor({ openOn: [paths.project] });
      const { base } = serverWith(dir, paths, git);

      const landed = await stepWithResult(base, dir, "analyze", onlyTheSpecsRepo(paths));

      expect(landed.state).toBe("done");
      expect(landed.error).toBeFalsy();
      // The SWEEP, not `isMerged`'s per-branch question: that one runs
      // on every page load and says nothing about the landing.
      expect(git.calls.some((c) => c.args.includes("refs/heads/aide/*"))).toBe(false);
    });

    // Criterion 10. `complete()` may already have queued the job's NEXT
    // step by the time the landing's promise settles, and a landing
    // must not overwrite a job that has moved on.
    test("a failed landing does not overwrite a job whose next step is queued", async () => {
      const dir = own("aide-193-moved-on-");
      const paths = repos(dir);
      const git = gitFor({ conflicting: [paths.specs] });
      const { base } = serverWith(dir, paths, git);

      const made = (await (
        await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: AUTH,
          body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze", "implement"] }),
        })
      ).json()) as { job: { id: string } };
      writeFileSync(
        join(resultDir(dir), `${made.job.id}.json`),
        JSON.stringify(result(onlyTheSpecsRepo(paths))),
      );
      const after = await settle(base, made.job.id, (j) => !!j.error || j.state === "failed");

      // Queued for implement, with the analyze landing's refusal on the
      // row beside it — not stranded as a failed job.
      expect(after.state).toBe("queued");
      expect(String(after.error)).toContain(paths.specs);
    }, 20000);

    // Criterion 8. The way out. A re-run of `archive` needs no new step:
    // the runner hands archive the open merge, the skill resolves it,
    // and the landing that follows merges cleanly.
    describe("archive can be enqueued again for such a spec", () => {
      /** A server whose spec is ALREADY in `archive/` on disk — the
       *  state the three stranded specs are in — with `GET /` run once,
       *  because that is where the archived-with-an-open-branch set is
       *  refreshed. An un-refreshed set is empty, so the enqueue fails
       *  closed. */
      async function archivedServer(name: string, branchStillOpen: boolean) {
        const dir = own(name);
        const paths = repos(dir);
        paths.archiveSpec();
        const git = gitFor({ openOn: branchStillOpen ? [paths.project] : [] });
        const { base } = serverWith(dir, paths, git);
        await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } });
        return { base, paths };
      }

      const enqueue = (base: string) =>
        fetch(`${base}/api/queue`, {
          method: "POST",
          headers: AUTH,
          body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["archive"] }),
        });

      test("while its branch is still on origin", async () => {
        const { base } = await archivedServer("aide-193-rerun-open-", true);
        expect((await enqueue(base)).status).toBe(200);
      });

      test("and not once the branch is gone", async () => {
        const { base } = await archivedServer("aide-193-rerun-closed-", false);
        expect((await enqueue(base)).status).toBeGreaterThan(399);
      });

      // --- spec 198: the other way out ------------------------------------
      //
      // An archived spec can also be REOPENED, and unlike the re-run
      // above that does not depend on a branch being open — a spec whose
      // work has to be done again is one that finished cleanly, most of
      // the time. The two exceptions are kept apart in the resolver for
      // that reason: `specFolders` carries spec 193's open-branch
      // exception and admits every step, `archivedFolders` carries this
      // one and admits `reopen` alone.
      const enqueueReopen = (base: string, steps: string[] = ["reopen"]) =>
        fetch(`${base}/api/queue`, {
          method: "POST",
          headers: AUTH,
          body: JSON.stringify({ project: "aide", specFolder: SPEC, steps }),
        });

      test("reopen is accepted for an archived spec whose branch is gone", async () => {
        const { base } = await archivedServer("aide-198-reopen-closed-", false);
        expect((await enqueueReopen(base)).status).toBe(200);
      });

      test("and every other step still is not", async () => {
        const { base } = await archivedServer("aide-198-reopen-other-", false);
        const res = await enqueueReopen(base, ["implement"]);
        expect(res.status).toBeGreaterThan(399);
        expect(String((await res.json() as { error?: string }).error)).toContain("archived");
      });

      // A no-script form POST gets a redirect and nothing else, and the
      // specs list has no row for an archived spec to put the answer on.
      // The reader comes back to the page the button is on.
      test("a form press comes back to the spec's own page", async () => {
        const { base } = await archivedServer("aide-198-reopen-back-", false);
        const res = await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: { "x-aide-token": TOKEN, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ project: "aide", specFolder: SPEC, steps: "reopen" }),
          redirect: "manual",
        });
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.headers.get("location")).toContain(`/specs/aide/${SPEC}`);
      });
    });
  });
});

// Spec 207: a landed archive writes what the spec cost in time.
//
// The figure the spec list shows is worked out from the queue's own job
// records, and the queue keeps two hundred jobs. The archive holds
// ninety specs and grows, so a figure that is never written down is a
// figure almost every archived row will be missing. It is written the
// moment the archive branch has actually MERGED — not when the step
// reported success — because a landing that failed leaves a spec that
// is not archived.
describe("what a spec cost in time is written when its archive lands (spec 207)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;
  /** What `rev-parse --show-toplevel` answers. Faked git, so nothing
   *  runs there — it is the lock key and the directory the commit and
   *  the push are addressed to. */
  const REPO_ROOT = "/repos/aide";

  function own(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(d);
    return d;
  }

  /** The runner's own commit subjects for this spec, which is what
   *  decides `done` — `withFreshness` reads git, never the job results.
   *  Newest first, the way `git log` prints them. */
  const HISTORY = [
    `Run /aide-archive for ${SPEC} (headless)`,
    `Run /aide-implement for ${SPEC} (headless)`,
    `Run /aide-analyze for ${SPEC} (headless)`,
  ];

  /** A git that answers every question the landing AND the stamp's own
   *  save ask. The save is `saveSpecFile`, the same call the Edit page
   *  makes: pull-fast-forward, compare the file's last commit against
   *  the caller's, write, stage, commit, push.
   *
   *  `history` is what `git log --all` reports for this spec, and it is
   *  the ONLY thing that decides which steps count as done. `dirty`
   *  makes the pull refuse, which is how a stamp write is failed
   *  without failing anything else. */
  function gitFor({ history = HISTORY, dirty = false } = {}) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "master\n" };
      if (a === "rev-parse --show-toplevel") return { code: 0, stdout: `${REPO_ROOT}\n` };
      if (a === "rev-parse HEAD") return { code: 0, stdout: "beefcafe1234\n" };
      // The checkout the save writes in. Clean unless a test says
      // otherwise, and a dirty one is what the pull refuses by name.
      if (a === "diff --quiet HEAD") return { code: dirty ? 1 : 0, stdout: "" };
      // Something IS staged after the write, or `saveSpecFiles` would
      // report the file unchanged and never commit.
      if (a.startsWith("diff --cached --quiet")) return { code: 1, stdout: "" };
      // Which steps this spec has HAD. `--all`, because implement's
      // commit sits on the spec's branch until archive lands it.
      if (a.startsWith("log --all")) return { code: 0, stdout: `${history.join("\n")}\n` };
      // One sha for every file, so the save's optimistic-concurrency
      // check compares the value it was handed against itself.
      if (a.startsWith("log -1 --format=%H")) return { code: 0, stdout: "c0ffee123456\t2026-08-16T09:00:00+02:00\n" };
      // The pull's own fast-forward check. Every other `merge-base`
      // question — "is this branch merged" — keeps its old answer.
      if (a === "merge-base --is-ancestor HEAD refs/remotes/origin/master") return { code: 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      if (a.startsWith("merge -q")) return { code: 0, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  function serverWith(dir: string, git: { run: (d: string, a: string[]) => Promise<unknown> }) {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(project, "specs", SPEC), { recursive: true });
    writeFileSync(join(project, "specs", SPEC, "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", SPEC, "4-status.md"), statusSaying(["create", "analyze"]));
    const results = join(dir, "jobs");
    mkdirSync(results, { recursive: true });
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: projectsRoot,
        queueProjectRoot: projectsRoot,
        gitRun: git.run as never,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
      },
    });
    return { base, results, statusFile: join(project, "specs", SPEC, "4-status.md") };
  }

  const RESULT = (over: Record<string, unknown> = {}) => ({
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    branchUrls: [{ root: REPO_ROOT, url: "https://example.test/aide" }],
    repos: [],
    ...over,
  });

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 200; n++) {
      const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
        job: Record<string, unknown>;
      };
      if (done(body.job)) return body.job;
      await Bun.sleep(25);
    }
    throw new Error("the job never settled");
  }

  /** One step, run to completion with the result `aide-run-spec` would
   *  have written, handed back as the queue left it. */
  async function step(
    base: string,
    results: string,
    name: string,
    settled: (j: Record<string, unknown>) => boolean = (j) => j.state === "done" && !j.landing,
  ): Promise<Record<string, unknown>> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [name] }),
      })
    ).json()) as { job: { id: string } };
    writeFileSync(join(results, `${made.job.id}.json`), JSON.stringify(RESULT()));
    return settle(base, made.job.id, settled);
  }

  /** The figure the file carries, or null when it carries none. The
   *  reader's own contract, spelled out again here rather than imported:
   *  a test that asked the code under test what it wrote would prove
   *  only that it agreed with itself. */
  const stampedMs = (file: string): number | null => {
    const m = readFileSync(file, "utf-8").match(/^.*\*\*Time spent \(ms\):\*\*[ \t]*(.*)$/m);
    if (!m) return null;
    const value = m[1]!.replace(/`/g, "").trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  };

  /** What the phases add up to, worked out from the jobs' OWN
   *  `StepResult.at` timestamps — never from the rendered label, which
   *  is rounded to the second, and never from a hardcoded number. A
   *  job's first step counts from the job's own start; every later one
   *  from where the step before it ended. */
  const expectedMs = (jobs: Record<string, unknown>[]): number => {
    let total = 0;
    for (const job of jobs) {
      const results = (job.results ?? []) as { at: string }[];
      let boundary = Date.parse(job.startedAt as string);
      for (const r of results) {
        total += Date.parse(r.at) - boundary;
        boundary = Date.parse(r.at);
      }
    }
    return total;
  };

  // Criterion 1.
  test("a landed archive stamps 4-status.md with what the phases added up to", async () => {
    const dir = own("aide-207-stamp-");
    const git = gitFor();
    const { base, results, statusFile } = serverWith(dir, git);

    const analyze = await step(base, results, "analyze");
    const implement = await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.error).toBeFalsy();
    const stamped = stampedMs(statusFile);
    expect(stamped).not.toBeNull();
    expect(stamped).toBe(expectedMs([analyze, implement, archive]));
    // The file is committed and pushed like any other spec edit — the
    // stamp is no use to anyone sitting in a working tree.
    expect(git.calls.some((c) => c.dir === REPO_ROOT && c.args[0] === "commit")).toBe(true);
    expect(git.calls.some((c) => c.dir === REPO_ROOT && c.args[0] === "push")).toBe(true);
  }, 20000);

  // Criterion 5. 133 was archived three times; a spec whose archive is
  // run again must not grow a second bullet or have its first one
  // rewritten with a figure measured over a different set of jobs.
  test("archiving a second time leaves the first figure exactly as it was", async () => {
    const dir = own("aide-207-again-");
    const git = gitFor();
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    await step(base, results, "archive");
    const first = stampedMs(statusFile);
    expect(first).not.toBeNull();

    await step(base, results, "archive");
    expect(stampedMs(statusFile)).toBe(first);
    expect(readFileSync(statusFile, "utf-8").match(/Time spent \(ms\)/g)).toHaveLength(1);
  }, 30000);

  // Criterion 6. The merge already happened. A write that cannot be
  // made is logged and left there — turning a landed archive into a
  // failed job would hand back a task nobody can act on, and the row
  // it leaves is a blank cell, which is a state the archive page
  // already draws for half its rows.
  test("a stamp that cannot be written leaves the archive landed and the job clean", async () => {
    const dir = own("aide-207-refused-");
    const git = gitFor({ dirty: true });
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.state).toBe("done");
    expect(archive.error).toBeFalsy();
    expect(archive.errorReason).toBeFalsy();
    expect(stampedMs(statusFile)).toBeNull();
  }, 20000);

  // Criterion 8. These jobs' own results say all three steps finished.
  // `done` does not come from them: it comes from the runner's commits,
  // through the same `withFreshness` the live list uses — which is what
  // takes `analyze` back out when the description moved on after it.
  // A spec the list would show no total for must store none either.
  test("a spec whose history is short of a phase stores nothing, whatever its jobs report", async () => {
    const dir = own("aide-207-short-");
    const git = gitFor({ history: [`Run /aide-analyze for ${SPEC} (headless)`] });
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.error).toBeFalsy();
    expect(stampedMs(statusFile)).toBeNull();
  }, 20000);
});

// Spec 154: the runner owns the record of what has run.
//
// Two incidents on 2026-08-21, in opposite directions. 147's implement
// had RED and GREEN done and every test green, and was killed by the
// step's own time limit before the model reached the part that writes
// `4-status.md` — so the row read "implement not run" about a spec
// whose code was committed on its branch. 153's four files were copied
// from a sibling whose analyze had landed, so a brand-new spec claimed
// three steps and the row offered implement first.
//
// The commits are the record now. The file's line is a claim, and a
// claim the history does not support is said out loud on the row.
describe("spec 154: what has run is what has been committed", () => {
  const specDir = (dir: string) => join(dir, "root", "aide", "specs", "81-queue-and-runner");
  /** Spec 208: every fixture here writes its `4-status.md` and makes
   *  its commits AFTER the server started, and a render reads memory
   *  now. Two things have to catch up before the row is the row this
   *  suite is about — the cache schedule has to have seen the git repo
   *  at all, and the filesystem watcher has to have cleared the disk
   *  scan the boot-time tick took — so the page is asked again until
   *  the row stops changing.
   *
   *  The Started cell is the git half's tell: `–` until git can date
   *  the folder, a real date once the repo exists. The stability of the
   *  whole row is the disk half's, since what the file claims differs
   *  per test and there is no one string to wait for. Bounded, and it
   *  falls through with the last answer so a regression reads as the
   *  assertion it broke. */
  const listPage = async (base: string): Promise<string> => {
    // Past the filesystem watcher's own 300 ms debounce (`serve.ts`,
    // `scheduleNotify`), which is what clears the disk scan the
    // boot-time warm took. Waiting for the ROW to stop changing does
    // not do it: the row is stable for those 300 ms, at the old answer.
    await new Promise((r) => setTimeout(r, 400));
    return listUntil(base, dated);
  };

  // Criterion 1: the 153 incident.
  test("a copied 4-status.md cannot make a fresh spec look analysed", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    // The folder exists, and nothing has ever run in it.
    ran(dir, []);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    // Spec 176: `create` is settled by the folder existing, so it is
    // done here and says nothing about the copy. What spec 153 is the
    // guard for is the two below it.
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(phaseDone(line, "implement")).toBe(false);
    // And the phase a press would START at is analyze, not implement:
    // every un-run phase is ticked since spec 200, so the button — which
    // names the first of them — is what tells the two apart.
    expect(line).toMatch(/value="analyze" checked/);
    expect(line).toContain(">Analyze</button>");
  });

  // Spec 176, criterion 3: a spec that appears on the dashboard has
  // been created, so "create not run yet" cannot be true. The folder
  // being on disk is a stronger source than the commit log — a spec
  // written by hand has no `Run /aide-create` commit at all — and the
  // pip has read it that way since spec 167. The phase LINE agrees now.
  test("a spec whose folder exists has had create, whatever git records", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // Analyze has a commit; create never did.
    ran(dir, ["analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    // The create line itself, not the group: the three phases below it
    // genuinely have not run, and say so.
    const createLine = line.match(/<tr class="subrow[^"]*"[^>]*data-step="create">[\s\S]*?<\/tr>/)![0];
    expect(createLine).not.toContain("not run yet");
  });

  // And the claim carries no qualifier of its own: the status file
  // here does not name `create`, which before spec 176 would have been
  // a disagreement the moment `create` was forced into `done`.
  test("forcing create into done invents no disagreement", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["analyze"]));
    ran(dir, ["analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(line).not.toContain("the files disagree with what has run");
  });

  // Criterion 3, the same fixture: the row does not swallow it.
  test("a file claiming a step the history does not have says so on the row", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    ran(dir, ["create"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(line).toContain("the files disagree with what has run");
  });

  test("and so does a file that has NOT caught up with a step that ran", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(line).toContain("the files disagree with what has run");
  });

  test("a file that agrees with the history says nothing at all", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(line).not.toContain("the files disagree with what has run");
  });

  // Criterion 2: the 147 incident. No job in the queue's memory at all
  // — the row is built from the commit alone.
  test("a step killed by the time limit reads as stopped, not as not-run", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    ran(dir, ["implement"], "81-queue-and-runner", { stopped: "timeout" });
    const line = specControls(await listPage(base), "81-queue-and-runner");
    const implement =
      line.match(/<tr class="subrow[^"]*"[^>]*data-step="implement">[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(implement).toContain("stopped: timeout");
    expect(implement).not.toContain("not run yet");
    // Stopped is not done: implement is still what the row offers.
    expect(phaseDone(line, "implement")).toBe(false);
    expect(line).toMatch(/value="implement" checked/);
  });

  // Criterion 4.
  test("a completed re-run supersedes the stop before it", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create", "analyze"]);
    ran(dir, ["implement"], "81-queue-and-runner", { stopped: "timeout" });
    ran(dir, ["implement"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).not.toContain("stopped: timeout");
    expect(line).toMatch(/value="archive" checked/);
  });

  // Criterion 5: a step run at somebody's keyboard, committed by hand
  // with the subject the four skills now offer.
  test("an interactive commit with no headless marker counts the same", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create", "analyze"], "81-queue-and-runner", { headless: false });
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
  });
});

// Spec 97: a description edited after the analyze ran leaves the plan
// describing an older problem, and the row said nothing. The signal is
// asked of git at render time and never stored, so a re-run clears it
// without anything having to remember it was ever set.
describe("a description newer than the analysis is shown on the row", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
  const DESCRIPTION_EDITED = "2026-08-18T09:10:36+02:00";
  const SUBJECT = "Run /aide-analyze for 81-queue-and-runner (headless)";

  /** The specs repo answering for one spec: which steps it has had
   *  (spec 154), when its description was last committed, and what its
   *  analyze history looks like. */
  const gitSaying = (descriptionAt: string, analyzeLog: string, differs = true) =>
    gitFake({
      // The workflow history, first because its argv is the more
      // specific one — the table's first matching prefix wins.
      "log --all --format=%s": {
        code: 0,
        stdout: ["create", "analyze", "implement"]
          .map((step) => `Run /aide-${step} for 81-queue-and-runner (headless)`)
          .join("\n"),
      },
      "log -1 --format=%H": { code: 0, stdout: `deadbee\t${descriptionAt}\n` },
      "log --format=%H%x09%aI%x09%s": { code: 0, stdout: analyzeLog },
      // `git diff --quiet`: 1 means the description says something the
      // analysis never read, 0 means the commit changed nothing.
      "diff --quiet": { code: differs ? 1 : 0 },
    });

  /** A spec whose files agree with the history `gitSaying` reports:
   *  analyze done, and implement too. */
  const analysedSpec = (dir: string): void => {
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "- **Total progress:** `100% (4 of 4 completed)`\n",
      ),
    );
  };

  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string): string =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  /** The badge sits on the analyze phase line and the marks on the step
   *  boxes, and a collapsed row draws neither — so every fetch here
   *  asks for the spec open. */
  const listPage = (base: string) => fetch(`${base}/?${OPEN_81}`, auth).then((r) => r.text());

  test("the analyze line says the description changed since (criterion 1)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(subRow(html, "analyze")).toContain("description changed since");
    expect(subRow(html, "implement")).not.toContain("description changed since");
  });

  test("analyze stops counting as done (criteria 2, 3)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    // implement is untouched by this check: its own done-mark comes
    // from 4-status.md, and nothing here blocks running it.
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).toMatch(/value="analyze" checked/);
    expect(line).not.toMatch(/value="implement" checked/);
  });

  // Spec 139, criterion 10: the freshness check is a DISPLAY override,
  // derived at render time. It clears the two marks the stale
  // description casts doubt on; it never rewrites the record they came
  // from, so a re-analysis that proves the edit cosmetic restores the
  // marks with nothing having had to remember them.
  test("the stale row leaves the recorded list on disk untouched (spec 139, criterion 10)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const statusPath = join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md");
    const before = readFileSync(statusPath, "utf-8");
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(readFileSync(statusPath, "utf-8")).toBe(before);
    expect(before).toContain("- **Workflow steps completed:** create, analyze, implement");
  });

  test("a re-analyzed spec is current again (criterion 5)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(
        DESCRIPTION_EDITED,
        [
          `2026-08-18T11:00:00+02:00\t${SUBJECT}`,
          `2026-08-18T08:57:16+02:00\t${SUBJECT}`,
        ].join("\n"),
      ).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(html).not.toContain("description changed since");
    const line = specControls(html, "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
  });

  test("a description older than the analysis changes nothing (criterion 4)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying("2026-08-18T08:00:00+02:00", `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(html).not.toContain("description changed since");
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "analyze")).toBe(true);
  });

  // A git that cannot answer must not put a badge on the page that
  // nothing can ever clear.
  //
  // What it DOES do since spec 154 is leave the phase unmarked: the
  // history is the record, and a history nothing can read proves
  // nothing has run. That direction is deliberate — a spec reading as
  // still having analyze ahead of it is visible, and running the step
  // fixes it, where a mark nothing earned is neither. The file's own
  // claim is still on the row, as the disagreement it now is.
  test("git with no answer marks nothing, and still puts no stale badge up (criteria 8, 10)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitFake({}).run,
    });
    analysedSpec(dir);
    // Spec 208: the file's own claim reaches the row off the disk scan,
    // and that scan was taken at boot — before `analysedSpec` wrote.
    // The watcher clears it and the row catches up a tick later.
    const html = await listUntil(base, (h) =>
      specControls(h, "81-queue-and-runner").includes("the files disagree with what has run"),
    );
    expect(html).not.toContain("description changed since");
    const line = specControls(html, "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(line).toContain("the files disagree with what has run");
  });
});

// --- spec 99: one merge at a time, the view survives, a refusal is seen -----

// Pressing Merge on two specs one after the other, with nothing else
// running, answered "cannot fast-forward main in …/aide-specs — merge
// it by hand" between the clicks: both requests share one checkout and
// fought over its index.lock. Both went through on a retry, which is
// what says it was a race and not a divergence.
//
// Spec 149 removed the button and made the collision likelier, not
// rarer: four steps land themselves now, and two specs sharing one
// specs repo can finish within seconds of each other under queue
// concurrency. So the same measurement is taken over two LANDINGS.
describe("two landings against one repo run one at a time (criteria 6, 10)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SHARED_REPO = "/repos/aide-specs";
  const SECOND_SPEC = "82-second-spec";

  /** A git slow enough to overlap, that counts how many mutating calls
   *  are in flight against one root at once. `switch`, `pull`, `merge`
   *  and `push` are the four that touch the checkout — a second one
   *  arriving while the first is unfinished is precisely the collision. */
  function gitCounting() {
    const MUTATING = new Set(["switch", "pull", "merge", "push"]);
    let inFlight = 0;
    let peak = 0;
    const run = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      const mutating = MUTATING.has(args[0]!);
      if (mutating) {
        inFlight++;
        peak = Math.max(peak, inFlight);
      }
      await new Promise((r) => setTimeout(r, 5));
      if (mutating) inFlight--;
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, peak: () => peak };
  }

  test("neither landing ever sees the other mid-merge, and both go through (criterion 6)", async () => {
    const results = mkdtempSync(join(tmpdir(), "aide-lock-results-"));
    ownDirs.push(results);
    const git = gitCounting();
    const { base } = start(
      {
        queueToken: TOKEN,
        gitRun: git.run,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
        queueConcurrency: 2,
      },
      [],
      [SECOND_SPEC],
    );

    // Two analyze steps on two specs, both landing in the SAME specs
    // repo — which every spec shares, because every spec's plan lives
    // in the specs root.
    const settled = await Promise.all(
      ["81-queue-and-runner", SECOND_SPEC].map(async (specFolder) => {
        const made = (await (
          await fetch(`${base}/api/queue`, {
            method: "POST",
            headers: AUTH,
            body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
          })
        ).json()) as { job: { id: string } };
        writeFileSync(
          join(results, `${made.job.id}.json`),
          JSON.stringify({
            ok: true,
            exitCode: 0,
            costUsd: 0.1,
            costMeasured: true,
            terminalReason: "completed",
            branch: `aide/${specFolder}`,
            branchUrls: [{ root: SHARED_REPO, url: "https://example.test/aide-specs" }],
            repos: [],
          }),
        );
        for (let n = 0; n < 100; n++) {
          const body = (await (await fetch(`${base}/api/queue/${made.job.id}`, { headers: AUTH })).json()) as {
            job: Record<string, unknown>;
          };
          if (body.job.state === "done" && !body.job.landing) return body.job;
          await Bun.sleep(50);
        }
        throw new Error("the job never settled");
      }),
    );

    for (const job of settled) expect(job.error).toBeFalsy();
    // Both landed: the branch each job advertised is gone from its row.
    for (const job of settled) expect(job.branchUrls).toEqual([]);
    expect(git.peak()).toBe(1);
  });
});

// The lock is a map of chained promises, and a map a long-running
// server never empties is a map that grows for as long as it is up.
describe("the per-repo lock lets go once its chain has settled (criterion 10)", () => {
  test("work for one root is serialized, in the order it was asked for", async () => {
    const lock = createRootLock();
    const order: string[] = [];
    const slow = (name: string, ms: number) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      return name;
    };
    const both = Promise.all([lock.run("/repo", slow("a", 20)), lock.run("/repo", slow("b", 1))]);
    expect(await both).toEqual(["a", "b"]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  test("two different roots do not wait for each other", async () => {
    const lock = createRootLock();
    let peak = 0;
    let inFlight = 0;
    const job = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    };
    await Promise.all([lock.run("/a", job), lock.run("/b", job)]);
    expect(peak).toBe(2);
  });

  test("the map holds nothing once the last request for a root is done", async () => {
    const lock = createRootLock();
    await Promise.all([
      lock.run("/repo", async () => new Promise((r) => setTimeout(r, 5))),
      lock.run("/repo", async () => new Promise((r) => setTimeout(r, 5))),
      lock.run("/other", async () => new Promise((r) => setTimeout(r, 5))),
    ]);
    // One turn of the microtask queue for the cleanup that runs after
    // the last chain settles.
    await new Promise((r) => setTimeout(r, 0));
    expect(lock.size).toBe(0);
  });

  test("one turn throwing does not poison the next", async () => {
    const lock = createRootLock();
    const failed = lock.run("/repo", async () => {
      throw new Error("git blew up");
    });
    await expect(failed).rejects.toThrow("git blew up");
    expect(await lock.run("/repo", async () => "fine")).toBe("fine");
  });
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

// --- spec 95: the preview link is read from the project's own manifest -------

// The pure render functions are tested next to the markup they produce.
// What only the server can answer is which repo a preview belongs to:
// the manifest lives in the project's checkout, and the specs repo
// beside it carries a plan with nothing to try.
describe("GET /queue and /specs/<id>: the preview link (criteria 1-4)", () => {
  const AUTH = { "x-aide-token": TOKEN };
  const TEMPLATE = "https://{branch}.example.pages.dev";
  const EXPECTED = "https://aide-81-queue-and-runner.example.pages.dev";

  /** A project root holding the project's own checkout and a specs repo
   *  beside it — the shape an `aide` spec actually pushes to. Only the
   *  project's checkout gets a manifest; the specs repo has none, which
   *  is what makes it a plan repo rather than deployable code. */
  function roots(preview?: string): { root: string; repo: string; specsRepo: string } {
    const root = mkdtempSync(join(tmpdir(), "aide-preview-"));
    ownDirs.push(root);
    const repo = join(root, "aide");
    mkdirSync(join(repo, ".aide"), { recursive: true });
    writeFileSync(
      join(repo, ".aide", "project.yaml"),
      `name: aide\ndeployment:\n  host: somewhere\n` + (preview ? `  preview: "${preview}"\n` : ""),
    );
    const specsRepo = join(root, "aide-specs");
    mkdirSync(specsRepo, { recursive: true });
    return { root, repo, specsRepo };
  }

  const gitQuiet = async (_dir: string, args: string[]) => {
    const a = args.join(" ");
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
    return { code: 0, stdout: "" };
  };

  async function seed(branchUrls: { root: string; url: string }[]): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...AUTH },
        body: JSON.stringify(JOB),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "done";
    job.branchUrls = branchUrls;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  const startWith = (root: string, mirror: string) =>
    start({ queueToken: TOKEN, queueMirrorPath: mirror, queueProjectRoot: root, gitRun: gitQuiet }).base;

  test("the row carries the manifest's preview link for the project's own repo (criterion 1)", async () => {
    const { root, repo, specsRepo } = roots(TEMPLATE);
    const { mirror, id } = await seed([
      { root: repo, url: "https://example.test/aide" },
      { root: specsRepo, url: "https://example.test/aide-specs" },
    ]);
    const html = await (await fetch(`${startWith(root, mirror)}/queue?rows=1`, { headers: AUTH })).text();
    expect(html).toContain(`href="${EXPECTED}"`);
    // One link, not two: the specs repo pushed a branch of the same
    // name, and there is nothing to try in a plan (criterion 4).
    expect(html.match(/>preview<\/a>/g)).toHaveLength(1);
    expect(id).toBeTruthy();
  });

  // Spec 150: the Work row left the job page, and the preview link went
  // with it — both are on the row this page is opened from, and the
  // Overview is now what is said nowhere else.
  test("the job page carries neither link — the row has both (spec 150)", async () => {
    const { root, repo } = roots(TEMPLATE);
    const { mirror, id } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const html = await (await fetch(`${startWith(root, mirror)}/specs/${id}`, { headers: AUTH })).text();
    expect(html).not.toContain(`href="${EXPECTED}"`);
    expect(html).not.toContain('href="https://example.test/aide"');
  });

  test("a manifest without the key adds nothing at all (criterion 3)", async () => {
    const { root, repo } = roots();
    const { mirror } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const html = await (await fetch(`${startWith(root, mirror)}/queue?rows=1`, { headers: AUTH })).text();
    expect(html).not.toContain(">preview</a>");
    expect(html).toContain('href="https://example.test/aide"');
  });

  // The manifest is read per render, not once at startup: adding the key
  // must show up on the next page load, not the next deploy.
  test("a manifest edited while the server runs is picked up on the next render", async () => {
    const { root, repo } = roots();
    const { mirror } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const base = startWith(root, mirror);
    expect(await (await fetch(`${base}/queue?rows=1`, { headers: AUTH })).text()).not.toContain(">preview</a>");
    writeFileSync(join(repo, ".aide", "project.yaml"), `name: aide\ndeployment:\n  preview: "${TEMPLATE}"\n`);
    expect(await (await fetch(`${base}/queue?rows=1`, { headers: AUTH })).text()).toContain(`href="${EXPECTED}"`);
  });
});

// A project taken out of the queue's allowlist (aide-dashboard, folded
// into aide by spec 85) still has its jobs in the 200-job history, and
// the page kept them as rows: three specs of a project that no longer
// exists, with a Run button that could only be refused. The row list is
// what the queue may run; a dead project's history is not on it.
describe("jobs of a project no longer in the allowlist are not rows", () => {
  const AUTH = { headers: { "x-aide-token": TOKEN } };

  test("a mirror carrying a retired project's jobs renders none of them", async () => {
    const dead = { ...JOB, project: "aide-dashboard", specFolder: "01-first" };
    // Enqueued while the project was still allowed and had a spec, then
    // served by a queue that no longer lists it — the shape of a
    // project retired after the fact.
    const first = start({ queueToken: TOKEN, queueProjects: ["aide", "aide-dashboard"] }, ["aide-dashboard"]);
    await fetch(`${first.base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...AUTH.headers },
      body: JSON.stringify(dead),
    });
    const mirror = join(first.dir, "queue.json");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, queueProjects: ["aide"] });
    const html = await (await fetch(`${base}/?rows=1`, AUTH)).text();
    expect(html).not.toContain("01-first");
    expect(html).not.toContain("aide-dashboard");
    // The API keeps the history: this is a page rule, not a deletion.
    const api = (await (await fetch(`${base}/api/queue`, AUTH)).json()) as { jobs: { project: string }[] };
    expect(api.jobs.some((j) => j.project === "aide-dashboard")).toBe(true);
  });
});

// --- spec 112: adding and removing a project ---------------------------------
//
// Both are ordinary mutating routes on the queue surface: same token,
// same per-step answer the merge route gives, same refusal in
// `serve.log`. What is new is that they change the ALLOWLIST while the
// server runs — the list used to be a launchd argument, so every change
// cost a plist re-render and a restart.

interface StepBody {
  ok: boolean;
  project?: string;
  results: { step: string; ok: boolean; error?: string; note?: string }[];
  /** Spec 138: whether `aide-run-spec` would START there — a separate
   *  answer from `ok`, which only says the registration completed. */
  readiness?: {
    canRun: boolean;
    note: string;
    checks: { check: string; subject: string; ok: boolean; blocking: boolean; detail: string }[];
  };
}

/** A git that makes the directory a real clone would have made. Every
 *  step after the clone reads that directory, so a fake leaving nothing
 *  behind would exercise only the first one. */
const cloningGit = (): ServerOptions["gitRun"] => async (dir, args) => {
  // Located, not assumed at index 0: since spec 183 the real clone
  // carries a `-c credential.helper=` prefix ahead of the subcommand.
  const clone = args.indexOf("clone");
  if (clone !== -1) {
    mkdirSync(join(dir, args[clone + 2]!), { recursive: true });
    return { code: 0, stdout: "" };
  }
  return { code: 1, stdout: "" };
};

/** A queue config of this suite's own, so a route that persists the
 *  allowlist has somewhere to write it. */
function ownConfig(contents: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-queue-projects-"));
  ownDirs.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, JSON.stringify(contents, null, 2));
  return file;
}

const projectsIn = (file: string): string[] =>
  (JSON.parse(readFileSync(file, "utf-8")) as { projects?: string[] }).projects ?? [];

describe("POST /api/queue/projects (spec 112)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  // Criterion 1.
  test("a git URL is cloned, given a manifest, and put on the allowlist", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "newproj", gitUrl: "https://example.com/newproj.git" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.step)).toEqual(["name", "clone", "manifest", "allowlist"]);
    expect(body.results.every((r) => r.ok)).toBe(true);
    expect(existsSync(join(dir, "root", "newproj", ".aide", "project.yaml"))).toBe(true);
    // On the allowlist the MOMENT it is done — no restart, and no
    // waiting for the five-second scan: the New-spec form's project
    // list is the raw allowlist, so it shows a project with no spec yet.
    const html = await (await fetch(`${base}/new`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.slice(html.indexOf('action="/api/queue/create"'))).toContain('value="newproj"');
  });

  // Criterion 2.
  test("a name already taken under the projects root is refused, and names the collision", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "aide", gitUrl: "https://example.com/aide.git" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.step === "clone")!.error).toContain("aide");
    expect(existsSync(join(dir, "root", "aide", ".git"))).toBe(false);
  });

  // Criterion 3, at the route level.
  test("an unsafe name is refused before anything is cloned or written", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: cloningGit() });
    for (const name of ["../escape", "a/b", ".hidden", ""]) {
      const res = await fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name, gitUrl: "https://example.com/x.git" }),
      });
      expect([name, res.status]).toEqual([name, 400]);
    }
    expect(existsSync(join(dir, "escape"))).toBe(false);
    expect(existsSync(join(dir, "root", ".hidden"))).toBe(false);
  });

  // Criterion 6: an existing checkout with no manifest gets one, and
  // the answer says so rather than leaving the operator to find out.
  test("a checkout already on the host is registered, and a made manifest is reported", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const path = join(dir, "root", "already-here");
    mkdirSync(path, { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "already-here", existingPath: path, description: "on disk already" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.step)).toEqual(["name", "register", "manifest", "allowlist"]);
    expect(body.results.find((r) => r.step === "manifest")!.note).toMatch(/aide-manifest/);
  });

  // Spec 131: the form picks a checkout by its bare directory name and
  // leaves Name blank — so the name the ALLOWLIST gets has to be the one
  // derived from the pick. Posting the raw blank would add "" and the
  // project the manifest was just written for would never be runnable.
  test("a picked checkout with no Name is allowlisted under the picked name", async () => {
    const file = ownConfig({ concurrency: 2 });
    const { base, dir } = start({ queueToken: TOKEN, queueConfigFile: file });
    mkdirSync(join(dir, "root", "picked"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "", existingPath: "picked" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(projectsIn(file).sort()).toEqual(["aide", "picked"]);
  });

  // Criterion 9: the change survives a restart, because it is written to
  // the file the server reads on the way up.
  test("the new allowlist is persisted to the queue config", async () => {
    const file = ownConfig({ concurrency: 2 });
    const { base } = start({ queueToken: TOKEN, queueConfigFile: file, gitRun: cloningGit() });
    await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "newproj", gitUrl: "https://example.com/newproj.git" }),
    });
    expect(projectsIn(file).sort()).toEqual(["aide", "newproj"]);
    // The rest of the config is untouched.
    expect(JSON.parse(readFileSync(file, "utf-8")).concurrency).toBe(2);
  });

  // Criterion 15: two requests in immediate succession, neither losing
  // the other's change. Every write is derived from the live allowlist,
  // never from a copy of the file read before the other one landed.
  test("two changes in immediate succession both survive", async () => {
    const file = ownConfig({});
    const { base } = start({ queueToken: TOKEN, queueConfigFile: file, gitRun: cloningGit() });
    const add = (name: string) =>
      fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name, gitUrl: `https://example.com/${name}.git` }),
      });
    await Promise.all([add("one"), add("two")]);
    expect(projectsIn(file).sort()).toEqual(["aide", "one", "two"]);
    await Promise.all([
      fetch(`${base}/api/queue/projects/one/remove`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ confirm: "one" }),
      }),
      fetch(`${base}/api/queue/projects/aide/remove`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ confirm: "aide" }),
      }),
    ]);
    expect(projectsIn(file).sort()).toEqual(["two"]);
  });

  // Spec 115: back to the page the form is ON, which is `/projects` now.
  // Every other route here still lands on `/` — the target is a
  // parameter with `/` as its default, not a rewrite.
  test("a form submit lands back on /projects, refusal and success alike", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
    const refused = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ name: "../escape", gitUrl: "https://example.com/x.git" }),
    });
    expect(refused.status).toBe(303);
    // Back to the page the FORM is on (2026-08-19): the Add page.
    expect(refused.headers.get("location")!.startsWith("/projects/new?error=")).toBe(true);

    const path = join(dir, "root", "on-disk");
    mkdirSync(path, { recursive: true });
    const ok = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ name: "on-disk", existingPath: path }),
    });
    expect(ok.status).toBe(303);
    // The list, as it has been since spec 115 — carrying the readiness
    // answer since spec 138, which is that spec's to assert.
    expect(ok.headers.get("location")!.split("?")[0]).toBe("/projects");
  });

  test("a refusal reaches the log", async () => {
    const { base } = start({ queueToken: TOKEN });
    const written: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void written.push(args.join(" "));
    try {
      await fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name: "../escape", gitUrl: "https://example.com/x.git" }),
      });
    } finally {
      console.error = realError;
    }
    expect(written.join("\n")).toContain("add-project refused");
  });
});

// --- spec 184: settings that can be changed after Add -------------------------
//
// The two fields lived on the Add form and nowhere else, so a project
// added without them could only be fixed by removing and re-adding it,
// or by editing a file on the serving host.
describe("a project's settings route (spec 184)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  const settled = async (
    extra: Record<string, unknown> = {},
  ): Promise<{ base: string; dir: string; project: string }> => {
    const { base, dir } = start({ queueToken: TOKEN, ...extra });
    return { base, dir, project: join(dir, "root", "aide") };
  };

  test("the form is served, pre-filled with what the project has today", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\nworktreeLinks: node_modules\n");
    writeFileSync(join(project, ".aide", "config"), "AIDE_SPECS_PATH=/repos/aide-specs/aide\n");
    const res = await fetch(`${base}/projects/aide/settings`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/name="worktreeLinks"[^>]*value="node_modules"/);
    expect(html).toMatch(/name="specsPath"[^>]*value="\/repos\/aide-specs\/aide"/);
  });

  test("a project the allowlist does not know is a mistyped address", async () => {
    const { base } = await settled();
    const res = await fetch(`${base}/projects/nosuch/settings`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(404);
  });

  // Criterion 4: the whole point — a project brought to runnable without
  // leaving the dashboard.
  test("a save writes the links to the manifest and answers with the new readiness", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, "node_modules"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ worktreeLinks: "node_modules", specsPath: "" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(readFileSync(join(project, ".aide", "project.yaml"), "utf-8")).toContain(
      "worktreeLinks: node_modules",
    );
    expect(body.readiness!.checks.find((c) => c.check === "worktreeLinks")!.ok).toBe(true);
  });

  test("an unusable value is refused, and nothing is written", async () => {
    const { base, project } = await settled();
    const before = readFileSync(join(project, ".aide", "project.yaml"), "utf-8");
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ worktreeLinks: "../escape" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.step === "worktreeLinks")!.error).toContain("../escape");
    expect(readFileSync(join(project, ".aide", "project.yaml"), "utf-8")).toBe(before);
  });

  test("posting at a project nobody added is refused", async () => {
    const { base } = await settled();
    const res = await fetch(`${base}/api/queue/projects/nosuch/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ worktreeLinks: "node_modules" }),
    });
    expect(res.status).toBe(400);
  });

  // A browser with no script gets its answer the only way a redirect
  // can carry one — the same handover the Add form has had since spec
  // 138, back to the page the form is ON when it was refused.
  test("a no-script save lands back on the list, and a refusal on the form", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, "node_modules"), { recursive: true });
    const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
    const ok = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ worktreeLinks: "node_modules", specsPath: "" }),
    });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")!.split("?")[0]).toBe("/projects");
    const refused = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ worktreeLinks: "/etc" }),
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")!.startsWith("/projects/aide/settings?error=")).toBe(true);
  });
});

// --- spec 138: the Add says whether a run can start ---------------------------
//
// Adding a project answered "added" and left the operator to press Run to
// find out the rest. Registration and readiness are two answers now, and
// both reach the caller: `ok` says the registration completed, `readiness`
// says whether `aide-run-spec` would start.
describe("POST /api/queue/projects reports readiness (spec 138)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  /** A git that answers for a checkout which is its own root, clean, on
   *  its default branch — with `answers` layered over it. */
  const readyGit = (answers: Record<string, { code: number; stdout?: string }> = {}) =>
    async (at: string, args: string[]) => {
      const joined = args.join(" ");
      for (const [prefix, a] of Object.entries(answers)) {
        if (joined.startsWith(prefix)) return { code: a.code, stdout: a.stdout ?? "" };
      }
      const clone = args.indexOf("clone");
      if (clone !== -1) {
        mkdirSync(join(at, args[clone + 2]!), { recursive: true });
        return { code: 0, stdout: "" };
      }
      if (joined.startsWith("rev-parse --show-toplevel")) return { code: 0, stdout: `${at}\n` };
      if (joined.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (joined.startsWith("symbolic-ref --short refs/remotes/origin/HEAD")) {
        return { code: 0, stdout: "origin/main\n" };
      }
      if (joined.startsWith("show-ref --verify --quiet refs/heads/main")) return { code: 0, stdout: "" };
      if (joined.startsWith("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "main\n" };
      if (joined.startsWith("worktree list")) return { code: 0, stdout: "" };
      return { code: 1, stdout: "" };
    };

  // Criterion 10: additive. A caller that reads `ok`, `project` and
  // `results` sees exactly what it saw before.
  test("a successful add carries readiness beside the steps it always carried", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    const path = join(dir, "root", "ready-one");
    mkdirSync(join(path, "specs"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "ready-one", existingPath: path }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.project).toBe("ready-one");
    expect(body.results.map((r) => r.step)).toEqual(["name", "register", "manifest", "allowlist"]);
    expect(body.readiness!.canRun).toBe(true);
    expect(body.readiness!.note).toContain("ready to run");
  });

  // Criterion 10, the other half: the two answers are independent. This
  // is Skjer — added, allowlisted, and unable to run.
  test("registration succeeds while the run is blocked, and the answer says both", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    // No specs root, and none named on the form — one of the four
    // things that refused the real Skjer, and the one still left of
    // them that a bare Add cannot put right itself.
    const path = join(dir, "root", "skjer");
    mkdirSync(path, { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "skjer", existingPath: path }),
    });
    // 200: the registration DID complete, and a 400 would tell an API
    // caller to try it again against a checkout that is already there.
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.every((r) => r.ok)).toBe(true);
    expect(body.readiness!.canRun).toBe(false);
    expect(body.readiness!.note).toContain("cannot run yet");
    expect(body.readiness!.checks.find((c) => c.blocking)!.detail).toContain(join(path, "specs"));
    // And it is on the allowlist regardless: registration is what puts
    // it there, and the readiness answer is about a later moment.
    const html = await (await fetch(`${base}/new`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.slice(html.indexOf('action="/api/queue/create"'))).toContain('value="skjer"');
  });

  // Criterion 11, the no-JavaScript half: the result cannot be left in a
  // response body the redirect throws away.
  test("a form POST carries the whole readiness answer to the page it lands on", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    const path = join(dir, "root", "noscript");
    mkdirSync(path, { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      body: new URLSearchParams({ name: "noscript", existingPath: path }),
    });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/projects?")).toBe(true);
    const params = new URL(location, base).searchParams;
    // Not a yes: the colour of the banner follows the answer, and this
    // project cannot run.
    expect(params.get("noticeOk")).toBeNull();
    const notice = params.get("notice")!;
    // Two things to say at once — the missing specs root, which blocks,
    // and the unconfigured worktree links, which do not — and BOTH of
    // them are in the answer the reader lands on.
    expect(notice).toContain("cannot run yet");
    expect(notice).toContain(join(path, "specs"));
    expect(notice).toContain("worktree links");
    // And the page renders what it was handed.
    const page = await (await fetch(`${base}${location}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(page).toContain("cannot run yet");
  });

  // Criterion 7, at the route: the field is new, and an unusable value is
  // a refusal of the add rather than a readiness note.
  // Spec 184 moved this key: it is true of the project on any machine,
  // and `.aide/config` is dropped by a global ignore rule, so a clone
  // arrived on the next machine with the answer gone.
  test("worktree links are written to the project's own committed manifest", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    const path = join(dir, "root", "withlinks");
    mkdirSync(join(path, "node_modules"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "withlinks", existingPath: path, worktreeLinks: "node_modules" }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(path, ".aide", "project.yaml"), "utf-8")).toContain(
      "worktreeLinks: node_modules",
    );
    expect(existsSync(join(path, ".aide", "config"))).toBe(false);
  });

  test("a worktree link that would leave the repository is refused", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    const path = join(dir, "root", "badlinks");
    mkdirSync(path, { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "badlinks", existingPath: path, worktreeLinks: "../escape" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.step === "worktreeLinks")!.error).toContain("../escape");
    // Nothing readable is claimed about a project that was not added.
    expect(body.readiness).toBeUndefined();
  });
});

describe("POST /api/queue/projects/<name>/remove (spec 112)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  // Criterion 7.
  test("the name typed back removes it from the allowlist and touches no file", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/projects/aide/remove`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ confirm: "aide" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.step)).toEqual(["confirm", "allowlist"]);
    // The checkout and its specs are exactly where they were.
    expect(existsSync(join(dir, "root", "aide", ".aide", "project.yaml"))).toBe(true);
    expect(existsSync(join(dir, "root", "aide", "specs", "81-queue-and-runner"))).toBe(true);
    // And the page no longer offers it.
    const html = await (await fetch(`${base}/projects`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toContain('action="/api/queue/projects/aide/remove"');
  });

  // Criterion 8.
  test("a confirmation that does not match is refused and changes nothing", async () => {
    const { base } = start({ queueToken: TOKEN });
    for (const confirm of ["", "Aide", "aide "]) {
      const res = await fetch(`${base}/api/queue/projects/aide/remove`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ confirm }),
      });
      expect([confirm, res.status]).toEqual([confirm, 400]);
      const body = (await res.json()) as StepBody;
      expect(body.results[0]!.step).toBe("confirm");
    }
    const html = await (await fetch(`${base}/projects`, { headers: { "x-aide-token": TOKEN } })).text();
    // The row still stands, its Remove link with it (the form itself
    // lives on the row's own confirm page since 2026-08-19).
    expect(html).toContain('href="/projects/aide/remove"');
  });

  test("a project that was never on the allowlist is refused", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/projects/nosuch/remove`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ confirm: "nosuch" }),
    });
    expect(res.status).toBe(400);
  });

  // Criterion 4, for the second route.
  test("it is behind the same token, and POST only", async () => {
    const { base } = start({ queueToken: TOKEN });
    const body = JSON.stringify({ confirm: "aide" });
    expect(
      (await fetch(`${base}/api/queue/projects/aide/remove`, { method: "POST", body })).status,
    ).toBe(401);
    expect((await fetch(`${base}/api/queue/projects/aide/remove`, { headers: AUTH })).status).toBe(405);
    const off = start({});
    expect(
      (await fetch(`${off.base}/api/queue/projects/aide/remove`, { method: "POST", body })).status,
    ).toBe(503);
  });
});

// Spec 118: the token count is recorded by the run, stored on the job,
// and has to survive every hop between the mirror on disk and the cell
// in the page. The render tests prove the cell; this one proves the
// hops — a field the server forgets to forward renders a dash forever,
// and nothing else would notice.
describe("a job's token count reaches the page", () => {
  async function seeded(): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "done";
    job.spentUsd = 0.54;
    job.spentTokens = 1_234_000;
    job.results = [
      {
        step: "analyze", ok: true, costUsd: 0.54, costMeasured: true,
        terminalReason: "completed", at: "2026-08-16T10:01:00Z",
        tokens: { input: 100, output: 900, cacheRead: 1_000_000, cacheCreation: 233_000, total: 1_234_000 },
      },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  test("the spec list shows both figures, and the model dropdown stays in dollars", async () => {
    const { mirror } = await seeded();
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain('<span class="u-usd">$0.54</span>');
    expect(html).toContain('<span class="u-tok">1.2M tok</span>');
  });

  test("the job page shows both figures for the step and the job", async () => {
    const { mirror, id } = await seeded();
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const html = await (
      await fetch(`${base}/specs/${id}?tab=steps`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(html).toContain('<span class="u-usd">$0.54</span>');
    expect(html).toContain('<span class="u-tok">1.2M tok</span>');
  });
});

// --- spec 122: a queued step waits for its dependency, it does not fail -----
//
// Before this, a queued implement whose dependency was still unmerged
// started, was refused by `aide-run-spec`, and landed in `failed` — a
// state nothing retries. The queue now asks the same question the script
// asks (is the dependency's branch merged on origin?) BEFORE spawning
// anything, and leaves the job queued with the reason on its row until
// the answer changes.
describe("a job parked on an unmerged dependency (spec 122)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const DEPENDENT = "# Queue - Description\n\n## Tracking info\n\n- **Depends on:** `80-dependency`\n";

  /** A projects root this suite owns, so the paths git is asked about
   *  are the paths the test names. The shared harness makes its own and
   *  leaves `queueProjectRoot` unset, which resolves the project's
   *  checkout to a bare relative name — fine for a suite that never
   *  looks at it, useless for one that is entirely about which repo was
   *  asked. */
  function root(dir: string): { root: string; project: string; specs: string } {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    const specs = join(project, "specs");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(specs, "81-queue-and-runner"), { recursive: true });
    writeFileSync(join(specs, "81-queue-and-runner", "1-description.md"), DEPENDENT);
    mkdirSync(join(specs, "80-dependency"), { recursive: true });
    writeFileSync(join(specs, "80-dependency", "1-description.md"), "# 80-dependency\n");
    return { root: projectsRoot, project, specs };
  }

  /** A stub runner that records the argv it was called with — the same
   *  shape "the runner invocation" uses. The proof that nothing was
   *  spawned is that this file never appears. */
  function stub(dir: string): { bin: string; argvFile: string } {
    const argvFile = join(dir, "runner-argv.txt");
    const bin = join(dir, "fake-run-spec");
    writeFileSync(bin, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${argvFile}\n`, { mode: 0o755 });
    return { bin, argvFile };
  }

  /** A git that answers `isMerged` per repo root. `unmerged` names the
   *  roots where the dependency's branch still has commits of its own;
   *  everywhere else it is an ancestor of the default branch. Read
   *  through a function, so one test can watch the answer change under a
   *  live server. */
  function gitFor(unmerged: () => string[]) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      // The branch IS on origin — absence is the other way a dependency
      // counts as merged, and this suite is about the ancestry answer.
      if (a.startsWith("ls-remote")) return { code: 0, stdout: "abc123\trefs/heads/x\n" };
      if (a.startsWith("merge-base --is-ancestor")) {
        return { code: unmerged().includes(dir) ? 1 : 0, stdout: "" };
      }
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  const queueImplement = (base: string) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });

  /** Long enough for a spawn to have written its file: the runner ticks
   *  on the enqueue itself, so a job that was going to start has started
   *  well before this returns. */
  const settle = () => Bun.sleep(400);

  function own(prefix: string) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    return dir;
  }

  test("an implement job whose dependency is unmerged never invokes the runner", async () => {
    const dir = own("aide-queue-parked-");
    const { bin, argvFile } = stub(dir);
    const paths = root(dir);
    const git = gitFor(() => [paths.project, paths.specs]);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: git.run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    expect(existsSync(argvFile)).toBe(false);

    const listed = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as {
      jobs: { state: string; error?: string }[];
    };
    expect(listed.jobs[0].state).toBe("queued");
    expect(listed.jobs[0].error).toContain("80-dependency");
  });

  test("a dependency merged in one root but not the other still parks the job", async () => {
    const dir = own("aide-queue-parked-two-");
    const { bin, argvFile } = stub(dir);
    const paths = root(dir);
    // Merged in the project checkout, still open in the specs repo.
    const git = gitFor(() => [paths.specs]);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: git.run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    expect(existsSync(argvFile)).toBe(false);
    // Both roots were actually asked — a check that stopped at the
    // project would have started this job.
    expect(git.calls.some((c) => c.dir === paths.project)).toBe(true);
    expect(git.calls.some((c) => c.dir === paths.specs)).toBe(true);
  });

  // Criterion 10 (spec 149). The gate's code is unchanged, but what
  // satisfies it has moved: a dependency's ANALYZE lands itself now, so
  // its specs-repo branch merges early — and that must not read as "the
  // dependency is done". Only the ARCHIVE that lands its code releases a
  // dependent, because since spec 149 that is the only point a spec's
  // code branch reaches a default branch at all.
  //
  // Three servers over one mirror, rather than one server watching the
  // answer change: each merge answer is cached for 30 s, and this test
  // is about which ANSWER releases the job, not about when a cache
  // expires.
  test("only the dependency's archive releases the parked job — its analyze does not", async () => {
    const dir = own("aide-queue-release-");
    const paths = root(dir);
    const mirror = join(dir, "queue.json");
    const common = {
      queueToken: TOKEN,
      projectRoot: paths.root,
      queueProjectRoot: paths.root,
      queueMirrorPath: mirror,
    };

    // The dependency's own finished job, recorded through a server with
    // no runner: it must leave a branch behind without ever running.
    const { base: seeder } = harness.start({
      extra: { ...common, gitRun: gitFor(() => [paths.project, paths.specs]).run },
    });
    const dep = (await (
      await fetch(`${seeder}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: "80-dependency", steps: ["analyze"] }),
      })
    ).json()) as { job: { id: string } };
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const stored = jobs.find((j) => j.id === dep.job.id)!;
    stored.state = "done";
    stored.branchUrls = [
      { root: paths.project, url: "https://example.test/aide" },
      { root: paths.specs, url: "https://example.test/aide-specs" },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));

    /** One server's answer to "does this dependent start?", with the
     *  dependency's branch merged in exactly the named roots. `waitMs`
     *  is how long to give it: a refused enqueue does not tick the
     *  runner, so a job already in the mirror waits for the server's own
     *  2 s interval — worth waiting out when a start is expected, worth
     *  not waiting out three times over when one is not. */
    async function startsWith(unmerged: string[], prefix: string, waitMs = 800): Promise<boolean> {
      const runDir = own(prefix);
      const { bin, argvFile } = stub(runDir);
      const { base } = harness.start({
        extra: {
          ...common,
          queueRunnerBin: bin,
          queueResultDir: join(runDir, "jobs"),
          gitRun: gitFor(() => unmerged).run,
        },
      });
      const posted = await queueImplement(base);
      // The dependent's own job is enqueued once and lives in the shared
      // mirror; a later server finds it already there and refuses a
      // second copy, which is not what this test is asking about.
      expect([200, 400]).toContain(posted.status);
      for (let i = 0; i * 100 < waitMs && !existsSync(argvFile); i++) await Bun.sleep(100);
      return existsSync(argvFile);
    }

    // Nothing landed: parked, as spec 122 already had it.
    expect(await startsWith([paths.project, paths.specs], "aide-queue-release-none-")).toBe(false);
    // The dependency's analyze self-landed — the specs repo is merged
    // and the code is not. Still parked.
    expect(await startsWith([paths.project], "aide-queue-release-analyzed-")).toBe(false);
    // Archived: the code landed too, and the dependent starts.
    expect(await startsWith([], "aide-queue-release-archived-", 6000)).toBe(true);
  }, 20000);

  test("a parked job's row shows the queued badge and the reason it is held back", async () => {
    const dir = own("aide-queue-parked-row-");
    const { bin } = stub(dir);
    const paths = root(dir);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: gitFor(() => [paths.project, paths.specs]).run,
      },
    });
    expect((await queueImplement(base)).status).toBe(200);
    await settle();
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    // The ordinary queued badge, with the reason underneath it — no
    // seventh badge variant and no new job state were introduced.
    expect(html).toContain('badge b-idle">queued');
    expect(html).toContain("held back: depends on 80-dependency");
  });

  test("cancelling a parked job cancels it like any other queued job", async () => {
    const dir = own("aide-queue-parked-cancel-");
    const { bin } = stub(dir);
    const paths = root(dir);
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        queueRunnerBin: bin,
        queueResultDir: join(dir, "jobs"),
        gitRun: gitFor(() => [paths.project, paths.specs]).run,
      },
    });
    const made = (await (await queueImplement(base)).json()) as { job: { id: string } };
    await settle();
    expect((await fetch(`${base}/api/queue/${made.job.id}/cancel`, { method: "POST", headers: AUTH })).status)
      .toBe(200);
    const after = (await (await fetch(`${base}/api/queue`, { headers: AUTH })).json()) as {
      jobs: { id: string; state: string }[];
    };
    expect(after.jobs.find((j) => j.id === made.job.id)?.state).toBe("cancelled");
  });
});

// Spec 125: the argv is where a tool choice becomes real. Two rules, and
// the second one is the reason this is testable at all: the flag is
// appended ONLY when the resolved tool is not claude, so every config
// that predates this spec produces byte-for-byte the argv it always did.
describe("a model choice's tool reaches the runner", () => {
  const job = (model: Record<string, string>) =>
    ({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["implement"],
      budgetUsd: 15,
      timeoutSec: 2700,
      permissionMode: { implement: "bypassPermissions" },
      model,
    }) as unknown as Parameters<typeof import("../src/serve.ts").runnerArgv>[0];

  test("a codex choice passes --tool and its own model name", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const argv = runnerArgv(job({ implement: "codex-fast" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      modelChoices: { "codex-fast": { budgetUsd: 5, tool: "codex", model: "gpt-5.6" } },
    });
    expect(argv[argv.indexOf("--tool") + 1]).toBe("codex");
    // The real model, not the picker's display key.
    expect(argv[argv.indexOf("--model") + 1]).toBe("gpt-5.6");
    expect(argv).not.toContain("codex-fast");
  });

  test("a choice with no model of its own keeps using its key", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const argv = runnerArgv(job({ implement: "codex-fast" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      modelChoices: { "codex-fast": { budgetUsd: 5, tool: "codex" } },
    });
    expect(argv[argv.indexOf("--model") + 1]).toBe("codex-fast");
  });

  test("a choice with no tool field is claude, and the argv is unchanged", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const before = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", o);
    const after = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", {
      ...o,
      modelChoices: { opus: { budgetUsd: 15 } },
    });
    expect(after).not.toContain("--tool");
    expect(after).toEqual(before);
    expect(after[after.indexOf("--model") + 1]).toBe("opus");
  });

  test("a server with no choices configured at all still runs claude", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const argv = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv).not.toContain("--tool");
  });
});

// --- spec 152: the wall clock is per step, and a stand-in cost says so -------
//
// 149's implement was killed at its own 45-minute limit with its tests
// already green, and was booked at the full budget because a SIGKILLed
// run prints no usage. Two seams in this file carried that: the argv the
// runner is started with (one number for every step), and the `Job` →
// `QueueRowView` mapping, which dropped `costMeasured` on the floor so
// the totals built on it could not tell a measurement from a ceiling.
describe("a step's own time limit reaches the runner", () => {
  const jobWith = (timeoutSec: unknown, steps: string[] = ["analyze", "implement"]) =>
    ({
      project: "aide", specFolder: "81-queue-and-runner", steps,
      budgetUsd: 3, timeoutSec, permissionMode: {}, model: {},
    }) as unknown as Parameters<typeof import("../src/serve.ts").runnerArgv>[0];

  const timeoutArg = (argv: string[]): string => argv[argv.indexOf("--timeout-sec") + 1]!;

  test("an implement is spawned with implement's number, not default's", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const job = jobWith({ analyze: 1200, implement: 5400 });
    expect(timeoutArg(runnerArgv(job, "implement", "/tmp/r.json", o))).toBe("5400");
    expect(timeoutArg(runnerArgv(job, "analyze", "/tmp/r.json", o))).toBe("1200");
  });

  // A job created before the shape changed is still sitting in the
  // store across the deploy. Read as an index it would give `undefined`
  // and the runner would be handed the string "undefined" as its
  // deadline — a crash-adjacent read, not a cosmetic one.
  test("a job persisted with the old flat number is still given a real deadline", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const argv = runnerArgv(jobWith(2700), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(timeoutArg(argv)).toBe("2700");
  });

  test("a step the table does not name falls to its default", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const argv = runnerArgv(jobWith({ default: 1200, implement: 5400 }, ["archive"]), "archive", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(timeoutArg(argv)).toBe("1200");
  });

  // Spec 177: the shape `parseJobRequest` actually produces. `perStep`
  // resolves the config's `default` into a concrete entry for each step
  // the request named, so a job's own table never carries a `default`
  // key of its own — and a step ticked onto the tail afterwards (spec
  // 160) has no entry at all. Both fallbacks above are therefore
  // `undefined` for it, and the runner is handed the string
  // "undefined" as its deadline.
  test("a tail-added step the job's table cannot name falls to the live config", async () => {
    const { resolveTimeoutSec } = await import("../src/serve.ts");
    const live = { default: 1200, implement: 5400 };
    expect(resolveTimeoutSec({ analyze: 1200 }, "implement", live)).toBe(5400);
    expect(resolveTimeoutSec({ analyze: 1200 }, "archive", live)).toBe(1200);
  });

  test("the argv for a tail-added step carries a real number, not \"undefined\"", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const argv = runnerArgv(jobWith({ analyze: 1200 }, ["analyze", "implement"]), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
      timeoutSec: { default: 1200, implement: 5400 },
    });
    expect(timeoutArg(argv)).toBe("5400");
  });
});

// --- spec 177: a step added later brings its settings with it ---------------
//
// Spec 160 lets a reader tick a phase onto a job that is already
// running. The job's three per-step tables are built at CREATION from
// the steps it had then, so the added step has no entry in any of them
// — and each miss costs something different when the step comes up:
// no deadline, `acceptEdits` where `implement` needs bypassPermissions
// (specs 105 and 112 were each stamped-but-not-moved by exactly that),
// and no `--model` flag at all.
describe("a tail-added step is spawned on the same terms as its siblings", () => {
  const jobWith = (over: Record<string, unknown> = {}) =>
    ({
      project: "aide", specFolder: "81-queue-and-runner",
      steps: ["analyze", "implement"], budgetUsd: 3,
      timeoutSec: { analyze: 1200 }, permissionMode: { analyze: "acceptEdits" },
      model: { analyze: "sonnet" },
      ...over,
    }) as unknown as Parameters<typeof import("../src/serve.ts").runnerArgv>[0];

  const base = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
  const live = {
    timeoutSec: { default: 1200, implement: 5400 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
  };

  test("it gets the config's permission mode, not the acceptEdits literal", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const argv = runnerArgv(jobWith(), "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
  });

  test("it gets the config's model, instead of no --model flag at all", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const argv = runnerArgv(jobWith(), "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
  });

  // A whole-job pick is already copied into every ORIGINAL step's own
  // `model` entry at creation, so a step added afterwards has to match
  // its siblings rather than fall through to what the config says for
  // that step in isolation.
  test("a whole-job model choice still wins over the config's per-step default", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const job = jobWith({ modelChoice: "sonnet", model: { analyze: "sonnet" } });
    const argv = runnerArgv(job, "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--model") + 1]).toBe("sonnet");
  });

  // Criterion 7: the fallback never overrides an entry the job already
  // has. Every step present at creation keeps running on exactly the
  // terms it was created with, config changes since then included.
  test("a step the job's own table names is untouched by the fallback", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const job = jobWith({
      timeoutSec: { analyze: 900 }, permissionMode: { analyze: "plan" }, model: { analyze: "haiku" },
    });
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--timeout-sec") + 1]).toBe("900");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(argv[argv.indexOf("--model") + 1]).toBe("haiku");
  });
});

describe("an over-charged cost survives the row mapping", () => {
  async function seeded(costMeasured: boolean): Promise<string> {
    const { base, dir } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST", headers, body: JSON.stringify({ ...JOB, steps: ["implement"] }),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "stopped";
    job.stopReason = "timeout";
    job.spentUsd = 35;
    job.results = [
      {
        step: "implement", ok: false, costUsd: 35, costMeasured,
        terminalReason: "timeout", at: "2026-08-21T07:58:00Z",
      },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  }

  const MARKER = '<span class="muted small">est.</span>';

  test("the spec row marks a total it could not measure", async () => {
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: await seeded(false) });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(specHead(html, "81-queue-and-runner")).toContain(MARKER);
  });

  test("a measured total through the same seam carries no mark", async () => {
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: await seeded(true) });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    const head = specHead(html, "81-queue-and-runner");
    expect(head).toContain("$35.00");
    expect(head).not.toContain(MARKER);
  });
});

// --- spec 160: a later phase can be added while the job runs ------------------

// Not a second job for the same spec — the clash check refuses that,
// and rightly. This is an edit to the job that exists, so it has a
// route of its own, and every decision it makes is against the job as
// it stands at that instant rather than against whatever the page
// believed when the box was ticked.
describe("POST /api/queue/:id/steps (spec 160)", () => {
  const JSON_HEADERS = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  /** One job in the mirror, RUNNING the step at `stepIndex`, served by
   *  a second server started on that mirror. No runner is configured,
   *  so nothing reconciles the seeded state out from under the test —
   *  the same trick the view-carrying suite above uses for Cancel. */
  async function running(
    steps: string[],
    stepIndex = 0,
    opts: { description?: string; alsoSpecs?: string[] } = {},
  ): Promise<{ base: string; id: string }> {
    const first = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${first.base}/api/queue`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...JOB, steps }),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(first.dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "running";
    job.stepIndex = stepIndex;
    writeFileSync(mirror, JSON.stringify(jobs));
    const second = harness.start({
      extra: { queueToken: TOKEN, queueMirrorPath: mirror },
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.alsoSpecs ? { alsoSpecs: opts.alsoSpecs } : {}),
    });
    return { base: second.base, id: made.job.id };
  }

  const edit = (base: string, id: string, step: string, checked: boolean, body?: BodyInit) =>
    fetch(`${base}/api/queue/${id}/steps`, {
      method: "POST",
      headers: body
        ? { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "x-aide-token": TOKEN }
        : JSON_HEADERS,
      body: body ?? JSON.stringify({ step, checked }),
    });

  const stepsOf = async (base: string, id: string): Promise<string[]> => {
    const listed = (await (await fetch(`${base}/api/queue`, { headers: JSON_HEADERS })).json()) as {
      jobs: { id: string; steps: string[] }[];
    };
    return listed.jobs.find((j) => j.id === id)!.steps;
  };

  test("a later step is added, in workflow order (criterion 1)", async () => {
    const { base, id } = await running(["analyze"]);
    const res = await edit(base, id, "archive", true);
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean; job: { steps: string[] } };
    expect(answer.ok).toBe(true);
    expect(answer.job.steps).toEqual(["analyze", "archive"]);
    expect((await edit(base, id, "implement", true)).status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "implement", "archive"]);
  });

  test("a not-yet-started step is removed (criterion 2)", async () => {
    const { base, id } = await running(["analyze", "implement", "archive"]);
    expect((await edit(base, id, "implement", false)).status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  test("the form encoding the page posts is understood too", async () => {
    const { base, id } = await running(["analyze"]);
    const res = await edit(base, id, "", false, new URLSearchParams({ step: "archive", checked: "1" }));
    expect(res.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
    const off = await edit(base, id, "", false, new URLSearchParams({ step: "archive", checked: "0" }));
    expect(off.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze"]);
  });

  test("the running step is refused, by name (criterion 3)", async () => {
    const { base, id } = await running(["analyze", "archive"], 1);
    const res = await edit(base, id, "archive", false);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("archive");
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  // The page drew `implement` as a live box; by the time the tick
  // arrived the runner had walked onto it. The server answers about the
  // job it has, not about the one the page remembers.
  test("a step the runner has walked past since the page drew it is refused (criterion 4)", async () => {
    const { base, id } = await running(["analyze", "implement"], 1);
    const res = await edit(base, id, "implement", false);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("implement");
    expect(await stepsOf(base, id)).toEqual(["analyze", "implement"]);
  });

  test("a job that is not running is refused (criterion 6)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await edit(base, made.job.id, "implement", true);
    expect(res.status).toBe(400);
    expect(await stepsOf(base, made.job.id)).toEqual(["analyze"]);
  });

  test("a step earlier than the one running is refused (criterion 9)", async () => {
    const { base, id } = await running(["implement", "archive"]);
    const res = await edit(base, id, "analyze", true);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("analyze");
    expect(await stepsOf(base, id)).toEqual(["implement", "archive"]);
  });

  test("an unknown job is a 404, and GET is not a way in", async () => {
    const { base, id } = await running(["analyze"]);
    expect((await edit(base, "nope", "archive", true)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/queue/${id}/steps`, { headers: JSON_HEADERS })).status,
    ).toBe(405);
  });

  // Criterion 5. The gate is not the route's question: a gated step
  // added to a tail is accepted the same way one named at job creation
  // is, and is held back only once it becomes the job's current step —
  // which is what `runner.test.ts` pins from the other side.
  test("a gated step is accepted even though the spec's dependency has not landed", async () => {
    const { base, id } = await running(["analyze"], 0, {
      description: "# Queue - Description\n\n## Tracking info\n\n- **Depends on:** `80-dependency`\n",
      alsoSpecs: ["80-dependency"],
    });
    const res = await edit(base, id, "archive", true);
    expect(res.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  // The other half of the wiring: the row the reader is looking at has
  // to draw those boxes live, and point them at this route.
  test("the row draws the live boxes and points them here", async () => {
    const { base, id } = await running(["analyze"]);
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    const group = specControls(html, "81-queue-and-runner");
    expect(group).toContain(`data-post-to="/api/queue/${id}/steps"`);
    const live = (step: string) =>
      (group.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "");
    expect(live("archive")).toContain("data-post-to");
    expect(live("archive")).not.toContain("disabled");
    expect(live("analyze")).toContain("disabled");
  });
});

// Spec 205: the dashboard works in checkouts of its own.
//
// A run was cut from the same checkout a person edits, and the two
// collided — on 2026-08-23 three specs were archived with their code
// stranded on a branch. Everything that MUTATES a checkout now resolves
// to a clone the dashboard owns; the person's own checkout at
// `<projectsRoot>/<project>` is what the display reads and nothing else.
//
// Real git here, unlike the rest of this suite: what is under test is
// which working tree a commit lands in, and a fake that ignores the
// directory it was handed could not tell the two apart.
describe("the dashboard works in checkouts of its own (spec 205)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  function git(cwd: string, ...args: string[]): string {
    const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
    return out.stdout.toString();
  }

  /** A projects root holding ONE real project — a bare origin, and a
   *  clone of it standing in for the checkout a person edits. The
   *  harness's own fixture is a plain directory, and this suite needs a
   *  repository with a remote to clone from. */
  function realProject(): { projectsRoot: string; person: string; owned: string; site: string } {
    const where = mkdtempSync(join(tmpdir(), "aide-205-"));
    ownDirs.push(where);
    const seed = join(where, "seed");
    mkdirSync(join(seed, ".aide"), { recursive: true });
    writeFileSync(join(seed, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(seed, "specs", "81-queue-and-runner"), { recursive: true });
    writeFileSync(join(seed, "specs", "81-queue-and-runner", "1-description.md"), "# Queue - Description\n\nAs it was.\n");
    writeFileSync(join(seed, "specs", "81-queue-and-runner", "4-status.md"), statusSaying(["create"]));
    git(seed, "init", "-q", "-b", "main");
    git(seed, "config", "user.name", "Test");
    git(seed, "config", "user.email", "test@example.com");
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", "first");
    const origin = join(where, "aide.git");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", seed, origin] });
    const projectsRoot = join(where, "root");
    mkdirSync(projectsRoot, { recursive: true });
    const person = join(projectsRoot, "aide");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, person] });
    git(person, "config", "user.name", "Test");
    git(person, "config", "user.email", "test@example.com");
    const site = join(where, "site");
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, "projects.html"), "<p>overview</p>");
    return { projectsRoot, person, owned: join(where, "owned"), site };
  }

  /** The real runner, wrapped so a test can say which directories the
   *  server ran git in. */
  function recording(): { run: GitRunner; calls: { dir: string; args: string[] }[] } {
    const real = createGitRunner();
    const calls: { dir: string; args: string[] }[] = [];
    return {
      calls,
      run: async (dir, args) => {
        calls.push({ dir, args });
        return real(dir, args);
      },
    };
  }

  // Criterion 6, and the whole point: `--project-dir` is what decides
  // which checkout a run branches, switches and cuts its worktree from.
  test("the runner is pointed at the dashboard's own checkout, never the person's", () => {
    const job = {
      id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
      budgetUsd: 5, model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide-dashboard-checkouts/aide/code",
      push: "branch",
    });
    expect(argv[argv.indexOf("--project-dir") + 1]).toBe("/home/dev/aide-dashboard-checkouts/aide/code");
  });

  // Named on the command line, because the serving host is where these
  // clones actually take up disk and the default is a directory under
  // $HOME.
  test("the checkout root is a flag, and defaults to nothing the server invents", () => {
    expect(parseArgs(["--site", "/s", "--dashboard-checkouts", "/data/owned"]).dashboardCheckoutRoot).toBe(
      "/data/owned",
    );
    expect(parseArgs(["--site", "/s"]).dashboardCheckoutRoot).toBeUndefined();
  });

  // Criterion 8: eagerly, so no project ever pays a full clone inside
  // the request that first needs it.
  test("Add makes the dashboard's own checkout before anything asks for one", async () => {
    const { projectsRoot, site, owned } = realProject();
    const originOfSecond = join(projectsRoot, "..", "aide.git");
    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name: "second", gitUrl: originOfSecond }),
      });
      expect(res.status).toBe(200);
      expect(existsSync(join(owned, "second", "code", ".git"))).toBe(true);
    } finally {
      server.stop();
    }
  });

  // Criteria 1, 2 and 4, in the shape of the incident itself: the
  // person is mid-edit on a branch of their own when the dashboard
  // writes.
  test("a Save writes in the dashboard's own checkout and leaves the person's alone", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    // Exactly what a run used to refuse over, and used to trample.
    git(person, "switch", "-q", "-c", "wip");
    writeFileSync(join(person, "specs", "81-queue-and-runner", "1-description.md"), "# Mine, half-written\n");
    const before = git(person, "status", "--porcelain=v1", "--branch");
    const recorded = recording();
    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, gitRun: recorded.run,
    });
    try {
      // Through the form, not around it: the hidden `baseSha` is the
      // commit the save compares against, and reading it off the page
      // proves the form and the save agree about WHICH checkout that
      // commit came out of.
      const form = await (
        await fetch(`http://127.0.0.1:${server.port}/specs/aide/81-queue-and-runner?tab=description`, {
          headers: { "x-aide-token": TOKEN },
        })
      ).text();
      const baseSha = /name="baseSha" value="([^"]*)"/.exec(form)?.[1] ?? "";
      expect(baseSha).not.toBe("");
      const res = await fetch(
        `http://127.0.0.1:${server.port}/api/queue/specs/aide/81-queue-and-runner/save`,
        {
          method: "POST",
          headers: { "x-aide-token": TOKEN, "content-type": "application/json" },
          redirect: "manual",
          body: JSON.stringify({
            text: "# Queue - Description\n\n## Description\n\nSaved by the dashboard.\n",
            baseSha,
          }),
        },
      );
      expect(res.status).toBe(303);
      // The dashboard's own copy carries the edit...
      const saved = join(owned, "aide", "code", "specs", "81-queue-and-runner", "1-description.md");
      expect(readFileSync(saved, "utf-8")).toContain("Saved by the dashboard");
      // ...and the person's half-written file is still theirs, on their
      // own branch, with nothing committed under them.
      expect(readFileSync(join(person, "specs", "81-queue-and-runner", "1-description.md"), "utf-8")).toBe(
        "# Mine, half-written\n",
      );
      expect(git(person, "status", "--porcelain=v1", "--branch")).toBe(before);
      // And nothing their directory was ever asked can CHANGE it.
      //
      // The one question this design rests on is still there — which
      // origin to clone the dashboard's own checkout from — and since
      // spec 208 the cache schedule asks the person's spec folders the
      // same read-only questions the page render used to ask them
      // inside a request. That is the same reading, on a clock; what
      // spec 205 exists to prevent is a WRITE, and the list below is
      // every verb that would be one.
      const asked = recorded.calls
        .filter((c) => c.dir === person || c.dir.startsWith(`${person}/`))
        .map((c) => c.args.join(" "));
      expect(asked).toContain("remote get-url origin");
      const writes = ["checkout", "switch", "merge", "commit", "push", "add", "fetch", "reset", "clean"];
      expect(asked.filter((a) => writes.includes(a.split(" ")[0]!))).toEqual([]);
    } finally {
      server.stop();
    }
  });
});

// Spec 208: a render reads memory and disk, and nothing else.
//
// This has been introduced three times — spec 178 wrote the rule and
// was never merged, spec 203 fixed `/projects`, and spec 193 put a
// network `ls-remote` back on `/` the next day. So it is asserted here
// rather than left to care: the request path spawns NO git, warm or
// cold, and a cold page says what it does not know instead of holding
// the reader.
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

  // Criterion 8.
  test("cold, GET /archive renders with a checking date rather than blocking on git", async () => {
    const git = recording();
    const { base } = harness.start({
      extra: { gitRun: git.run, queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0 },
      // No `Archived:` stamp on disk, so the date is git's to answer —
      // which is exactly the row that used to reach `lastCommitOf`.
      archivedSpecs: { "77-old-thing": { status: "# Status\n" } },
    });
    const before = git.calls.length;
    const res = await get(base, "/archive");
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
});
