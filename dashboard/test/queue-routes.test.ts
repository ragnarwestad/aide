// Criterion 9 (spec 81): the queue surface is behind the token — read
// routes included — while /live and POST /api/aide-run stay open. A
// token that a page hands to anyone who can load the page is not a
// secret, so GET /queue is checked too.
//
// /queue carries page code; /live and the generated pages do not —
// not by rule, but because they have nothing that needs it. /queue has
// a form, and a meta refresh every ten seconds would wipe whatever
// someone was half-way through filling in.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerOptions } from "../src/serve.ts";
import { renderQueuePage, type QueuePageOptions, type QueueRowView } from "../src/render.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";

const harness = queueHarness("aide-queue-routes-");

const start = (extra: Partial<ServerOptions> = {}, alsoProjects: string[] = []) =>
  harness.start({ extra, alsoProjects });

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const JOB = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

describe("no token configured", () => {
  test("every queue route is 503; /live and POST /api/aide-run are unaffected", async () => {
    const { base } = start();
    for (const [path, init] of [
      ["/queue", {}],
      ["/specs", {}],
      ["/specs/abc", {}],
      ["/api/queue", {}],
      ["/api/queue/abc/approve", { method: "POST" }],
      ["/api/queue/abc/cancel", { method: "POST" }],
    ] as const) {
      const res = await fetch(`${base}${path}`, init);
      expect(res.status).toBe(503);
      expect((await res.text()).toLowerCase()).toContain("token");
    }
    expect((await fetch(`${base}/live`)).status).toBe(200);
    expect((await fetch(`${base}/`)).status).toBe(200);
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
    expect((await fetch(`${base}/queue`)).status).toBe(401);
    expect((await fetch(`${base}/specs`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`, { method: "POST", body: JSON.stringify(JOB) })).status).toBe(401);
    expect((await fetch(`${base}/queue?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/specs?token=wrong`)).status).toBe(401);
  });

  test("the spec 80 emitter route stays open — a 401 there would empty /live silently", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "analyze", spec: "81" }),
    });
    expect(res.status).toBe(200);
    expect((await fetch(`${base}/live`)).status).toBe(200);
  });

  test("GET /specs?token=… returns 200 and sets an HttpOnly cookie; the cookie then suffices", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const jar = cookie.split(";")[0];
    expect((await fetch(`${base}/specs`, { headers: { cookie: jar } })).status).toBe(200);
  });

  test("the header works for API callers", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jobs: [] });
  });

  test("a form POST answers 303 to /specs; a JSON caller gets JSON", async () => {
    const { base } = start({ queueToken: TOKEN });
    const form = await fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
    });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/specs");

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

  test("cancel marks the job cancelled; approve releases a gate back to queued", async () => {
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
describe("the page moved from /queue to /specs (criteria 7-9, 12)", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };

  test("GET /queue redirects to /specs with the query string intact (criterion 7)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/queue?token=${TOKEN}&state=active&sort=cost`, {
      ...auth,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/specs?token=${TOKEN}&state=active&sort=cost`);
  });

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

  test("the renamed page says Specs in its nav, heading and title (criterion 9)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/specs`, auth)).text();
    expect(html).toContain("<title>Specs</title>");
    expect(html).toContain("<h1>Specs</h1>");
    expect(html).toContain('<a class="current" href="/specs">Specs</a>');
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
      [{ label: "Overview", path: "index.html" }],
      { runnerAvailable: true, targets: [{ project: "aide", specFolder: "87-run-from-the-list" }] },
    );
    // Attribute values and the stylesheet are addresses and identifiers
    // — `action="/api/queue"`, `class="enqueue"` — never read by anyone.
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

    const approve = await fetch(`${base}/api/queue/${id}/approve`, {
      method: "POST", headers, redirect: "manual",
    });
    // A queued job cannot be approved — the same 409 as before the rename.
    expect(approve.status).toBe(409);
    const cancel = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST", headers, redirect: "manual",
    });
    expect(cancel.status).toBe(200);
  });
});

