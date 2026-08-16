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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ServerOptions } from "../src/serve.ts";
import { renderQueuePage, type QueueRowView } from "../src/render.ts";

const TOKEN = "s3cret-token";
const failFetch = (async () => {
  throw new Error("down");
}) as unknown as typeof fetch;

const servers: { stop: () => void }[] = [];
const dirs: string[] = [];

function start(extra: Partial<ServerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aide-queue-routes-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<p>overview</p>");
  // A project root the server can discover: one manifest, one spec.
  const root = join(dir, "root");
  const proj = join(root, "aide");
  mkdirSync(join(proj, ".aide"), { recursive: true });
  writeFileSync(join(proj, ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(join(proj, "specs", "81-queue-and-runner"), { recursive: true });
  writeFileSync(join(proj, "specs", "81-queue-and-runner", "1-description.md"), "# Queue - Description\n");
  const server = createServer({
    siteDir: dir,
    port: 0,
    claudeUsageFetch: failFetch,
    mirrorPath: join(dir, "runs.json"),
    queueMirrorPath: join(dir, "queue.json"),
    projectRoot: root,
    queueProjects: ["aide"],
    ...extra,
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, dir };
}

afterEach(() => {
  while (servers.length) servers.pop()!.stop();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const JOB = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

describe("no token configured", () => {
  test("every queue route is 503; /live and POST /api/aide-run are unaffected", async () => {
    const { base } = start();
    for (const [path, init] of [
      ["/queue", {}],
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
    expect((await fetch(`${base}/api/queue`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`, { method: "POST", body: JSON.stringify(JOB) })).status).toBe(401);
    expect((await fetch(`${base}/queue?token=wrong`)).status).toBe(401);
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

  test("GET /queue?token=… returns 200 and sets an HttpOnly cookie; the cookie then suffices", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/queue?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const jar = cookie.split(";")[0];
    expect((await fetch(`${base}/queue`, { headers: { cookie: jar } })).status).toBe(200);
  });

  test("the header works for API callers", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jobs: [] });
  });

  test("a form POST answers 303 to /queue; a JSON caller gets JSON", async () => {
    const { base } = start({ queueToken: TOKEN });
    const form = await fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
    });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/queue");

    const json = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify(JOB),
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

describe("GET /queue (HTML)", () => {
  test("layout, forms, labels, and the runner notice", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const html = await (await fetch(`${base}/queue`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("<nav>");
    expect(html).toContain("81-queue-and-runner");
    expect(html).toContain('<form method="post"');
    expect(html).toMatch(/<a class="current" href="\/queue"/);
    // Every control says what it is: an unlabelled select next to some
    // checkboxes tells the reader nothing.
    expect(html).toContain("Queue a job");
    expect(html).toContain("Steps, in order");
    expect(html).toContain("stop for approval between steps");
    // 81a ships no runner: the page must say so rather than leave a
    // job sitting in "queued" with no explanation.
    expect(html.toLowerCase()).toContain("no runner");
  });

  test("the blunt meta refresh is a no-JS fallback, not the mechanism", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/queue`, { headers: { "x-aide-token": TOKEN } })).text();
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
    const rows = await (await fetch(`${base}/queue?rows=1`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(rows).toContain("<tr");
    expect(rows).toContain("81-queue-and-runner");
    expect(rows).not.toContain("<html");
    expect(rows).not.toContain("<form method=\"post\" action=\"/api/queue\"");
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
    const params = new URLSearchParams({ target: "aide/81-queue-and-runner", steps: "analyze" });
    params.append("gate", "on");
    await post(params);
    const listed = (await (
      await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })
    ).json()) as { jobs: { gateAfter: string[] }[] };
    // Newest first: the gated one, then the straight-through one.
    expect(listed.jobs[0].gateAfter).toEqual(["analyze"]);
    expect(listed.jobs[1].gateAfter).toEqual([]);
  });

  test("generated pages carry the Queue nav entry", async () => {
    const { renderSite } = await import("../src/render.ts");
    const pages = renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "2026-08-16");
    for (const p of pages) expect(p.html).toContain('<a href="/queue">Queue</a>');
  });
});

describe("renderQueuePage state labels", () => {
  const row = (state: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id: `id-${state}`,
    project: "aide",
    specFolder: "81-queue-and-runner",
    steps: ["analyze"],
    stepIndex: 0,
    state: state as QueueRowView["state"],
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T00:00:00Z",
    ...extra,
  });

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
    const html = await (await fetch(`${base}/queue`, { headers: { "x-aide-token": TOKEN } })).text();
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
    const rows = await (await fetch(`${base}/queue?rows=1`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(rows).toContain('class="state s-queued"');
    expect(rows).toContain("queued");
  });
});

describe("page code placement", () => {
  test("the script comes AFTER the elements it wires up", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/queue`, { headers: { "x-aide-token": TOKEN } })).text();
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
    const html = await (await fetch(`${base}/queue`, { headers: { "x-aide-token": TOKEN } })).text();
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
    const html = await (await fetch(`${base}/queue`, { headers: { "x-aide-token": TOKEN } })).text();
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
    dirs.push(dir);
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
    let html = await (await fetch(`${base}/queue`, { headers: { "x-aide-token": TOKEN } })).text();
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
    html = await (await fetch(`${second.base}/queue`, { headers: { "x-aide-token": TOKEN } })).text();
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
