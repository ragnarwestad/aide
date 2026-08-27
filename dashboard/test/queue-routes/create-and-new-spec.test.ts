import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  renderNewSpecPage,
  renderQueuePage,
  type NewSpecPageOptions,
} from "../../src/render.ts";
import {
  TOKEN,
  specHead,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});


// Spec 83 let a job name other repos a run would also watch, commit and
// push, and they reached the runner as --extra-project-dir. Both went
// when the tick box that named them turned out never to have been used.
// What a run touches is the project and its specs root, and nothing the
// argv can add.
describe("a run reaches its own project and no other", () => {
  test("no --extra-project-dir is ever built, whatever the job carries", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
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
    }) as unknown as Parameters<typeof import("../../src/serve/serve.ts").runnerArgv>[0];

  const argvFor = async (dependsOn?: string[]) => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
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

  // Spec 228: the model the create step runs on, chosen on the form
  // itself. Posted form-encoded, which is the no-JS path and the one
  // `bodyToObject` folds `model.create` into the per-step shape on.
  test("a model picked on the form reaches the stored job (spec 228)", async () => {
    const { base } = start({
      queueToken: TOKEN,
      queueDefaults: {
        budgetUsd: 3,
        jobCapUsd: 10,
        dailyCapUsd: 20,
        timeoutSec: { default: 1200 },
        permissionMode: { default: "acceptEdits" },
        model: { default: "sonnet" },
        modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
      },
    });
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ ...CREATE, "model.create": "fable" }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ create: "fable" });

    // ...and a name this server does not offer is refused, rather than
    // quietly falling back to the default.
    const bad = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ ...CREATE, "model.create": "opus" }).toString(),
    });
    expect(bad.status).toBe(400);
  });

  // The page has to OFFER what the route accepts — the `/new` handler
  // reads the same `modelChoices` the `/` handler does, or the form
  // draws a dropdown the server would refuse every entry of.
  test("GET /new offers the configured models, grouped by AI (spec 228)", async () => {
    const { base } = start({
      queueToken: TOKEN,
      queueDefaults: {
        budgetUsd: 3,
        jobCapUsd: 10,
        dailyCapUsd: 20,
        timeoutSec: { default: 1200 },
        permissionMode: { default: "acceptEdits" },
        model: { default: "sonnet" },
        modelChoices: { sonnet: { budgetUsd: 3 }, "codex-fast": { budgetUsd: 5, tool: "codex" } },
      },
    });
    const html = await (await fetch(`${base}/new`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain('name="model.create"');
    expect(html).toContain('data-ai="model.create"');
    expect(html).toContain('<optgroup label="Codex">');
    expect(html).toMatch(/<option value="sonnet"[^>]*selected/);
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
    // Spec 252: the bottom Cancel beside Create is gone — the top-left
    // "← Back" is the one way out, falling back to `/` with no Referer.
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
    expect(html).not.toContain(">Cancel<");
    // No rows, and so nothing for the five-second swap to reach for.
    expect(html).not.toContain('id="jobrows"');
  });

  // Spec 252, Criterion 2: a reader who pressed "New spec" from a
  // filtered specs list returns to that exact filter, not to bare `/`.
  test("with a same-origin Referer, ← Back tracks it instead of the bare fallback", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (
      await fetch(`${base}/new`, { headers: { ...auth.headers, referer: `${base}/?state=all&q=archive` } })
    ).text();
    expect(html).toContain('<a class="backlink" href="/?state=all&amp;q=archive">← Back</a>');
  });

  // Criterion 5: a foreign-origin Referer is never followed.
  test("a foreign-origin Referer is discarded, falling back to /", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (
      await fetch(`${base}/new`, { headers: { ...auth.headers, referer: "https://evil.example/" } })
    ).text();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
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