// The phase line is where you SEE that a step has not run; spec 87 makes
// it where you run it. One step, one job, on the model the line picked.
describe("running one phase from its own line (criteria 1-4, 11)", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
  const CHOICES = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: 1200,
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  /** Exactly what the sub-row's form posts: no target, no gate, no caps. */
  const postSubRow = (base: string, fields: Record<string, string>) =>
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

  test("the sub-row's fields queue that one step, on the model it picked (criteria 1-3)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await postSubRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "implement",
      model: "fable",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: { steps: string[]; gateAfter: string[]; model: Record<string, string> };
    };
    expect(body.job.steps).toEqual(["implement"]);
    expect(body.job.model).toEqual({ implement: "fable" });
    // No gate control on the line, and none is meant: a one-step job has
    // nothing to gate between.
    expect(body.job.gateAfter).toEqual([]);
  });

  test("the default option queues no override at all (criterion 4)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await postSubRow(base, {
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

  test("the top form still offers all four steps — it is the way a spec starts (criterion 11)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/specs`, auth)).text();
    for (const step of ["analyze", "review-plan", "implement", "archive"]) {
      expect(html).toContain(`<input type="checkbox" name="steps" value="${step}"`);
    }
  });

  // Spec 87's criterion 10 said the opposite — "a spec nothing has ever
  // run gets no row, so the form is its only way in". Spec 90 reverses
  // it deliberately: the dropdown and the list held the same things, and
  // a spec crossing from one to the other told the reader nothing.
  test("a spec nothing has ever run is a row, and analyze starts from it (spec 90, criterion 16)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/specs`, auth)).text();
    // Still offered by the form's dropdown — the form stays as the way
    // to queue several steps as one gated job.
    expect(html).toContain('<option value="aide/81-queue-and-runner"');
    expect(html).toContain('<tr class="spechead');
    expect(html).toContain('data-folder="81-queue-and-runner"');
    expect(html).toContain('<input type="hidden" name="steps" value="analyze">');
    expect(html).toContain('<span class="state s-not-started">not started</span>');
  });

  test("the fold survives the refresh the page performs on itself (spec 90, criterion 17)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const key = encodeURIComponent("aide/81-queue-and-runner");
    const open = await (await fetch(`${base}/specs?rows=1`, auth)).text();
    expect(open).toContain('<tr class="subrow');
    const folded = await (await fetch(`${base}/specs?rows=1&fold=${key}`, auth)).text();
    expect(folded).toContain('data-folder="81-queue-and-runner"');
    expect(folded).not.toContain('<tr class="subrow');
  });
});

describe("GET /specs (HTML)", () => {
  test("layout, forms, labels, and the runner notice", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const html = await (await fetch(`${base}/specs`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("<nav>");
    expect(html).toContain("81-queue-and-runner");
    expect(html).toContain('<form method="post"');
    expect(html).toMatch(/<a class="current" href="\/specs"/);
    // Every control says what it is: an unlabelled select next to some
    // checkboxes tells the reader nothing.
    expect(html).toContain("Run a spec");
    expect(html).toContain("Steps, in order");
    expect(html).toContain("stop for approval between steps");
    // 81a ships no runner: the page must say so rather than leave a
    // job sitting in "queued" with no explanation.
    expect(html.toLowerCase()).toContain("no runner");
  });

  test("the blunt meta refresh is a no-JS fallback, not the mechanism", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/specs`, { headers: { "x-aide-token": TOKEN } })).text();
    // A page with a form must not reload underneath someone filling it
    // in; the script swaps the table body instead.
    expect(html).toContain("<noscript><meta http-equiv=\"refresh\"");
    expect(html).toContain("<script");
    expect(html).toContain('id="jobrows"');
  });

  test("/live and the generated pages carry no page code — they need none", async () => {
    const { base } = start({ queueToken: TOKEN });
    const live = await (await fetch(`${base}/live`)).text();
    expect(live).not.toContain("<script");
    expect(live).toContain('http-equiv="refresh"');
    const { renderSite } = await import("../src/render.ts");
    for (const page of renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "x")) {
      expect(page.html).not.toContain("<script");
    }
  });

  test("?rows=1 returns the table body alone, for the script to swap in", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (await fetch(`${base}/specs?rows=1`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(rows).toContain("<tr");
    expect(rows).toContain("81-queue-and-runner");
    expect(rows).not.toContain("<html");
    // The top form is what must not come along — a swap that replaced it
    // would wipe what someone was half-way through filling in. The phase
    // lines' own run forms are part of the table and belong here.
    expect(rows).not.toContain('class="enqueue"');
  });

  test("the gate checkbox decides: unticked runs straight through", async () => {
    const { base } = start({ queueToken: TOKEN });
    const post = (body: URLSearchParams) =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
        body,
      });
    await post(new URLSearchParams({ target: "aide/81-queue-and-runner", steps: "analyze" }));
    // A different step: the same one twice is refused, and that is a
    // separate rule with its own tests. The gate flag is what this one
    // is about.
    const params = new URLSearchParams({ target: "aide/81-queue-and-runner", steps: "implement" });
    params.append("gate", "on");
    await post(params);
    const listed = (await (
      await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })
    ).json()) as { jobs: { gateAfter: string[] }[] };
    // Newest first: the gated one, then the straight-through one.
    expect(listed.jobs[0].gateAfter).toEqual(["implement"]);
    expect(listed.jobs[1].gateAfter).toEqual([]);
  });

  test("generated pages carry the Specs nav entry", async () => {
    const { renderSite } = await import("../src/render.ts");
    const pages = renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "2026-08-16");
    for (const p of pages) expect(p.html).toContain('<a href="/specs">Specs</a>');
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
        row("awaiting-approval"),
        row("done"),
        row("cancelled"),
        row("interrupted"),
      ],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "index.html" }],
      { runnerAvailable: false, targets: [] },
    );
    expect(html).toContain("stopped — budget");
    expect(html).toContain("stopped — 20 min");
    expect(html).toContain("failed");
    expect(html).toContain("waiting for approval");
    expect(html).not.toContain("stopped — failed");
  });
});

describe("the page answers the selection", () => {
  test("the chosen spec's title, phase and progress are on the page and in the data block", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // Give the spec a status file the page can summarise.
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"),
      "# Queue - Status\n\n**Total progress:** `64% (14 of 22 completed)`\n\n## Phase 2: GREEN\n\n| t | ⬜ |\n",
    );
    const html = await (await fetch(`${base}/specs`, { headers: { "x-aide-token": TOKEN } })).text();
    // Rendered for the first option, so it is there before any script runs.
    expect(html).toContain("Queue - Status".replace(" - Status", ""));
    expect(html).toContain("64% done");
    expect(html).toContain("Phase 2: GREEN");
    // And as data, so changing the selection can update it without a
    // round trip.
    expect(html).toContain('id="targetdata"');
    expect(html).toMatch(/"percent":\s*64/);
  });

  test("state is a chip with its own class, so a failure is not a wall of grey", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (await fetch(`${base}/specs?rows=1`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(rows).toContain('class="state s-queued"');
    expect(rows).toContain("queued");
  });
});

describe("page code placement", () => {
  test("the script comes AFTER the elements it wires up", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/specs`, { headers: { "x-aide-token": TOKEN } })).text();
    const select = html.indexOf('id="target"');
    const rows = html.indexOf('id="jobrows"');
    const script = html.indexOf("<script>");
    expect(select).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(-1);
    // An inline script in <head> runs before the DOM exists, so every
    // listener attaches to nothing — and the failure is silent.
    expect(script).toBeGreaterThan(select);
    expect(script).toBeGreaterThan(rows);
    expect(html.indexOf("</head>")).toBeLessThan(script);
  });
});

describe("the step boxes follow the spec", () => {
  test("a step the spec has already had is marked done and left unticked", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "2-analysis.md"), "# Analysis\n\n" + "Findings, at length. ".repeat(40));
    writeFileSync(join(spec, "3-solution.md"), "# Solution\n\n## Plan review\n\nReviewed.\n");
    const html = await (await fetch(`${base}/specs`, { headers: { "x-aide-token": TOKEN } })).text();
    // analyze and review-plan are done; implement is what you came for.
    expect(html).toMatch(/data-step="analyze"[^]*?<input type="checkbox" name="steps" value="analyze">/);
    expect(html).toMatch(/data-step="implement"[^]*?value="implement" checked/);
    expect(html).toContain('class="stepbox isdone" data-step="analyze"');
    expect(html).toMatch(/"done":\["analyze","review-plan"\]/);
  });

  test("a fresh spec offers analyze first", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "2-analysis.md"),
      "# Analysis\n\n[filled in by /aide-analyze]\n",
    );
    const html = await (await fetch(`${base}/specs`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toMatch(/value="analyze" checked/);
    expect(html).not.toContain('class="stepbox isdone"');
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

describe("what the queue has run counts too", () => {
  test("a step the queue completed is marked done, whatever the percentage says", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    // Analysed and reviewed already; the status says 95% because the
    // remaining task is the USER's, not the machine's.
    writeFileSync(join(spec, "2-analysis.md"), "# Analysis\n\n" + "Findings, at length. ".repeat(40));
    writeFileSync(join(spec, "3-solution.md"), "# Solution\n\n## Plan review\n\nReviewed.\n");
    writeFileSync(join(spec, "4-status.md"), "# Status\n\n**Total progress:** `95% (21 of 22 completed)`\n");

    // Before the queue has run it, implement is what you came for.
    let html = await (await fetch(`${base}/specs`, { headers: { "x-aide-token": TOKEN } })).text();
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
    mirror[0].results = [
      { step: "implement", ok: true, costUsd: 12.34, costMeasured: true,
        terminalReason: "completed", at: "2026-08-16T18:00:00Z" },
    ];
    writeFileSync(join(dir, "queue.json"), JSON.stringify(mirror));
    expect(made.job.id).toBeTruthy();

    // A server reading that history offers the NEXT step instead.
    // Same specs, same history — a fresh process reading both.
    const second = start({
      queueToken: TOKEN,
      queueMirrorPath: join(dir, "queue.json"),
      projectRoot: join(dir, "root"),
    });
    html = await (await fetch(`${second.base}/specs`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toMatch(/value="implement" checked/);
    expect(html).toMatch(/value="archive" checked/);
    expect(html).toContain('class="stepbox isdone" data-step="implement"');
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
    timeoutSec: 1200,
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  test("the form offers the configured models, and says what each is granted", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "index.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      modelChoices: [
        { name: "sonnet", budgetUsd: 3 },
        { name: "fable", budgetUsd: 12 },
      ],
    });
    expect(html).toContain('name="model"');
    expect(html).toContain("fable");
    expect(html).toContain("$12");
    // The per-step configuration must stay reachable — picking a model
    // is an override, not the only way to queue anything.
    expect(html).toContain('value=""');
  });

  // Every option but one carried a number, and the one without it was
  // the default — so "opus — $15 per step" read as the expensive
  // choice when leaving the field alone granted $35 for the same model.
  // A comparison you cannot make is a trap, not a choice.
  test("the default option says what IT grants, so the numbers can be compared", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "index.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      modelChoices: [{ name: "fable", budgetUsd: 12 }],
      defaultBudgetUsd: 35,
    });
    expect(html).toMatch(/<option value="">[^<]*\$35[^<]*<\/option>/);
  });

  test("with no default budget known the option still stands, just without a figure", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "index.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      modelChoices: [{ name: "fable", budgetUsd: 12 }],
    });
    expect(html).toContain('value=""');
    expect(html).not.toMatch(/<option value="">[^<]*\$/);
  });

  test("with nothing configured the page offers no model at all", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "index.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    expect(html).not.toContain('name="model"');
  });

  test("a row says which model it ran on, so a cost can be read against it", () => {
    const html = renderQueuePage(
      [
        {
          id: "a", project: "aide", specFolder: "81-queue-and-runner",
          steps: ["implement"], stepIndex: 0, state: "done", spentUsd: 24.5,
          timeoutSec: 1200, createdAt: "2026-08-16T00:00:00Z", model: "fable",
        },
      ],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "index.html" }],
      { runnerAvailable: true, targets: [] },
    );
    expect(html).toContain("fable");
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
});

// A refusal has to land where the person who pressed the button can
// read it. Answering a form post with a JSON body puts the reason on a
// blank page with no way back.
describe("a refused form post says so on the page", () => {
  test("a duplicate returns to /specs carrying the reason, and the page shows it", async () => {
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
    expect(location.startsWith("/specs?")).toBe(true);
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

  const page = (rows: QueueRowView[], filter?: QueuePageOptions["filter"]) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "index.html" }], {
      runnerAvailable: true,
      targets: [],
      filter,
    });

  test("one table holds every job — no fixed section above it", () => {
    const html = page([row("a", { state: "running" }), row("b")]);
    expect(html.match(/<table class="jobs"/g)).toHaveLength(1);
    expect(html).toContain("a-spec");
    expect(html).toContain("b-spec");
  });

  test("the state filter is offered with a count on each choice", () => {
    const html = page([row("a", { state: "running" }), row("b"), row("c", { state: "failed" })]);
    expect(html).toMatch(/>All <span class="tabcount">3<\/span>/);
    expect(html).toMatch(/>Active <span class="tabcount">1<\/span>/);
    expect(html).toMatch(/>Done <span class="tabcount">1<\/span>/);
    expect(html).toMatch(/>Problems <span class="tabcount">1<\/span>/);
  });

  test("asking for active work leaves the finished jobs out", () => {
    const rows = [row("a", { state: "running" }), row("b"), row("c", { state: "awaiting-approval" })];
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

  test("the project filter appears once there is more than one project", () => {
    const rows = [row("a"), row("b", { project: "aide-dashboard" })];
    expect(page([row("a")])).not.toContain("data-filter=\"project\"");
    const html = page(rows, { project: "aide-dashboard" });
    expect(html).toContain("data-filter=\"project\"");
    expect(html).toContain("b-spec");
    expect(html).not.toContain("a-spec");
  });

  test("newest first is the default order", () => {
    const html = page([
      row("old", { startedAt: "2026-08-16T09:00:00Z" }),
      row("new", { startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    expect(html.indexOf("new-spec")).toBeLessThan(html.indexOf("old-spec"));
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

  test("sorting by spec is alphabetical", () => {
    const html = page([row("zz"), row("aa")], { sort: "spec" });
    expect(html.indexOf("aa-spec")).toBeLessThan(html.indexOf("zz-spec"));
  });

  test("a column header is a link that keeps the filter you are already in", () => {
    const html = page([row("a", { state: "running" })], { state: "active" });
    expect(html).toContain('href="/specs?state=active&amp;sort=cost"');
  });

  test("the sorted column says which way it is going", () => {
    const html = page([row("a")], { sort: "cost" });
    expect(html).toMatch(/aria-sort="descending"/);
  });

  test("a filter that matches nothing says so instead of showing a bare table", () => {
    const html = page([row("a")], { state: "active" });
    // "spec", not "job": the table has been one line per spec since
    // spec 86, and since spec 90 it lists specs that have no job at all.
    expect(html).toContain("No spec matches");
  });

  test("the list is capped, and says how many it left out", () => {
    const html = page(Array.from({ length: 29 }, (_, i) => row(`j${i}`)));
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
      await fetch(`${base}/specs?rows=1&state=active`, { headers: { "x-aide-token": TOKEN } })
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

  const page = (rows: QueueRowView[], filter?: QueuePageOptions["filter"]) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "index.html" }], {
      runnerAvailable: true,
      targets: [],
      filter,
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
    expect(html).toMatch(/>All <span class="tabcount">2<\/span>/);
    expect(html).toMatch(/>Active <span class="tabcount">1<\/span>/);
    expect(html).toMatch(/>Done <span class="tabcount">1<\/span>/);
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

  test("sorting by started uses the spec's most recent activity (criterion 13)", () => {
    const html = page([
      job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T08:00:00Z" }),
      job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T12:00:00Z" }),
      job("b1", "bb-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
    ]);
    expect(specOrder(html)).toEqual(["aa-spec", "bb-spec"]);
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

// Spec 83: a job says up front which other repos it expects to touch, so
// the run watches, commits and pushes them instead of leaving half the
// work uncommitted on the machine.
describe("passenger projects reach the runner", () => {
  test("every named project becomes an --extra-project-dir", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const job = {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["implement"],
      budgetUsd: 15,
      timeoutSec: 2700,
      permissionMode: { implement: "bypassPermissions" },
      model: { implement: "opus" },
      extraProjects: ["aide-dashboard"],
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectRoot: "/home/dev",
      push: "branch",
    });
    expect(argv).toContain("--extra-project-dir");
    expect(argv[argv.indexOf("--extra-project-dir") + 1]).toBe("/home/dev/aide-dashboard");
    // The primary is still the project dir, not a passenger.
    expect(argv[argv.indexOf("--project-dir") + 1]).toBe("/home/dev/aide");
  });

  test("a job that names none passes no such flag", async () => {
    const { runnerArgv } = await import("../src/serve.ts");
    const job = {
      project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"],
      budgetUsd: 3, timeoutSec: 1200, permissionMode: {}, model: {}, extraProjects: [],
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectRoot: "/home/dev", push: "branch",
    });
    expect(argv).not.toContain("--extra-project-dir");
  });

  test("one ticked checkbox arrives as a list, not a bare string", async () => {
    const { base } = start(
      { queueToken: TOKEN, queueProjects: ["aide", "aide-dashboard"] },
      ["aide-dashboard"],
    );
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
        extraProjects: "aide-dashboard",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { extraProjects: string[] } };
    expect(body.job.extraProjects).toEqual(["aide-dashboard"]);
  });
});

describe("the form asks which other repos a job will touch", () => {
  const page = (projects: string[]) =>
    renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "index.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      projects,
    });

  test("one checkbox per project, so a cross-repo job can say so up front", () => {
    const html = page(["aide", "aide-dashboard"]);
    expect(html).toContain('name="extraProjects"');
    expect(html).toContain('value="aide-dashboard"');
    expect(html).toContain('value="aide"');
  });

  test("with a single project there is nothing to add, and no field is shown", () => {
    expect(page(["aide"])).not.toContain('name="extraProjects"');
  });

  test("none is ticked by default — a job watches only what it says it will", () => {
    const html = page(["aide", "aide-dashboard"]);
    const field = html.slice(html.indexOf('name="extraProjects"'));
    expect(field.slice(0, 200)).not.toContain("checked");
  });
});

// --- spec 89: merging a spec's branches from the page ------------------------

// The same mistake happened three times on 2026-08-17: a spec's work
// was merged in `aide-specs` and forgotten in `aide`, or the other way
// round. The route merges every repo the spec has a branch in, and
// reports each one on its own — never one collective "ok".
describe("POST /api/queue/<id>/merge", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const PROJECT_REPO = "/repos/aide";
  const SPECS_REPO = "/repos/aide-specs";

  /** A git that answers per repo. `conflicting` names the roots whose
   *  real merge fails, so a two-repo spec can have one of each. */
  function gitFor(conflicting: string[] = []) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only")) return { code: 1, stdout: "" };
      if (a.startsWith("merge -q --no-edit")) {
        return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
      }
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  /** Seed a finished job whose steps pushed to these repos, and hand
   *  back a mirror a second server can read. */
  async function seeded(
    branchUrls: { root: string; url: string }[],
    steps: string[] = ["analyze"],
  ): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers: AUTH, body: JSON.stringify({ ...JOB, steps }) })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "done";
    job.branchUrls = branchUrls;
    job.branchUrl = branchUrls[0]?.url;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  test("a single-repo spec merges and pushes, and says which repo it did", async () => {
    const { mirror, id } = await seeded([{ root: PROJECT_REPO, url: "https://example.test/aide" }]);
    const git = gitFor();
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, gitRun: git.run });
    const res = await fetch(`${base}/api/queue/${id}/merge`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; results: { root: string; ok: boolean }[] };
    expect(body.ok).toBe(true);
    expect(body.results).toEqual([{ root: PROJECT_REPO, ok: true }]);
    expect(git.calls.some((c) => c.dir === PROJECT_REPO && c.args[0] === "push")).toBe(true);
  });

  // Decided up front #2: several repos cannot be merged atomically, so
  // a single green tick would recreate today's problem mirrored.
  test("one repo merging and another conflicting is reported per repo", async () => {
    const { mirror, id } = await seeded([
      { root: PROJECT_REPO, url: "https://example.test/aide" },
      { root: SPECS_REPO, url: "https://example.test/aide-specs" },
    ]);
    const git = gitFor([SPECS_REPO]);
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, gitRun: git.run });
    const res = await fetch(`${base}/api/queue/${id}/merge`, { method: "POST", headers: AUTH });
    const body = (await res.json()) as { ok: boolean; results: { root: string; ok: boolean; error?: string }[] };
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.root === PROJECT_REPO)!.ok).toBe(true);
    const refused = body.results.find((r) => r.root === SPECS_REPO)!;
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain(SPECS_REPO);
    // The conflicting repo left nothing half-merged, and nothing of it
    // reached origin.
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args.join(" ") === "merge --abort")).toBe(true);
    expect(git.calls.some((c) => c.dir === SPECS_REPO && c.args[0] === "push")).toBe(false);
    // The repo that DID merge was still pushed — one failure never
    // rolls back another repo's success.
    expect(git.calls.some((c) => c.dir === PROJECT_REPO && c.args[0] === "push")).toBe(true);
  });

  // Decided up front #4: every step makes branches, and merging after
  // `analyze` is a legitimate thing to want. Nothing here gates on
  // which step ran — only on a branch existing.
  test("a spec that has only been analyzed still merges", async () => {
    const { mirror, id } = await seeded([{ root: SPECS_REPO, url: "https://example.test/aide-specs" }], ["analyze"]);
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, gitRun: gitFor().run });
    const body = (await (
      await fetch(`${base}/api/queue/${id}/merge`, { method: "POST", headers: AUTH })
    ).json()) as { ok: boolean; results: { root: string }[] };
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.root)).toEqual([SPECS_REPO]);
  });

  test("an unknown job id is a 404", async () => {
    const { base } = start({ queueToken: TOKEN });
    expect((await fetch(`${base}/api/queue/nope/merge`, { method: "POST", headers: AUTH })).status).toBe(404);
  });

  test("a spec with no branch recorded is refused, and no git is run at all", async () => {
    const { base } = start({ queueToken: TOKEN });
    const git = gitFor();
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers: AUTH, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const { base: base2 } = start({ queueToken: TOKEN, gitRun: git.run });
    const res = await fetch(`${base2}/api/queue/${made.job.id}/merge`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(404); // the second server does not know this job
    // …and the one that does refuses it with 400, having run nothing.
    const own = await fetch(`${base}/api/queue/${made.job.id}/merge`, { method: "POST", headers: AUTH });
    expect(own.status).toBe(400);
    expect(git.calls.length).toBe(0);
  });

  // Criterion 8. `isMerged()` caches for 30 s, so the page that
  // triggered the merge is exactly the page that would show its own
  // result as "not merged" — the one place a stale answer is certain
  // rather than unlikely. The clock does not move in this test: only
  // the invalidation can account for the change.
  test("the page shows the merge it just did, without waiting out the cache", async () => {
    const { mirror, id } = await seeded([{ root: PROJECT_REPO, url: "https://example.test/aide" }]);
    // A git that starts out saying "not merged" and starts saying
    // "merged" once the branch has actually been pushed to the base.
    const pushed = new Set<string>();
    const run = async (dir: string, args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only")) return { code: 0, stdout: "" };
      if (a.startsWith("push")) {
        pushed.add(dir);
        return { code: 0, stdout: "" };
      }
      if (a.startsWith("merge-base")) return { code: pushed.has(dir) ? 0 : 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, gitRun: run });
    const auth = { headers: { "x-aide-token": TOKEN } };
    expect(await (await fetch(`${base}/specs`, auth)).text()).toContain("not merged");
    const res = await fetch(`${base}/api/queue/${id}/merge`, { method: "POST", headers: AUTH });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(await (await fetch(`${base}/specs`, auth)).text()).not.toContain("not merged");
  });

  test("GET is not a way to merge anything", async () => {
    const { mirror, id } = await seeded([{ root: PROJECT_REPO, url: "https://example.test/aide" }]);
    const git = gitFor();
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, gitRun: git.run });
    expect((await fetch(`${base}/api/queue/${id}/merge`, { headers: AUTH })).status).toBe(405);
    expect(git.calls.length).toBe(0);
  });

  // Not a new guard: `isQueuePath` already covers every `/api/queue/`
  // path, and this confirms the new route inherited it rather than
  // needing its own.
  test("it is behind the same token as every other queue route", async () => {
    const { mirror, id } = await seeded([{ root: PROJECT_REPO, url: "https://example.test/aide" }]);
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, gitRun: gitFor().run });
    expect((await fetch(`${base}/api/queue/${id}/merge`, { method: "POST" })).status).toBe(401);
    const { base: off } = start({ queueMirrorPath: mirror, gitRun: gitFor().run });
    expect((await fetch(`${off}/api/queue/${id}/merge`, { method: "POST" })).status).toBe(503);
  });

  // A person pressing a button on a page gets the answer on that page,
  // not a JSON blob — the same shape the enqueue form already uses.
  test("a plain form post lands back on /specs, with the refusal in the query string", async () => {
    const { mirror, id } = await seeded([{ root: SPECS_REPO, url: "https://example.test/aide-specs" }]);
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, gitRun: gitFor([SPECS_REPO]).run });
    const res = await fetch(`${base}/api/queue/${id}/merge`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/specs?error=")).toBe(true);
    expect(decodeURIComponent(location)).toContain(SPECS_REPO);
  });
});
